package model

import (
	"errors"
	"math"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var ErrPartnerInvalid = errors.New("合作伙伴请求无效")
var ErrPartnerState = errors.New("当前状态不允许此操作，请刷新后重试")
var ErrPartnerFunds = errors.New("可用佣金不足或超出限额")
var ErrPartnerQuote = errors.New("后台金额设置已变化，请刷新报价后重试")

// Partner funds use the existing USD/quota scale, independently of both the
// consumption wallet and legacy registration rewards.
type Partner struct {
	UserID           int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Status           string `json:"status" gorm:"type:varchar(20);index"`
	Channels         string `json:"channels" gorm:"type:text"`
	Links            string `json:"links" gorm:"type:text"`
	Plan             string `json:"plan" gorm:"type:text"`
	Contact          string `json:"contact" gorm:"type:text"`
	Evidence         string `json:"evidence" gorm:"type:text"`
	Notes            string `json:"notes" gorm:"type:text"`
	ReviewNote       string `json:"review_note" gorm:"type:text"`
	ReviewedBy       int    `json:"reviewed_by"`
	CreatedAt        int64  `json:"created_at"`
	UpdatedAt        int64  `json:"updated_at"`
	ApprovedAt       int64  `json:"approved_at"`
	AvailableQuota   int    `json:"available_quota"`
	ReservedQuota    int    `json:"reserved_quota"`
	EarnedQuota      int    `json:"earned_quota"`
	WithdrawnQuota   int    `json:"withdrawn_quota"`
	TransferredQuota int    `json:"transferred_quota"`
}

type PartnerCommission struct {
	Reason          string `json:"reason" gorm:"type:varchar(40)"`
	ID              int    `json:"id"`
	PartnerID       int    `json:"partner_id" gorm:"index"`
	UserID          int    `json:"user_id" gorm:"index"`
	TopUpID         int    `json:"topup_id" gorm:"uniqueIndex"`
	PaidAmount      string `json:"paid_amount" gorm:"type:varchar(40)"`
	PaidCurrency    string `json:"paid_currency" gorm:"type:varchar(8)"`
	ExchangeRate    string `json:"exchange_rate" gorm:"type:varchar(40)"`
	TopUpQuota      int    `json:"topup_quota"`
	CommissionBPS   int    `json:"commission_bps"`
	CommissionQuota int    `json:"commission_quota"`
	CreatedAt       int64  `json:"created_at"`
}

type PartnerPayout struct {
	ID            int    `json:"id"`
	UserID        int    `json:"user_id" gorm:"uniqueIndex:idx_partner_request;index"`
	RequestID     string `json:"request_id" gorm:"type:varchar(64);uniqueIndex:idx_partner_request"`
	Kind          string `json:"kind" gorm:"type:varchar(16)"`
	Amount        string `json:"amount" gorm:"type:varchar(40)"`
	Currency      string `json:"currency" gorm:"type:varchar(8)"`
	DebitQuota    int    `json:"debit_quota"`
	Quota         int    `json:"quota"`
	Status        string `json:"status" gorm:"type:varchar(16);index"`
	RecipientName string `json:"recipient_name" gorm:"type:varchar(200)"`
	Account       string `json:"account" gorm:"type:varchar(200)"`
	BankName      string `json:"bank_name" gorm:"type:varchar(200)"`
	CompanyCode   string `json:"company_code" gorm:"type:varchar(80)"`
	ExchangeRate  string `json:"exchange_rate" gorm:"type:varchar(40)"`
	CreditPrice   string `json:"credit_price" gorm:"type:varchar(40)"`
	Quote         string `json:"quote" gorm:"type:varchar(255)"`
	ReviewNote    string `json:"review_note" gorm:"type:text"`
	ReviewedBy    int    `json:"reviewed_by"`
	CreatedAt     int64  `json:"created_at" gorm:"index"`
	CompletedAt   int64  `json:"completed_at"`
}

type PartnerConfig struct {
	BalancePriceSource    string `json:"balance_price_source"`
	Enabled               bool   `json:"enabled"`
	CommissionBPS         int    `json:"commission_bps"`
	DurationDays          int    `json:"duration_days"`
	FirstTopupOnly        bool   `json:"first_topup_only"`
	MinPayoutCents        int64  `json:"min_payout_cents"`
	AlipayDailyLimitCents int64  `json:"alipay_daily_limit_cents"`
	BankSingleLimitCents  int64  `json:"bank_single_limit_cents"`
}

func GetPartnerConfig() PartnerConfig {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["PartnerProgram"]
	common.OptionMapRWMutex.RUnlock()
	config := PartnerConfig{MinPayoutCents: 1, BalancePriceSource: "epay"}
	if raw != "" {
		if err := common.UnmarshalJsonStr(raw, &config); err != nil {
			return PartnerConfig{MinPayoutCents: 1, BalancePriceSource: "epay"}
		}
	}
	if config.BalancePriceSource == "" {
		config.BalancePriceSource = "epay"
	}
	if err := validatePartnerConfig(config); err != nil {
		return PartnerConfig{MinPayoutCents: 1, BalancePriceSource: "epay"}
	}
	return config
}

func UpdatePartnerConfig(config PartnerConfig) error {
	if config.BalancePriceSource == "" {
		config.BalancePriceSource = "epay"
	}
	if err := validatePartnerConfig(config); err != nil {
		return err
	}
	if config.Enabled {
		if _, err := partnerMoneyForConfig("default", config); err != nil {
			return err
		}
	}
	data, err := common.Marshal(config)
	if err != nil {
		return err
	}
	return UpdateOption("PartnerProgram", string(data))
}

func validatePartnerConfig(config PartnerConfig) error {
	switch config.BalancePriceSource {
	case "epay", "alipay_native", "waffo", "waffo_pancake":
	default:
		return ErrPartnerInvalid
	}
	if config.CommissionBPS < 0 || config.CommissionBPS > 10000 || config.DurationDays < 0 || config.DurationDays > 36500 || config.MinPayoutCents < 1 || config.MinPayoutCents > 1e12 || config.AlipayDailyLimitCents < 0 || config.AlipayDailyLimitCents > 1e12 || config.BankSingleLimitCents < 0 || config.BankSingleLimitCents > 1e12 {
		return ErrPartnerInvalid
	}
	return nil
}

type PartnerMoney struct {
	QuotaPerUnit     float64 `json:"quota_per_unit"`
	Currency         string  `json:"currency"`
	CurrencySymbol   string  `json:"currency_symbol"`
	ExchangeRate     string  `json:"exchange_rate"`
	CashCurrency     string  `json:"cash_currency"`
	CashExchangeRate string  `json:"cash_exchange_rate"`
	CreditPrice      string  `json:"credit_price"`
	Quote            string  `json:"quote"`
}

func PartnerMoneyForGroup(group string) (PartnerMoney, error) {
	return partnerMoneyForConfig(group, GetPartnerConfig())
}

func partnerMoneyForConfig(group string, config PartnerConfig) (PartnerMoney, error) {
	price := operation_setting.Price
	priceInUSD := false
	switch config.BalancePriceSource {
	case "epay", "":
	case "alipay_native":
		price = setting.AlipayNativeUnitPrice
	case "waffo_pancake":
		price = setting.WaffoPancakeUnitPrice
		priceInUSD = true
	case "waffo":
		price = setting.WaffoUnitPrice
		currency := strings.ToUpper(setting.WaffoCurrency)
		if currency == "USD" {
			priceInUSD = true
		} else if currency != "CNY" {
			return PartnerMoney{}, ErrPartnerQuote
		}
	default:
		return PartnerMoney{}, ErrPartnerQuote
	}
	ratio := common.GetTopupGroupRatio(group)
	if ratio == 0 {
		ratio = 1
	}
	rate := operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
	for _, n := range []float64{common.QuotaPerUnit, operation_setting.USDExchangeRate, price, ratio, rate} {
		if n <= 0 || math.IsNaN(n) || math.IsInf(n, 0) {
			return PartnerMoney{}, ErrPartnerQuote
		}
	}
	creditPrice := decimal.NewFromFloat(price).Mul(decimal.NewFromFloat(ratio))
	if priceInUSD {
		creditPrice = creditPrice.Mul(decimal.NewFromFloat(operation_setting.USDExchangeRate))
	}
	m := PartnerMoney{
		QuotaPerUnit:     common.QuotaPerUnit,
		Currency:         operation_setting.GetQuotaDisplayType(),
		CurrencySymbol:   operation_setting.GetCurrencySymbol(),
		ExchangeRate:     decimal.NewFromFloat(rate).String(),
		CashCurrency:     "CNY",
		CashExchangeRate: decimal.NewFromFloat(operation_setting.USDExchangeRate).String(),
		CreditPrice:      creditPrice.String(),
	}
	m.Quote = strings.Join([]string{decimal.NewFromFloat(m.QuotaPerUnit).String(), m.CashExchangeRate, m.CreditPrice, config.BalancePriceSource}, ":")
	if len(m.Quote) > 255 {
		return PartnerMoney{}, ErrPartnerQuote
	}
	return m, nil
}

func GetPartner(userID int) (*Partner, error) {
	var p Partner
	err := DB.First(&p, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

type PartnerApplicationInput struct {
	Channels string `json:"channels"`
	Links    string `json:"links"`
	Plan     string `json:"plan"`
	Contact  string `json:"contact"`
	Evidence string `json:"evidence"`
	Notes    string `json:"notes"`
}

func SubmitPartnerApplication(userID int, input PartnerApplicationInput) (*Partner, error) {
	input.Channels = strings.TrimSpace(input.Channels)
	input.Plan = strings.TrimSpace(input.Plan)
	input.Contact = strings.TrimSpace(input.Contact)
	if userID <= 0 || !GetPartnerConfig().Enabled || input.Channels == "" || input.Plan == "" || input.Contact == "" {
		return nil, ErrPartnerInvalid
	}
	for _, value := range []string{input.Channels, input.Links, input.Plan, input.Contact, input.Evidence, input.Notes} {
		if !utf8.ValidString(value) || len(value) > 4000 {
			return nil, ErrPartnerInvalid
		}
	}
	for _, text := range []string{input.Links, input.Evidence} {
		for _, line := range strings.Fields(text) {
			u, err := url.Parse(line)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
				return nil, ErrPartnerInvalid
			}
		}
	}
	p := Partner{UserID: userID, Status: "pending", Channels: input.Channels, Links: input.Links, Plan: input.Plan, Contact: input.Contact, Evidence: input.Evidence, Notes: input.Notes, CreatedAt: common.GetTimestamp(), UpdatedAt: common.GetTimestamp()}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var old Partner
		err := lockForUpdate(tx).First(&old, "user_id = ?", userID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&p).Error
		}
		if err != nil {
			return err
		}
		if old.Status != "needs_info" && old.Status != "rejected" {
			return ErrPartnerState
		}
		p.CreatedAt = old.CreatedAt
		result := tx.Model(&Partner{}).Where("user_id = ? AND status IN ?", userID, []string{"needs_info", "rejected"}).Select("status", "channels", "links", "plan", "contact", "evidence", "notes", "review_note", "updated_at").Updates(&p)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPartnerState
		}
		return nil
	})
	return &p, err
}

func ReviewPartner(userID, actor int, status, note string) error {
	if len(note) > 4000 || ((status == "needs_info" || status == "rejected" || status == "suspended") && strings.TrimSpace(note) == "") {
		return ErrPartnerInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var p Partner
		if err := lockForUpdate(tx).First(&p, "user_id = ?", userID).Error; err != nil {
			return err
		}
		allowed := (p.Status == "pending" && (status == "approved" || status == "needs_info" || status == "rejected")) || (p.Status == "approved" && status == "suspended") || (p.Status == "suspended" && status == "approved")
		if !allowed {
			return ErrPartnerState
		}
		previous := p.Status
		p.Status = status
		p.ReviewNote = note
		p.ReviewedBy = actor
		p.UpdatedAt = common.GetTimestamp()
		if status == "approved" && p.ApprovedAt == 0 {
			p.ApprovedAt = p.UpdatedAt
		}
		result := tx.Model(&Partner{}).Where("user_id = ? AND status = ?", userID, previous).Select("status", "review_note", "reviewed_by", "updated_at", "approved_at").Updates(&p)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPartnerState
		}
		return nil
	})
}

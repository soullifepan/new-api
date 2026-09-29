package model

import (
	"errors"
	"math"
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
	CommissionBPS    *int   `json:"commission_bps"` // nil inherits the global rate; zero explicitly disables commission.
	DurationDays     *int   `json:"duration_days"`  // nil inherits the global duration; zero means no expiry.
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
	BalancePriceSource string `json:"balance_price_source"`
	Enabled            bool   `json:"enabled"` // Always false: public applications are retired; retained for older clients.
	CommissionBPS      int    `json:"commission_bps"`
	DurationDays       int    `json:"duration_days"`
	// Kept false in API responses for older clients; every eligible recharge earns commission.
	FirstTopupOnly        bool  `json:"first_topup_only"`
	MinPayoutCents        int64 `json:"min_payout_cents"`
	AlipayDailyLimitCents int64 `json:"alipay_daily_limit_cents"`
	BankSingleLimitCents  int64 `json:"bank_single_limit_cents"`
}

func GetPartnerConfig() PartnerConfig {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["PartnerProgram"]
	common.OptionMapRWMutex.RUnlock()
	config := PartnerConfig{MinPayoutCents: 1, BalancePriceSource: "alipay_native"}
	if raw != "" {
		if err := common.UnmarshalJsonStr(raw, &config); err != nil {
			return PartnerConfig{MinPayoutCents: 1, BalancePriceSource: "alipay_native"}
		}
	}
	config.Enabled = false
	config.FirstTopupOnly = false
	config.BalancePriceSource = "alipay_native"
	if err := validatePartnerConfig(config); err != nil {
		return PartnerConfig{MinPayoutCents: 1, BalancePriceSource: "alipay_native"}
	}
	return config
}

func UpdatePartnerConfig(config PartnerConfig) error {
	config.Enabled = false
	config.FirstTopupOnly = false
	config.BalancePriceSource = "alipay_native"
	if err := validatePartnerConfig(config); err != nil {
		return err
	}
	data, err := common.Marshal(config)
	if err != nil {
		return err
	}
	return UpdateOption("PartnerProgram", string(data))
}

func validatePartnerConfig(config PartnerConfig) error {
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
	// Match the current TapComfy checkout unit price and group pricing.
	price := setting.AlipayNativeUnitPrice
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
	m := PartnerMoney{
		QuotaPerUnit:     common.QuotaPerUnit,
		Currency:         operation_setting.GetQuotaDisplayType(),
		CurrencySymbol:   operation_setting.GetCurrencySymbol(),
		ExchangeRate:     decimal.NewFromFloat(rate).String(),
		CashCurrency:     "CNY",
		CashExchangeRate: decimal.NewFromFloat(operation_setting.USDExchangeRate).String(),
		CreditPrice:      creditPrice.String(),
	}
	m.Quote = strings.Join([]string{decimal.NewFromFloat(m.QuotaPerUnit).String(), m.CashExchangeRate, m.CreditPrice, "alipay_native"}, ":")
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

// CanPartnerInvite applies the same eligibility to code issuance and signup
// attribution. Existing invitation relationships and funds remain unchanged.
func CanPartnerInvite(userID int) (bool, error) {
	partner, err := GetPartner(userID)
	if err != nil {
		return false, err
	}
	return partner != nil && partner.Status == "approved", nil
}

// EffectivePartnerConfig overlays independently configured partner terms.
func EffectivePartnerConfig(partner *Partner, config PartnerConfig) PartnerConfig {
	if partner == nil {
		return config
	}
	if partner.CommissionBPS != nil {
		config.CommissionBPS = *partner.CommissionBPS
	}
	if partner.DurationDays != nil {
		config.DurationDays = *partner.DurationDays
	}
	return config
}

// UpdatePartnerCommission changes only supplied terms. Explicit null restores inheritance.
func UpdatePartnerCommission(userID int, input map[string]*int) (*Partner, error) {
	if userID <= 0 || len(input) == 0 {
		return nil, ErrPartnerInvalid
	}
	updates := make(map[string]any, len(input)+1)
	for key, value := range input {
		var limit int
		switch key {
		case "commission_bps":
			limit = 10000
		case "duration_days":
			limit = 36500
		default:
			return nil, ErrPartnerInvalid
		}
		if value != nil && (*value < 0 || *value > limit) {
			return nil, ErrPartnerInvalid
		}
		updates[key] = value
	}
	var partner Partner
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&partner, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if bps, present := input["commission_bps"]; present {
			partner.CommissionBPS = bps
		}
		if days, present := input["duration_days"]; present {
			partner.DurationDays = days
		}
		partner.UpdatedAt = common.GetTimestamp()
		updates["updated_at"] = partner.UpdatedAt
		return tx.Model(&Partner{}).Where("user_id = ?", userID).Updates(updates).Error
	})
	return &partner, err
}

// CanAccessPartnerDashboard includes suspended former partners so earned funds remain accessible.
func CanAccessPartnerDashboard(partner *Partner) bool {
	return partner != nil && partner.ApprovedAt > 0 && (partner.Status == "approved" || partner.Status == "suspended")
}

type PartnerGrantInput struct {
	UserID     int    `json:"user_id"`
	Channels   string `json:"channels"`
	Links      string `json:"links"`
	Plan       string `json:"plan"`
	Contact    string `json:"contact"`
	Evidence   string `json:"evidence"`
	Notes      string `json:"notes"`
	ReviewNote string `json:"review_note"`
}

// GrantPartner opens membership after offline agreement. Repeated grants do not reset terms or funds.
func GrantPartner(input PartnerGrantInput, actor int) (*Partner, error) {
	if input.UserID <= 0 || actor <= 0 {
		return nil, ErrPartnerInvalid
	}
	for _, field := range []*string{&input.Channels, &input.Links, &input.Plan, &input.Contact, &input.Evidence, &input.Notes, &input.ReviewNote} {
		*field = strings.TrimSpace(*field)
		if !utf8.ValidString(*field) || len(*field) > 4000 {
			return nil, ErrPartnerInvalid
		}
	}
	var partner Partner
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "status").First(&user, input.UserID).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled {
			return ErrPartnerState
		}
		err := lockForUpdate(tx).First(&partner, "user_id = ?", input.UserID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := common.GetTimestamp()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			partner = Partner{UserID: input.UserID, Status: "approved", ApprovedAt: now, CreatedAt: now, UpdatedAt: now, ReviewedBy: actor, Channels: input.Channels, Links: input.Links, Plan: input.Plan, Contact: input.Contact, Evidence: input.Evidence, Notes: input.Notes, ReviewNote: input.ReviewNote}
			return tx.Create(&partner).Error
		}
		if partner.Status == "approved" {
			return nil
		}
		if partner.Status != "pending" && partner.Status != "needs_info" && partner.Status != "rejected" {
			return ErrPartnerState
		}
		partner.Status, partner.ReviewNote, partner.ReviewedBy, partner.UpdatedAt = "approved", input.ReviewNote, actor, now
		if input.Channels != "" {
			partner.Channels = input.Channels
		}
		if input.Links != "" {
			partner.Links = input.Links
		}
		if input.Plan != "" {
			partner.Plan = input.Plan
		}
		if input.Contact != "" {
			partner.Contact = input.Contact
		}
		if input.Evidence != "" {
			partner.Evidence = input.Evidence
		}
		if input.Notes != "" {
			partner.Notes = input.Notes
		}
		if partner.ApprovedAt == 0 {
			partner.ApprovedAt = now
		}
		return tx.Model(&Partner{}).Where("user_id = ?", input.UserID).Select("status", "review_note", "reviewed_by", "updated_at", "approved_at", "channels", "links", "plan", "contact", "evidence", "notes").Updates(&partner).Error
	})
	return &partner, err
}

func ReviewPartner(userID, actor int, status, note string) error {
	if !utf8.ValidString(note) || len(note) > 4000 || (status == "suspended" && strings.TrimSpace(note) == "") {
		return ErrPartnerInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var p Partner
		if err := lockForUpdate(tx).First(&p, "user_id = ?", userID).Error; err != nil {
			return err
		}
		allowed := p.ApprovedAt > 0 && ((p.Status == "approved" && status == "suspended") || (p.Status == "suspended" && status == "approved"))
		if !allowed {
			return ErrPartnerState
		}
		previous := p.Status
		p.Status = status
		p.ReviewNote = note
		p.ReviewedBy = actor
		p.UpdatedAt = common.GetTimestamp()
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

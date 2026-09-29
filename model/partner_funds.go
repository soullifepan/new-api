package model

import (
	"errors"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var partnerDecimal = regexp.MustCompile(`^[0-9]{1,14}(\.[0-9]{1,8})?$`)

// recordPartnerCommission participates in the payment transaction: a committed
// top-up cannot lose its commission on process exit or duplicate notification.
func recordPartnerCommission(tx *gorm.DB, topup *TopUp) error {
	config := GetPartnerConfig()
	if topup.PaidSandbox || topup.PaidAmount == "" || topup.PaymentMethod == "alipay_native_sandbox" || topup.Amount <= 0 {
		return nil
	}
	var customer User
	if err := lockForUpdate(tx).Select("id", "inviter_id", "created_at").First(&customer, topup.UserId).Error; err != nil {
		return err
	}
	if customer.InviterId <= 0 || customer.InviterId == customer.Id {
		return nil
	}
	var partner Partner
	err := lockForUpdate(tx).First(&partner, "user_id = ?", customer.InviterId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	var count int64
	if err := tx.Model(&PartnerCommission{}).Where("top_up_id = ?", topup.Id).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	paid, err := decimal.NewFromString(topup.PaidAmount)
	if err != nil || paid.IsNegative() {
		return ErrPartnerInvalid
	}
	if paid.IsZero() {
		return nil
	}
	rate := decimal.NewFromInt(1)
	switch topup.PaidCurrency {
	case "USD":
	case "CNY":
		if operation_setting.USDExchangeRate <= 0 || math.IsNaN(operation_setting.USDExchangeRate) || math.IsInf(operation_setting.USDExchangeRate, 0) {
			return ErrPartnerQuote
		}
		rate = decimal.NewFromFloat(operation_setting.USDExchangeRate)
	default:
		// Keep the paid order successful, retaining an explicit unconverted
		// record rather than inventing an exchange rate or losing the payment.
		return tx.Create(&PartnerCommission{PartnerID: partner.UserID, UserID: customer.Id, TopUpID: topup.Id, PaidAmount: paid.String(), PaidCurrency: topup.PaidCurrency, Reason: "unsupported_currency", CreatedAt: topup.CompleteTime}).Error
	}
	topupQuota, err := common.WalletQuotaFromDecimalStrict(paid.Div(rate).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Floor())
	if err != nil || topupQuota <= 0 {
		return ErrPartnerInvalid
	}
	start := max(customer.CreatedAt, partner.ApprovedAt)
	eligible := partner.Status == "approved" && partner.ApprovedAt > 0 && topup.CompleteTime >= partner.ApprovedAt && (config.DurationDays == 0 || topup.CompleteTime < start+int64(config.DurationDays)*86400)
	commission := 0
	if eligible {
		commission, err = common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(int64(topupQuota)).Mul(decimal.NewFromInt(int64(config.CommissionBPS))).Div(decimal.NewFromInt(10000)).Floor())
		if err != nil {
			return err
		}
	}
	entry := PartnerCommission{PartnerID: partner.UserID, UserID: customer.Id, TopUpID: topup.Id, PaidAmount: paid.String(), PaidCurrency: topup.PaidCurrency, ExchangeRate: rate.String(), TopUpQuota: topupQuota, CommissionBPS: config.CommissionBPS, CommissionQuota: commission, CreatedAt: topup.CompleteTime}
	if err := tx.Create(&entry).Error; err != nil {
		return err
	}
	if commission == 0 {
		return nil
	}
	result := tx.Model(&Partner{}).Where("user_id = ? AND available_quota <= ? AND earned_quota <= ?", partner.UserID, common.MaxWalletQuota-commission, common.MaxWalletQuota-commission).Updates(map[string]any{"available_quota": gorm.Expr("available_quota + ?", commission), "earned_quota": gorm.Expr("earned_quota + ?", commission)})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPartnerFunds
	}
	return nil
}

type PartnerPayoutInput struct {
	RequestID     string `json:"request_id"`
	Kind          string `json:"kind"`
	Amount        string `json:"amount"`
	ExchangeRate  string `json:"exchange_rate"`
	RecipientName string `json:"recipient_name"`
	Account       string `json:"account"`
	BankName      string `json:"bank_name"`
	CompanyCode   string `json:"company_code"`
}

// PartnerAlipayUsedCents uses the configured site's fixed business timezone
// (Asia/Shanghai for domestic cash payouts), independent of the server TZ.
func PartnerAlipayUsedCents(tx *gorm.DB, userID int) (int64, error) {
	now := time.Now().In(time.FixedZone("CST", 8*3600))
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	var rows []PartnerPayout
	if err := tx.Select("amount").Where("user_id = ? AND kind = ? AND status IN ? AND created_at >= ?", userID, "alipay", []string{"pending", "paid"}, start).Find(&rows).Error; err != nil {
		return 0, err
	}
	total := decimal.Zero
	for _, row := range rows {
		v, err := decimal.NewFromString(row.Amount)
		if err != nil {
			return 0, err
		}
		total = total.Add(v.Mul(decimal.NewFromInt(100)))
	}
	if total.GreaterThan(decimal.NewFromInt(common.MaxWalletQuota)) {
		return 0, ErrPartnerFunds
	}
	return total.IntPart(), nil
}

func CreatePartnerPayout(userID int, input PartnerPayoutInput) (*PartnerPayout, error) {
	if !partnerDecimal.MatchString(input.Amount) || userID <= 0 || len(input.RequestID) < 8 || len(input.RequestID) > 64 || len(input.Amount) > 32 || len(input.ExchangeRate) > 255 {
		return nil, ErrPartnerInvalid
	}
	amount, err := decimal.NewFromString(input.Amount)
	if err != nil || !amount.IsPositive() || !amount.Equal(amount.Truncate(2)) || amount.GreaterThan(decimal.NewFromInt(1e10)) {
		return nil, ErrPartnerInvalid
	}
	for _, v := range []string{input.RecipientName, input.Account, input.BankName} {
		if len(v) > 200 {
			return nil, ErrPartnerInvalid
		}
	}
	if len(input.CompanyCode) > 80 {
		return nil, ErrPartnerInvalid
	}
	switch input.Kind {
	case "balance":
		if input.RecipientName != "" || input.Account != "" || input.BankName != "" || input.CompanyCode != "" {
			return nil, ErrPartnerInvalid
		}
	case "alipay":
		if strings.TrimSpace(input.RecipientName) == "" || strings.TrimSpace(input.Account) == "" {
			return nil, ErrPartnerInvalid
		}
	case "bank":
		if strings.TrimSpace(input.RecipientName) == "" || strings.TrimSpace(input.Account) == "" || strings.TrimSpace(input.BankName) == "" || strings.TrimSpace(input.CompanyCode) == "" {
			return nil, ErrPartnerInvalid
		}
	default:
		return nil, ErrPartnerInvalid
	}
	var payout PartnerPayout
	created := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		// Obtain SQLite's write lock before reading, avoiding deferred-lock upgrades.
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&Partner{}).Where("user_id = ?", userID).UpdateColumn("available_quota", gorm.Expr("available_quota")).Error; err != nil {
				return err
			}
		}
		var partner Partner
		if err := lockForUpdate(tx).First(&partner, "user_id = ?", userID).Error; err != nil {
			return err
		}
		existingErr := lockForUpdate(tx).Where("user_id = ? AND request_id = ?", userID, input.RequestID).First(&payout).Error
		if existingErr == nil {
			if payout.Kind != input.Kind || payout.Amount != amount.StringFixed(2) || payout.Quote != input.ExchangeRate || payout.RecipientName != input.RecipientName || payout.Account != input.Account || payout.BankName != input.BankName || payout.CompanyCode != input.CompanyCode {
				return ErrPartnerInvalid
			}
			return nil
		}
		if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		if partner.Status != "approved" && partner.Status != "suspended" {
			return ErrPartnerState
		}
		var user User
		if err := tx.Select("id", "group", "status").First(&user, userID).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled {
			return ErrPartnerState
		}
		money, err := PartnerMoneyForGroup(user.Group)
		if err != nil {
			return err
		}
		if money.Quote != input.ExchangeRate {
			return ErrPartnerQuote
		}
		rate, _ := decimal.NewFromString(money.CashExchangeRate)
		debit, err := common.WalletQuotaFromDecimalStrict(amount.Div(rate).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Ceil())
		if err != nil || debit <= 0 {
			return ErrPartnerInvalid
		}
		config := GetPartnerConfig()
		cents := amount.Mul(decimal.NewFromInt(100)).IntPart()
		if input.Kind != "balance" && cents < config.MinPayoutCents {
			return ErrPartnerFunds
		}
		if input.Kind == "bank" && config.BankSingleLimitCents > 0 && cents > config.BankSingleLimitCents {
			return ErrPartnerFunds
		}
		if input.Kind == "alipay" && config.AlipayDailyLimitCents > 0 {
			used, err := PartnerAlipayUsedCents(tx, userID)
			if err != nil {
				return err
			}
			if cents > config.AlipayDailyLimitCents-used {
				return ErrPartnerFunds
			}
		}
		payout = PartnerPayout{UserID: userID, RequestID: input.RequestID, Kind: input.Kind, Amount: amount.StringFixed(2), Currency: "CNY", DebitQuota: debit, Status: "pending", RecipientName: input.RecipientName, Account: input.Account, BankName: input.BankName, CompanyCode: input.CompanyCode, ExchangeRate: money.CashExchangeRate, CreditPrice: money.CreditPrice, Quote: money.Quote, CreatedAt: common.GetTimestamp()}
		updates := map[string]any{"available_quota": gorm.Expr("available_quota - ?", debit)}
		if input.Kind == "balance" {
			price, _ := decimal.NewFromString(money.CreditPrice)
			quota, err := common.WalletQuotaFromDecimalStrict(amount.Div(price).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Floor())
			if err != nil || quota <= 0 {
				return ErrPartnerInvalid
			}
			payout.Quota = quota
			payout.Status = "paid"
			payout.CompletedAt = payout.CreatedAt
			updates["transferred_quota"] = gorm.Expr("transferred_quota + ?", debit)
			if err := creditTopUpQuota(tx, userID, quota, nil); err != nil {
				return err
			}
		} else {
			updates["reserved_quota"] = gorm.Expr("reserved_quota + ?", debit)
		}
		// earned_quota is capped and all buckets partition it; additions cannot overflow.
		result := tx.Model(&Partner{}).Where("user_id = ? AND available_quota >= ?", userID, debit).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPartnerFunds
		}
		if err := tx.Create(&payout).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err == nil && created && payout.Kind == "balance" {
		syncCreditUserQuotaCache(userID, payout.Quota, "partner commission transfer")
	}
	return &payout, err
}

func ReviewPartnerPayout(id, actor int, status, note string) error {
	if (status != "paid" && status != "rejected") || len(note) > 4000 || (status == "rejected" && strings.TrimSpace(note) == "") {
		return ErrPartnerInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		// Follow the same partner -> payout lock order as submission.
		var payout PartnerPayout
		if err := tx.First(&payout, id).Error; err != nil {
			return err
		}
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&Partner{}).Where("user_id = ?", payout.UserID).UpdateColumn("available_quota", gorm.Expr("available_quota")).Error; err != nil {
				return err
			}
		}
		var partner Partner
		if err := lockForUpdate(tx).First(&partner, "user_id = ?", payout.UserID).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&payout, id).Error; err != nil {
			return err
		}
		if payout.Kind == "balance" {
			return ErrPartnerState
		}
		if payout.Status == status {
			return nil
		}
		if payout.Status != "pending" {
			return ErrPartnerState
		}
		updates := map[string]any{"reserved_quota": gorm.Expr("reserved_quota - ?", payout.DebitQuota)}
		if status == "paid" {
			updates["withdrawn_quota"] = gorm.Expr("withdrawn_quota + ?", payout.DebitQuota)
		} else {
			updates["available_quota"] = gorm.Expr("available_quota + ?", payout.DebitQuota)
		}
		result := tx.Model(&Partner{}).Where("user_id = ? AND reserved_quota >= ?", payout.UserID, payout.DebitQuota).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPartnerFunds
		}
		return tx.Model(&payout).Updates(map[string]any{"status": status, "review_note": note, "reviewed_by": actor, "completed_at": common.GetTimestamp()}).Error
	})
}

// PartnerPayment is supplied only by verified payment handlers, never client JSON.
type PartnerPayment struct {
	Sandbox  bool
	Amount   string
	Currency string
}

func (topup *TopUp) ApplyPartnerPayment(payment PartnerPayment) error {
	if !partnerDecimal.MatchString(payment.Amount) || len(payment.Amount) > 40 || len(payment.Currency) > 8 {
		return ErrPartnerInvalid
	}
	amount, err := decimal.NewFromString(payment.Amount)
	if err != nil || amount.IsNegative() || amount.GreaterThan(decimal.NewFromInt(1e12)) {
		return ErrPartnerInvalid
	}
	topup.PaidSandbox = payment.Sandbox
	topup.PaidAmount = amount.String()
	topup.PaidCurrency = strings.ToUpper(payment.Currency)
	return nil
}

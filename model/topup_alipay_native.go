package model

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const PaymentProviderAlipayNative = "alipay_native"

var (
	ErrAlipayNativeConfigChanged = errors.New("alipay native configuration changed")
	ErrAlipayNativePendingOrders = errors.New("pending alipay native orders prevent credential changes")
)

// AlipayNativeConfig is the complete persisted gateway snapshot. Payment
// requests use one instance of this value from quoting through pre-create so
// that a concurrent administrator update cannot mix credentials or prices.
type AlipayNativeConfig struct {
	Enabled            bool
	Sandbox            bool
	AppID              string
	SellerID           string
	PrivateKey         string
	PublicKey          string
	AppCert            string
	AlipayCert         string
	RootCert           string
	UnitPrice          float64
	MinTopUp           int
	PreservePrivateKey bool
}

var alipayNativeConfigKeys = []string{
	"AlipayNativeEnabled", "AlipayNativeSandbox", "AlipayNativeAppID", "AlipayNativeSellerID",
	"AlipayNativePrivateKey", "AlipayNativePublicKey", "AlipayNativeAppCert", "AlipayNativeAlipayCert",
	"AlipayNativeRootCert", "AlipayNativeUnitPrice", "AlipayNativeMinTopUp",
}

func alipayNativeConfigValues(config AlipayNativeConfig) map[string]string {
	return map[string]string{
		"AlipayNativeEnabled": strconv.FormatBool(config.Enabled), "AlipayNativeSandbox": strconv.FormatBool(config.Sandbox),
		"AlipayNativeAppID": config.AppID, "AlipayNativeSellerID": config.SellerID,
		"AlipayNativePrivateKey": config.PrivateKey, "AlipayNativePublicKey": config.PublicKey,
		"AlipayNativeAppCert": config.AppCert, "AlipayNativeAlipayCert": config.AlipayCert,
		"AlipayNativeRootCert": config.RootCert, "AlipayNativeUnitPrice": strconv.FormatFloat(config.UnitPrice, 'f', -1, 64),
		"AlipayNativeMinTopUp": strconv.Itoa(config.MinTopUp),
	}
}

func alipayNativeConfigFromValues(values map[string]string) AlipayNativeConfig {
	unitPrice, err := strconv.ParseFloat(values["AlipayNativeUnitPrice"], 64)
	if err != nil || unitPrice <= 0 {
		unitPrice = 1
	}
	minTopUp, err := strconv.Atoi(values["AlipayNativeMinTopUp"])
	if err != nil || minTopUp <= 0 {
		minTopUp = 1
	}
	return AlipayNativeConfig{
		Enabled: values["AlipayNativeEnabled"] == "true", Sandbox: values["AlipayNativeSandbox"] == "true",
		AppID: values["AlipayNativeAppID"], SellerID: values["AlipayNativeSellerID"],
		PrivateKey: values["AlipayNativePrivateKey"], PublicKey: values["AlipayNativePublicKey"],
		AppCert: values["AlipayNativeAppCert"], AlipayCert: values["AlipayNativeAlipayCert"], RootCert: values["AlipayNativeRootCert"],
		UnitPrice: unitPrice, MinTopUp: minTopUp,
	}
}

func lockAlipayNativeConfig(tx *gorm.DB) error {
	option := &Option{Key: "AlipayNativeEnabled"}
	// Do not issue a plain SELECT before the locking read: under MySQL's
	// REPEATABLE READ that would establish an old snapshot. The conflict-safe
	// insert followed by SELECT ... FOR UPDATE observes the current committed
	// configuration and serializes all instances on this row.
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(option).Error; err != nil {
		return err
	}
	return lockForUpdate(tx).Where(&Option{Key: option.Key}).First(option).Error
}

func alipayNativeConfigInTx(tx *gorm.DB) (AlipayNativeConfig, error) {
	var options []Option
	if err := tx.Where(map[string]any{"key": alipayNativeConfigKeys}).Find(&options).Error; err != nil {
		return AlipayNativeConfig{}, err
	}
	values := make(map[string]string, len(options))
	for _, option := range options {
		values[option.Key] = option.Value
	}
	return alipayNativeConfigFromValues(values), nil
}

func GetAlipayNativeConfig() (AlipayNativeConfig, error) {
	return alipayNativeConfigInTx(DB)
}

// UpdateAlipayNativeConfig atomically persists a whole configuration. A
// database row lock serializes this with checkout creation in every process;
// identity material and environment cannot change while an order awaits a
// callback, while enablement and unit price intentionally remain adjustable.
func UpdateAlipayNativeConfig(config AlipayNativeConfig) error {
	var previous AlipayNativeConfig
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockAlipayNativeConfig(tx); err != nil {
			return err
		}
		var err error
		previous, err = alipayNativeConfigInTx(tx)
		if err != nil {
			return err
		}
		if config.PreservePrivateKey {
			config.PrivateKey = previous.PrivateKey
		}
		identityChanged := previous.Sandbox != config.Sandbox || previous.AppID != config.AppID || previous.SellerID != config.SellerID || previous.PrivateKey != config.PrivateKey || previous.PublicKey != config.PublicKey || previous.AppCert != config.AppCert || previous.AlipayCert != config.AlipayCert || previous.RootCert != config.RootCert
		if identityChanged {
			var pending int64
			if err := tx.Model(&TopUp{}).Where("payment_provider = ? AND status = ?", PaymentProviderAlipayNative, common.TopUpStatusPending).Count(&pending).Error; err != nil {
				return err
			}
			if pending > 0 {
				return ErrAlipayNativePendingOrders
			}
		}
		for key, value := range alipayNativeConfigValues(config) {
			option := &Option{Key: key}
			if err := tx.FirstOrCreate(option, Option{Key: key}).Error; err != nil {
				return err
			}
			option.Value = value
			if err := tx.Save(option).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	for key, value := range alipayNativeConfigValues(config) {
		if err := updateOptionMap(key, value); err != nil {
			return err
		}
	}
	return nil
}

// CreateAlipayNativeTopUp binds a pending order to the exact configuration
// snapshot that produced its quote. The same persisted lock used by config
// updates closes the check/create race across multiple application instances.
func CreateAlipayNativeTopUp(topUp *TopUp, expected AlipayNativeConfig) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := lockAlipayNativeConfig(tx); err != nil {
			return err
		}
		current, err := alipayNativeConfigInTx(tx)
		if err != nil {
			return err
		}
		if current != expected {
			return ErrAlipayNativeConfigChanged
		}
		return tx.Create(topUp).Error
	})
}

// CloseAlipayNativeTopUp records an authenticated terminal close without
// crediting. Its provider and environment checks prevent one gateway from
// closing a different pending order.
func CloseAlipayNativeTopUp(tradeNo string, sandbox bool) error {
	expectedMethod := "alipay_native"
	if sandbox {
		expectedMethod = "alipay_native_sandbox"
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if topUp.PaymentProvider != PaymentProviderAlipayNative || topUp.PaymentMethod != expectedMethod {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status == common.TopUpStatusExpired {
			return nil
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}
		topUp.Status = common.TopUpStatusExpired
		return tx.Save(topUp).Error
	})
}

// RechargeAlipayNative is the shared idempotent settlement boundary for
// verified notifications and authenticated order queries.
func RechargeAlipayNative(tradeNo string, sandbox bool, callerIP string) (alreadyDone bool, err error) {
	expectedMethod := "alipay_native"
	if sandbox {
		expectedMethod = "alipay_native_sandbox"
	}
	var quotaToAdd int
	topUp := &TopUp{}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if topUp.PaymentProvider != PaymentProviderAlipayNative || topUp.PaymentMethod != expectedMethod {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status == common.TopUpStatusSuccess {
			alreadyDone = true
			return nil
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}
		var quotaErr error
		quotaToAdd, quotaErr = common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
		if quotaErr != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}
		topUp.CompleteTime, topUp.Status = common.GetTimestamp(), common.TopUpStatusSuccess
		if err := tx.Save(topUp).Error; err != nil {
			return err
		}
		return creditTopUpQuota(tx, topUp.UserId, quotaToAdd, nil)
	})
	if err != nil || alreadyDone {
		return alreadyDone, err
	}
	syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "alipay native topup")
	RecordTopupLog(topUp.UserId, fmt.Sprintf("支付宝当面付充值成功，充值金额: %v，支付金额：%f", logger.LogQuota(quotaToAdd), topUp.Money), callerIP, topUp.PaymentMethod, PaymentProviderAlipayNative)
	return false, nil
}

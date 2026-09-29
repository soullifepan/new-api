package model

import (
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestPartnerDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(t.TempDir() + "/partner.db?_pragma=busy_timeout(10000)")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "partner_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(8)
			oldDB, oldLog, oldType, oldRedis := DB, LOG_DB, common.MainDatabaseType(), common.RedisEnabled
			oldOptions := common.OptionMap
			oldRate, oldPrice, oldNativePrice := operation_setting.USDExchangeRate, operation_setting.Price, setting.AlipayNativeUnitPrice
			DB, LOG_DB = db, db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			common.RedisEnabled = false
			common.OptionMap = map[string]string{}
			operation_setting.USDExchangeRate = 7
			operation_setting.Price = 2
			setting.AlipayNativeUnitPrice = 2
			models := []any{&PartnerPayout{}, &PartnerCommission{}, &Partner{}, &TopUp{}, &User{}, &Option{}, &Log{}}
			require.NoError(t, db.Migrator().DropTable(models...))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(models...))
				DB, LOG_DB = oldDB, oldLog
				common.SetMainDatabaseType(oldType)
				initCol()
				common.RedisEnabled = oldRedis
				common.OptionMap = oldOptions
				operation_setting.USDExchangeRate, operation_setting.Price, setting.AlipayNativeUnitPrice = oldRate, oldPrice, oldNativePrice
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(models...))
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Log("database:", version)
			require.NoError(t, db.Create(&User{Id: 1, Username: "partner", AffCode: "partner1", Group: "default", Status: common.UserStatusEnabled}).Error)
			require.NoError(t, db.Create(&User{Id: 2, Username: "buyer", AffCode: "buyer2", InviterId: 1, CreatedAt: common.GetTimestamp() - 1000, Group: "default", Status: common.UserStatusEnabled}).Error)
			// Upgrade a representative pre-feature top-up schema and preserve its data/index.
			legacy := TopUp{UserId: 2, Amount: 1, Money: 7, TradeNo: "legacy-before-partner", Status: common.TopUpStatusSuccess, CompleteTime: common.GetTimestamp() - 500}
			require.NoError(t, db.Create(&legacy).Error)
			require.NoError(t, db.Migrator().DropColumn(&TopUp{}, "PaidAmount"))
			require.NoError(t, db.Migrator().DropColumn(&TopUp{}, "PaidCurrency"))
			require.NoError(t, db.Migrator().DropColumn(&TopUp{}, "PaidSandbox"))
			require.NoError(t, db.Migrator().DropTable(&PartnerPayout{}, &PartnerCommission{}, &Partner{}))
			for range 2 {
				require.NoError(t, db.AutoMigrate(models...))
			}
			var preserved TopUp
			require.NoError(t, db.First(&preserved, legacy.Id).Error)
			assert.Equal(t, legacy.TradeNo, preserved.TradeNo)
			assert.Equal(t, 7.0, preserved.Money)
			duplicate := TopUp{TradeNo: legacy.TradeNo}
			assert.Error(t, db.Create(&duplicate).Error, "existing trade uniqueness survives upgrade")
			config := PartnerConfig{Enabled: true, CommissionBPS: 1000, MinPayoutCents: 1, AlipayDailyLimitCents: 10000, BankSingleLimitCents: 50000}
			require.NoError(t, UpdatePartnerConfig(config))
			app, err := SubmitPartnerApplication(1, PartnerApplicationInput{Channels: "线下朋友", Plan: "向开发者介绍服务", Contact: "contact"})
			require.NoError(t, err)
			assert.Equal(t, "pending", app.Status)
			require.NoError(t, ReviewPartner(1, 99, "needs_info", "补充渠道说明"))
			_, err = SubmitPartnerApplication(1, PartnerApplicationInput{Channels: "社区", Plan: "分享实际使用经验", Contact: "contact"})
			require.NoError(t, err)
			require.NoError(t, ReviewPartner(1, 99, "approved", "通过"))
			// Use the real successful top-up function: gifted quota is unrelated to cash.
			order := TopUp{UserId: 2, Amount: 100, Money: 70, TradeNo: "paid-one", PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}
			require.NoError(t, order.Insert())
			done, err := RechargeEpay(order.TradeNo, "alipay", "")
			require.NoError(t, err)
			assert.False(t, done)
			done, err = RechargeEpay(order.TradeNo, "alipay", "")
			require.NoError(t, err)
			assert.True(t, done)
			p, err := GetPartner(1)
			require.NoError(t, err)
			assert.Equal(t, int(common.QuotaPerUnit), p.EarnedQuota, "70 CNY at rate 7, 10 percent = 1 USD cash")
			var count int64
			require.NoError(t, db.Model(&PartnerCommission{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			money, err := PartnerMoneyForGroup("default")
			require.NoError(t, err)
			assert.Equal(t, "2", money.CreditPrice)
			input := PartnerPayoutInput{RequestID: "withdraw-request-1", Kind: "alipay", Amount: "3.50", ExchangeRate: money.Quote, RecipientName: "收款人", Account: "test-account"}
			payout, err := CreatePartnerPayout(1, input)
			require.NoError(t, err)
			assert.Equal(t, "pending", payout.Status)
			again, err := CreatePartnerPayout(1, input)
			require.NoError(t, err)
			assert.Equal(t, payout.ID, again.ID)
			changed := input
			changed.Amount = "3.51"
			_, err = CreatePartnerPayout(1, changed)
			assert.ErrorIs(t, err, ErrPartnerInvalid)
			p, err = GetPartner(1)
			require.NoError(t, err)
			assert.Equal(t, int(common.QuotaPerUnit)/2, p.ReservedQuota)
			operation_setting.USDExchangeRate = 8
			again, err = CreatePartnerPayout(1, input)
			require.NoError(t, err)
			assert.Equal(t, payout.ID, again.ID, "retry remains idempotent after rate change")
			changed.RequestID = "withdraw-request-new"
			_, err = CreatePartnerPayout(1, changed)
			assert.ErrorIs(t, err, ErrPartnerQuote)
			operation_setting.USDExchangeRate = 7
			require.NoError(t, ReviewPartnerPayout(payout.ID, 99, "rejected", "收款信息需修改"))
			require.NoError(t, ReviewPartnerPayout(payout.ID, 99, "rejected", "重复"))
			assert.ErrorIs(t, ReviewPartnerPayout(payout.ID, 99, "paid", ""), ErrPartnerState)
			p, err = GetPartner(1)
			require.NoError(t, err)
			assert.Equal(t, 0, p.ReservedQuota)
			assert.Equal(t, p.EarnedQuota, p.AvailableQuota)
			bank := PartnerPayoutInput{RequestID: "bank-request-1", Kind: "bank", Amount: "3.50", ExchangeRate: money.Quote, RecipientName: "测试企业", Account: "123", BankName: "测试银行", CompanyCode: "TEST"}
			payout, err = CreatePartnerPayout(1, bank)
			require.NoError(t, err)
			require.NoError(t, ReviewPartnerPayout(payout.ID, 99, "paid", "站外已转账"))
			require.NoError(t, ReviewPartnerPayout(payout.ID, 99, "paid", "重复"))
			transfer := PartnerPayoutInput{RequestID: "balance-request-1", Kind: "balance", Amount: "3.50", ExchangeRate: money.Quote}
			payout, err = CreatePartnerPayout(1, transfer)
			require.NoError(t, err)
			assert.Equal(t, "paid", payout.Status)
			assert.Equal(t, int(common.QuotaPerUnit*1.75), payout.Quota)
			_, err = CreatePartnerPayout(1, transfer)
			require.NoError(t, err)
			var user User
			require.NoError(t, db.First(&user, 1).Error)
			assert.Equal(t, payout.Quota, user.Quota)
			p, err = GetPartner(1)
			require.NoError(t, err)
			assert.Zero(t, p.AvailableQuota)
			assert.Zero(t, p.ReservedQuota)
			assert.Equal(t, p.EarnedQuota, p.WithdrawnQuota+p.TransferredQuota)
			transfer.RequestID = "balance-request-2"
			_, err = CreatePartnerPayout(1, transfer)
			assert.ErrorIs(t, err, ErrPartnerFunds)
			for _, amount := range []string{"-1", "0", "1.001", "1e999999999", "NaN", "1000000000000000"} {
				transfer.Amount = amount
				_, err = CreatePartnerPayout(1, transfer)
				assert.ErrorIs(t, err, ErrPartnerInvalid)
			}
			// Old first-only settings must not suppress subsequent eligible recharges.
			config.FirstTopupOnly = true
			require.NoError(t, UpdatePartnerConfig(config))
			assert.False(t, GetPartnerConfig().FirstTopupOnly)
			assert.Equal(t, "alipay_native", GetPartnerConfig().BalancePriceSource)
			second := order
			second.Id = 0
			second.TradeNo = "paid-second"
			require.NoError(t, second.Insert())
			_, err = RechargeEpay(second.TradeNo, "alipay", "")
			require.NoError(t, err)
			p, err = GetPartner(1)
			require.NoError(t, err)
			assert.Equal(t, int(common.QuotaPerUnit*2), p.EarnedQuota)
			// A disabled program does not trap already-earned funds.
			config.Enabled = false
			require.NoError(t, UpdatePartnerConfig(config))
			require.NoError(t, ReviewPartner(1, 99, "suspended", "暂时停止推广"))
			// Competing requests cannot both spend the same balance; SQLite may report BUSY.
			start := make(chan struct{})
			results := make(chan error, 2)
			var wg sync.WaitGroup
			for i := range 2 {
				wg.Go(func() {
					<-start
					_, err := CreatePartnerPayout(1, PartnerPayoutInput{RequestID: fmt.Sprintf("concurrent-%d", i), Kind: "alipay", Amount: "7", ExchangeRate: money.Quote, RecipientName: "test", Account: "test"})
					results <- err
				})
			}
			close(start)
			wg.Wait()
			close(results)
			successes := 0
			for err := range results {
				if err == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)
			p, err = GetPartner(1)
			require.NoError(t, err)
			assert.Zero(t, p.AvailableQuota)
			assert.Equal(t, int(common.QuotaPerUnit), p.ReservedQuota)

			// Signed payment facts, not purchased/gifted credits, determine cash commission.
			config.Enabled = true
			require.NoError(t, UpdatePartnerConfig(config))
			require.NoError(t, ReviewPartner(1, 99, "approved", "恢复"))
			before := p.EarnedQuota
			for _, tc := range []struct {
				name, currency string
				sandbox        bool
				added          int
			}{
				{"sandbox", "USD", true, 0},
				{"discounted-live", "USD", false, int(common.QuotaPerUnit / 5)},
				{"unsupported", "EUR", false, 0},
			} {
				payment := TopUp{UserId: 2, Amount: 10, Money: 10, TradeNo: tc.name, PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusPending}
				require.NoError(t, payment.Insert())
				fact := PartnerPayment{Amount: "2", Currency: tc.currency, Sandbox: tc.sandbox}
				require.NoError(t, Recharge(payment.TradeNo, "", "", fact))
				require.NoError(t, Recharge(payment.TradeNo, "", "", fact), "successful Stripe callbacks are idempotent")
				before += tc.added
				p, err = GetPartner(1)
				require.NoError(t, err)
				assert.Equal(t, before, p.EarnedQuota, tc.name)
				if tc.currency == "EUR" {
					var entry PartnerCommission
					require.NoError(t, db.Where("top_up_id = ?", payment.Id).First(&entry).Error)
					assert.Equal(t, "unsupported_currency", entry.Reason)
					assert.Equal(t, "2", entry.PaidAmount)
				}
			}
			// A wallet credit failure rolls back the cash debit and request together.
			require.NoError(t, db.Model(&User{}).Where("id = ?", 1).UpdateColumn("quota", common.MaxWalletQuota).Error)
			_, err = CreatePartnerPayout(1, PartnerPayoutInput{RequestID: "wallet-ceiling", Kind: "balance", Amount: "1", ExchangeRate: money.Quote})
			assert.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)
			after, err := GetPartner(1)
			require.NoError(t, err)
			assert.Equal(t, p.AvailableQuota, after.AvailableQuota)
			require.NoError(t, db.Model(&PartnerPayout{}).Where("request_id = ?", "wallet-ceiling").Count(&count).Error)
			assert.Zero(t, count)
			// Existing rate and price changes are reflected without modifying historical entries.
			setting.AlipayNativeUnitPrice = 4
			newMoney, err := PartnerMoneyForGroup("default")
			require.NoError(t, err)
			assert.Equal(t, "4", newMoney.CreditPrice)
			assert.NotEqual(t, money.Quote, newMoney.Quote)
			setting.AlipayNativeUnitPrice = 2

			// Expired referrals still contribute recharge facts but earn no new commission.
			config.DurationDays = 1
			require.NoError(t, UpdatePartnerConfig(config))
			oldTime := common.GetTimestamp() - 2*86400
			require.NoError(t, db.Model(&User{}).Where("id = ?", 2).UpdateColumn("created_at", oldTime).Error)
			require.NoError(t, db.Model(&Partner{}).Where("user_id = ?", 1).UpdateColumn("approved_at", oldTime).Error)
			expired := TopUp{UserId: 2, Amount: 10, Money: 10, TradeNo: "expired-referral", PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusPending}
			require.NoError(t, expired.Insert())
			require.NoError(t, Recharge(expired.TradeNo, "", "", PartnerPayment{Amount: "10", Currency: "USD"}))
			var expiredEntry PartnerCommission
			require.NoError(t, db.Where("top_up_id = ?", expired.Id).First(&expiredEntry).Error)
			assert.Zero(t, expiredEntry.CommissionQuota)
			assert.Equal(t, int(common.QuotaPerUnit*10), expiredEntry.TopUpQuota)
		})
	}
}

func TestPartnerMoneyUsesConfiguredPrices(t *testing.T) {
	oldPrice, oldRate, oldNative := operation_setting.Price, operation_setting.USDExchangeRate, setting.AlipayNativeUnitPrice
	oldRatio := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		operation_setting.Price, operation_setting.USDExchangeRate, setting.AlipayNativeUnitPrice = oldPrice, oldRate, oldNative
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(oldRatio))
	})
	operation_setting.Price, operation_setting.USDExchangeRate = 2, 7
	setting.AlipayNativeUnitPrice = 0.475
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"partner-price-test":1.25}`))
	money, err := PartnerMoneyForGroup("partner-price-test")
	require.NoError(t, err)
	assert.Equal(t, "0.59375", money.CreditPrice)
	assert.Equal(t, "7", money.CashExchangeRate)
	setting.AlipayNativeUnitPrice = 0.8
	updated, err := PartnerMoneyForGroup("partner-price-test")
	require.NoError(t, err)
	assert.Equal(t, "1", updated.CreditPrice)
	assert.NotEqual(t, money.Quote, updated.Quote, "changing the checkout price invalidates the old transfer quote")
	setting.AlipayNativeUnitPrice = 0
	_, err = PartnerMoneyForGroup("partner-price-test")
	assert.ErrorIs(t, err, ErrPartnerQuote)
}

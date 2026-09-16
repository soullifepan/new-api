package model

import (
	"errors"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func insertUserForPaymentGuardTest(t *testing.T, id int, quota int) *User {
	t.Helper()
	user := &User{
		Id:       id,
		Username: "payment_guard_user",
		Status:   common.UserStatusEnabled,
		Quota:    quota,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func TestAlipayNativeConfigPersistenceOnExternalDatabases(t *testing.T) {
	for _, tc := range []struct {
		name   string
		env    string
		dbType common.DatabaseType
		open   func(string) gorm.Dialector
	}{
		{name: "mysql", env: "TEST_MYSQL_DSN", dbType: common.DatabaseTypeMySQL, open: mysql.Open},
		{name: "postgres", env: "TEST_POSTGRES_DSN", dbType: common.DatabaseTypePostgreSQL, open: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dsn := os.Getenv(tc.env)
			if dsn == "" {
				t.Skipf("%s is not configured", tc.env)
			}
			db, err := gorm.Open(tc.open(dsn), &gorm.Config{})
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			previousOptions := common.OptionMap
			common.OptionMap = make(map[string]string)
			DB = db
			common.SetDatabaseTypes(tc.dbType, common.DatabaseTypeSQLite)
			initCol()
			t.Cleanup(func() {
				DB = oldDB
				common.OptionMap = previousOptions
				common.SetDatabaseTypes(oldType, common.DatabaseTypeSQLite)
				initCol()
			})
			require.NoError(t, db.AutoMigrate(&Option{}, &TopUp{}))
			require.NoError(t, db.Where("payment_provider = ?", PaymentProviderAlipayNative).Delete(&TopUp{}).Error)
			require.NoError(t, db.Where(commonKeyCol+" IN ?", alipayNativeConfigKeys).Delete(&Option{}).Error)

			config := AlipayNativeConfig{Enabled: true, AppID: "external-app", SellerID: "external-seller", PrivateKey: "external-key", PublicKey: "external-public", UnitPrice: 1, MinTopUp: 1}
			require.NoError(t, UpdateAlipayNativeConfig(config))
			loaded, err := GetAlipayNativeConfig()
			require.NoError(t, err)
			assert.Equal(t, config, loaded)

			baseOrder := TopUp{
				UserId:          9001,
				Amount:          1,
				Money:           7,
				TradeNo:         "alipay-native-same-amount-1",
				PaymentMethod:   "alipay_native",
				PaymentProvider: PaymentProviderAlipayNative,
				Status:          common.TopUpStatusPending,
				CreateTime:      time.Now().Unix(),
			}
			require.NoError(t, CreateAlipayNativeTopUp(&baseOrder, config))

			sameAmount := baseOrder
			sameAmount.Id = 0
			sameAmount.TradeNo = "alipay-native-same-amount-2"
			require.ErrorIs(t, CreateAlipayNativeTopUp(&sameAmount, config), ErrAlipayNativePendingOrders)

			differentAmount := baseOrder
			differentAmount.Id = 0
			differentAmount.TradeNo = "alipay-native-different-amount"
			differentAmount.Amount = 2
			differentAmount.Money = 14
			require.NoError(t, CreateAlipayNativeTopUp(&differentAmount, config))

			start := make(chan struct{})
			results := make(chan error, 2)
			var wg sync.WaitGroup
			for i := range 2 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					concurrent := baseOrder
					concurrent.Id = 0
					concurrent.TradeNo = "alipay-native-concurrent-" + strconv.Itoa(i)
					concurrent.Amount = 3
					concurrent.Money = 21
					<-start
					results <- CreateAlipayNativeTopUp(&concurrent, config)
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			var created, rejected int
			for err := range results {
				switch {
				case err == nil:
					created++
				case errors.Is(err, ErrAlipayNativePendingOrders):
					rejected++
				default:
					require.NoError(t, err)
				}
			}
			assert.Equal(t, 1, created)
			assert.Equal(t, 1, rejected)
		})
	}
}

func insertSubscriptionPlanForPaymentGuardTest(t *testing.T, id int) *SubscriptionPlan {
	t.Helper()
	plan := &SubscriptionPlan{
		Id:            id,
		Title:         "Guard Plan",
		PriceAmount:   9.99,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   1000,
	}
	require.NoError(t, DB.Create(plan).Error)
	return plan
}

func insertSubscriptionOrderForPaymentGuardTest(t *testing.T, tradeNo string, userID int, planID int, paymentProvider string) {
	t.Helper()
	order := &SubscriptionOrder{
		UserId:          userID,
		PlanId:          planID,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentProvider,
		PaymentProvider: paymentProvider,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, order.Insert())
}

func insertTopUpForPaymentGuardTest(t *testing.T, tradeNo string, userID int, paymentProvider string) {
	t.Helper()
	topUp := &TopUp{
		UserId:          userID,
		Amount:          2,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentProvider,
		PaymentProvider: paymentProvider,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, topUp.Insert())
}

func getTopUpStatusForPaymentGuardTest(t *testing.T, tradeNo string) string {
	t.Helper()
	topUp := GetTopUpByTradeNo(tradeNo)
	require.NotNil(t, topUp)
	return topUp.Status
}

func countUserSubscriptionsForPaymentGuardTest(t *testing.T, userID int) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", userID).Count(&count).Error)
	return count
}

func getUserQuotaForPaymentGuardTest(t *testing.T, userID int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.Select("quota").Where("id = ?", userID).First(&user).Error)
	return user.Quota
}

func TestRechargeWaffoPancake_RejectsMismatchedPaymentMethod(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 101, 0)
	insertTopUpForPaymentGuardTest(t, "waffo-pancake-guard", 101, PaymentProviderStripe)

	err := RechargeWaffoPancake("waffo-pancake-guard")
	require.Error(t, err)

	topUp := GetTopUpByTradeNo("waffo-pancake-guard")
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusPending, topUp.Status)
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, 101))
}

func TestUpdatePendingTopUpStatus_RejectsMismatchedPaymentProvider(t *testing.T) {
	testCases := []struct {
		name                    string
		tradeNo                 string
		storedPaymentProvider   string
		expectedPaymentProvider string
		targetStatus            string
	}{
		{
			name:                    "stripe expire",
			tradeNo:                 "stripe-expire-guard",
			storedPaymentProvider:   PaymentProviderCreem,
			expectedPaymentProvider: PaymentProviderStripe,
			targetStatus:            common.TopUpStatusExpired,
		},
		{
			name:                    "waffo failed",
			tradeNo:                 "waffo-failed-guard",
			storedPaymentProvider:   PaymentProviderStripe,
			expectedPaymentProvider: PaymentProviderWaffo,
			targetStatus:            common.TopUpStatusFailed,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			insertUserForPaymentGuardTest(t, 150, 0)
			insertTopUpForPaymentGuardTest(t, tc.tradeNo, 150, tc.storedPaymentProvider)

			err := UpdatePendingTopUpStatus(tc.tradeNo, tc.expectedPaymentProvider, tc.targetStatus)
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, tc.tradeNo))
		})
	}
}

func TestCompleteSubscriptionOrder_RejectsMismatchedPaymentProvider(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 202, 0)
	plan := insertSubscriptionPlanForPaymentGuardTest(t, 301)
	insertSubscriptionOrderForPaymentGuardTest(t, "sub-guard-order", 202, plan.Id, PaymentProviderStripe)

	err := CompleteSubscriptionOrder("sub-guard-order", `{"provider":"epay"}`, PaymentProviderEpay, "alipay")
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)

	order := GetSubscriptionOrderByTradeNo("sub-guard-order")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	assert.Zero(t, countUserSubscriptionsForPaymentGuardTest(t, 202))

	topUp := GetTopUpByTradeNo("sub-guard-order")
	assert.Nil(t, topUp)
}

func TestExpireSubscriptionOrder_RejectsMismatchedPaymentProvider(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 303, 0)
	plan := insertSubscriptionPlanForPaymentGuardTest(t, 401)
	insertSubscriptionOrderForPaymentGuardTest(t, "sub-expire-guard", 303, plan.Id, PaymentProviderStripe)

	err := ExpireSubscriptionOrder("sub-expire-guard", PaymentProviderCreem)
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)

	order := GetSubscriptionOrderByTradeNo("sub-expire-guard")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
}

func createEpayTestOrder(t *testing.T, userId int, tradeNo string, provider string, status string) TopUp {
	t.Helper()
	topUp := TopUp{
		UserId:          userId,
		Amount:          2,
		Money:           10.0,
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: provider,
		CreateTime:      common.GetTimestamp(),
		Status:          status,
	}
	require.NoError(t, DB.Create(&topUp).Error)
	return topUp
}

func TestRechargeEpayCreditsQuotaExactlyOnce(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 501, 0)
	order := createEpayTestOrder(t, user.Id, "EPAYTESTONCE", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))

	reloaded := GetTopUpByTradeNo(order.TradeNo)
	require.NotNil(t, reloaded)
	assert.Equal(t, common.TopUpStatusSuccess, reloaded.Status)
	assert.NotZero(t, reloaded.CompleteTime)

	alreadyDone, err = RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
}

func TestRechargeAlipayNativeCreditsExactlyOnceAndSeparatesSandbox(t *testing.T) {
	truncateTables(t)
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 507, 0)
	order := TopUp{UserId: user.Id, Amount: 2, Money: 10, TradeNo: "ALIPAYNATIVEONCE", PaymentMethod: "alipay_native_sandbox", PaymentProvider: PaymentProviderAlipayNative, CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())

	_, err := RechargeAlipayNative(order.TradeNo, false, "127.0.0.1")
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)
	assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))

	alreadyDone, err := RechargeAlipayNative(order.TradeNo, true, "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
	alreadyDone, err = RechargeAlipayNative(order.TradeNo, true, "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
}

func TestRechargeAlipayNativeConcurrentCallbacksCreditOnceAndRespectWalletLimit(t *testing.T) {
	truncateTables(t)
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })
	user := insertUserForPaymentGuardTest(t, 508, 0)
	order := &TopUp{UserId: user.Id, Amount: 2, Money: 2, TradeNo: "ALIPAYNATIVECONCURRENT", PaymentMethod: "alipay_native", PaymentProvider: PaymentProviderAlipayNative, CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())
	var waitGroup sync.WaitGroup
	errors := make(chan error, 2)
	for range 2 {
		waitGroup.Go(func() {
			_, err := RechargeAlipayNative(order.TradeNo, false, "127.0.0.1")
			errors <- err
		})
	}
	waitGroup.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))

	limited := &User{Id: 509, Username: "payment_guard_limit_user", AffCode: "payment_guard_limit_aff", Status: common.UserStatusEnabled, Quota: common.MaxWalletQuota - 500000}
	require.NoError(t, DB.Create(limited).Error)
	limitOrder := &TopUp{UserId: limited.Id, Amount: 2, Money: 2, TradeNo: "ALIPAYNATIVELIMIT", PaymentMethod: "alipay_native", PaymentProvider: PaymentProviderAlipayNative, CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}
	require.NoError(t, limitOrder.Insert())
	_, err := RechargeAlipayNative(limitOrder.TradeNo, false, "127.0.0.1")
	require.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)
	assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, limitOrder.TradeNo))
}

func TestCreateAlipayNativeTopUpRejectsStaleConfigurationSnapshot(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Option{}))
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	config := AlipayNativeConfig{Enabled: true, AppID: "app-a", SellerID: "seller-a", PrivateKey: "key-a", PublicKey: "public-a", UnitPrice: 1, MinTopUp: 1}
	require.NoError(t, UpdateAlipayNativeConfig(config))
	require.NoError(t, UpdateAlipayNativeConfig(AlipayNativeConfig{Enabled: true, AppID: "app-a", SellerID: "seller-a", PrivateKey: "key-a", PublicKey: "public-a", UnitPrice: 2, MinTopUp: 1}))

	order := &TopUp{UserId: 507, Amount: 1, Money: 1, TradeNo: "ALIPAYNATIVESTALE", PaymentProvider: PaymentProviderAlipayNative, Status: common.TopUpStatusPending}
	err := CreateAlipayNativeTopUp(order, config)
	require.ErrorIs(t, err, ErrAlipayNativeConfigChanged)
	assert.Nil(t, GetTopUpByTradeNo(order.TradeNo))
}

func TestUpdateAlipayNativeConfigProtectsPendingOrderIdentityOnly(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Option{}))
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	config := AlipayNativeConfig{Enabled: true, AppID: "app-a", SellerID: "seller-a", PrivateKey: "key-a", PublicKey: "public-a", UnitPrice: 1, MinTopUp: 1}
	require.NoError(t, UpdateAlipayNativeConfig(config))
	require.NoError(t, (&TopUp{UserId: 507, Amount: 1, Money: 1, TradeNo: "ALIPAYNATIVEPENDING", PaymentMethod: "alipay_native", PaymentProvider: PaymentProviderAlipayNative, CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}).Insert())

	err := UpdateAlipayNativeConfig(AlipayNativeConfig{Enabled: false, AppID: "app-b", SellerID: "seller-a", PrivateKey: "key-a", PublicKey: "public-a", UnitPrice: 2, MinTopUp: 1})
	require.ErrorIs(t, err, ErrAlipayNativePendingOrders)
	require.NoError(t, UpdateAlipayNativeConfig(AlipayNativeConfig{Enabled: false, AppID: "app-a", SellerID: "seller-a", PrivateKey: "key-a", PublicKey: "public-a", UnitPrice: 2, MinTopUp: 1}))
}

func TestCloseAlipayNativeTopUpRejectsWrongEnvironmentAndExpiresPendingOrder(t *testing.T) {
	truncateTables(t)
	order := &TopUp{UserId: 507, Amount: 1, Money: 1, TradeNo: "ALIPAYNATIVECLOSED", PaymentMethod: "alipay_native_sandbox", PaymentProvider: PaymentProviderAlipayNative, CreateTime: common.GetTimestamp(), Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())

	require.ErrorIs(t, CloseAlipayNativeTopUp(order.TradeNo, false), ErrPaymentMethodMismatch)
	require.NoError(t, CloseAlipayNativeTopUp(order.TradeNo, true))
	assert.Equal(t, common.TopUpStatusExpired, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))
}

func TestRechargeEpayKeepsRedisAndDatabaseCreditInSync(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 5
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 502, 7)
	require.NoError(t, populateUserCache(*user))
	order := createEpayTestOrder(t, user.Id, "EPAYTESTREDISSYNC", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 17, getUserQuotaForPaymentGuardTest(t, user.Id))
	cached, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 17, cached.Quota)

	alreadyDone, err = RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	cached, err = cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 17, cached.Quota)
}

func TestRechargeEpayUpdatesPaymentMethodToActual(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 503, 0)
	order := createEpayTestOrder(t, user.Id, "EPAYTESTMETHOD", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "wxpay", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)

	reloaded := GetTopUpByTradeNo(order.TradeNo)
	require.NotNil(t, reloaded)
	assert.Equal(t, "wxpay", reloaded.PaymentMethod)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
}

func TestRechargeEpayRejectsForeignAndNonPendingOrders(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 504, 7)

	t.Run("order from another payment provider", func(t *testing.T) {
		order := createEpayTestOrder(t, user.Id, "EPAYTESTSTRIPE", PaymentProviderStripe, common.TopUpStatusPending)
		_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
		assert.ErrorIs(t, err, ErrPaymentMethodMismatch)
		assert.Equal(t, 7, getUserQuotaForPaymentGuardTest(t, user.Id))
	})

	t.Run("order that is not pending", func(t *testing.T) {
		order := createEpayTestOrder(t, user.Id, "EPAYTESTEXPIRED", PaymentProviderEpay, common.TopUpStatusExpired)
		_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
		assert.ErrorIs(t, err, ErrTopUpStatusInvalid)
		assert.Equal(t, 7, getUserQuotaForPaymentGuardTest(t, user.Id))
	})

	t.Run("missing order", func(t *testing.T) {
		_, err := RechargeEpay("EPAYTESTMISSING", "alipay", "127.0.0.1")
		assert.ErrorIs(t, err, ErrTopUpNotFound)
	})
}

func TestRechargeEpayRejectsQuotaOverflowBeforeCompletingOrder(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = float64(common.MaxWalletQuota + 1)
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 505, 3)
	order := createEpayTestOrder(t, user.Id, "EPAYTESTOVERFLOW", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.Error(t, err)
	assert.Equal(t, 3, getUserQuotaForPaymentGuardTest(t, user.Id))
	assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))
}

func TestRechargeEpayEnforcesFinalWalletQuotaLimit(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	testCases := []struct {
		name         string
		currentQuota int
		wantErr      bool
		wantQuota    int
		wantStatus   string
	}{
		{
			name:         "allows exact highest representable wallet balance",
			currentQuota: common.MaxWalletQuota - 1_000_000,
			wantQuota:    common.MaxWalletQuota,
			wantStatus:   common.TopUpStatusSuccess,
		},
		{
			name:         "rejects balance above wallet quota domain",
			currentQuota: common.MaxWalletQuota - 999_999,
			wantErr:      true,
			wantQuota:    common.MaxWalletQuota - 999_999,
			wantStatus:   common.TopUpStatusPending,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			user := insertUserForPaymentGuardTest(t, 506, tc.currentQuota)
			order := createEpayTestOrder(t, user.Id, "EPAYTESTWALLETLIMIT", PaymentProviderEpay, common.TopUpStatusPending)

			_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
			if tc.wantErr {
				require.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tc.wantQuota, getUserQuotaForPaymentGuardTest(t, user.Id))
			assert.Equal(t, tc.wantStatus, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))
		})
	}
}

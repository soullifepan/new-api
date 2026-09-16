package controller

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	alipay "github.com/smartwalle/alipay/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAlipayNativeCheckoutGuard(t *testing.T) {
	_, config, user := setupAlipayNativeControllerTest(t)
	server := miniredis.RunT(t)
	oldRedis := common.RDB
	common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	common.RedisEnabled = true
	t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = oldRedis })
	ctx := context.Background()
	guard, err := lockAlipayNativeCheckout(ctx, user.Id)
	require.NoError(t, err)
	_, err = lockAlipayNativeCheckout(ctx, user.Id)
	require.Error(t, err)
	require.NoError(t, guard.AllowNew(ctx))
	require.Error(t, guard.AllowNew(ctx))
	order := &model.TopUp{UserId: user.Id, Amount: 1, Money: 1, TradeNo: "reuse", PaymentMethod: "alipay_native_sandbox", PaymentProvider: model.PaymentProviderAlipayNative, Status: common.TopUpStatusPending, CreateTime: time.Now().Unix()}
	require.NoError(t, model.CreateAlipayNativeTopUp(order, config))
	payment := alipayNativePayment{TradeNo: order.TradeNo, QRCode: "https://qr.alipay.com/test", Amount: "1.00", Currency: "CNY", Sandbox: true}
	require.NoError(t, guard.Save(ctx, payment))
	ttl := server.TTL(guard.cacheKey + ":" + order.TradeNo)
	assert.GreaterOrEqual(t, ttl, alipayNativeQRCodeCacheTTL-time.Second)
	reused, err := guard.Existing(ctx, 1, "1.00", true)
	require.NoError(t, err)
	require.Equal(t, &payment, reused)
	reused, err = guard.Existing(ctx, 2, "2.00", true)
	require.NoError(t, err)
	require.Nil(t, reused)
	assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo(order.TradeNo).Status, "a different quote must not close its still-valid QR")
	second := *order
	second.Id = 0
	second.TradeNo = "different-amount"
	second.Amount = 2
	second.Money = 2
	require.NoError(t, model.CreateAlipayNativeTopUp(&second, config))
	secondPayment := payment
	secondPayment.TradeNo = second.TradeNo
	secondPayment.Amount = "2.00"
	require.NoError(t, guard.Save(ctx, secondPayment))
	for _, expected := range []alipayNativePayment{payment, secondPayment} {
		amount := int64(1)
		if expected.Amount == "2.00" {
			amount = 2
		}
		reused, err = guard.Existing(ctx, amount, expected.Amount, true)
		require.NoError(t, err)
		require.Equal(t, &expected, reused)
	}
	// Cache eviction must not return a QR; the pending order remains independent
	// and is reconciled only by its own callback or expiry task.
	server.Del(guard.cacheKey + ":" + order.TradeNo)
	reused, err = guard.Existing(ctx, 1, "1.00", true)
	require.NoError(t, err)
	require.Nil(t, reused)
	duplicate := *order
	duplicate.Id = 0
	duplicate.TradeNo = "duplicate"
	require.ErrorIs(t, model.CreateAlipayNativeTopUp(&duplicate, config), model.ErrAlipayNativePendingOrders)
	// An expired lock owner cannot delete a new owner's lock.
	server.FastForward(time.Minute)
	next, err := lockAlipayNativeCheckout(ctx, user.Id)
	require.NoError(t, err)
	guard.Release()
	_, err = lockAlipayNativeCheckout(ctx, user.Id)
	require.Error(t, err)
	next.Release()
	require.NoError(t, guard.Save(ctx, payment))
	require.NoError(t, model.UpdatePendingTopUpStatus(order.TradeNo, model.PaymentProviderAlipayNative, common.TopUpStatusFailed))
	reused, err = guard.Existing(ctx, 1, "1.00", true)
	require.NoError(t, err)
	require.Nil(t, reused, "terminal database state must override a cached QR code")
	server.SetError("redis unavailable")
	_, err = lockAlipayNativeCheckout(ctx, user.Id)
	require.Error(t, err)
	common.RedisEnabled = false
	_, err = lockAlipayNativeCheckout(ctx, user.Id)
	require.Error(t, err)
}

type alipayReconcileStub struct {
	query    *alipay.TradeQueryRsp
	queryErr error
	close    *alipay.TradeCloseRsp
	closeErr error
	closed   bool
}

func (s *alipayReconcileStub) TradeQuery(context.Context, alipay.TradeQuery) (*alipay.TradeQueryRsp, error) {
	return s.query, s.queryErr
}

func (s *alipayReconcileStub) TradeClose(context.Context, alipay.TradeClose) (*alipay.TradeCloseRsp, error) {
	s.closed = true
	return s.close, s.closeErr
}

func TestAlipayNativeReconcile(t *testing.T) {
	for _, tc := range []struct {
		name         string
		age          time.Duration
		status       alipay.TradeStatus
		queryErr     error
		closeErr     error
		wrongClose   bool
		missingClose bool
		want         string
		wantClose    bool
		wantErr      bool
	}{
		{"not due", time.Minute, alipay.TradeStatusWaitBuyerPay, nil, nil, false, false, common.TopUpStatusPending, false, false},
		{"due close", 11 * time.Minute, alipay.TradeStatusWaitBuyerPay, nil, nil, false, false, common.TopUpStatusExpired, true, false},
		{"old QR later paid", 11 * time.Minute, alipay.TradeStatusSuccess, nil, nil, false, false, common.TopUpStatusSuccess, false, false},
		{"already closed", 11 * time.Minute, alipay.TradeStatusClosed, nil, nil, false, false, common.TopUpStatusExpired, false, false},
		{"query timeout", 11 * time.Minute, "", errors.New("timeout"), nil, false, false, common.TopUpStatusPending, false, true},
		{"valid precreated QR not found stays pending", time.Minute, "", &alipay.Error{Code: "40004", SubCode: "ACQ.TRADE_NOT_EXIST"}, nil, false, false, common.TopUpStatusPending, false, false},
		{"expired QR not found is terminal", 11 * time.Minute, "", &alipay.Error{Code: "40004", SubCode: "ACQ.TRADE_NOT_EXIST"}, nil, false, false, common.TopUpStatusExpired, false, false},
		{"close timeout", 11 * time.Minute, alipay.TradeStatusWaitBuyerPay, nil, errors.New("timeout"), false, false, common.TopUpStatusPending, true, true},
		{"wrong close identity", 11 * time.Minute, alipay.TradeStatusWaitBuyerPay, nil, nil, true, false, common.TopUpStatusPending, true, true},
		{"close response missing out trade number", 11 * time.Minute, alipay.TradeStatusWaitBuyerPay, nil, nil, false, true, common.TopUpStatusPending, true, true},
		{"close terminal without out trade number", 11 * time.Minute, alipay.TradeStatusWaitBuyerPay, nil, &alipay.Error{Code: "40004", SubCode: "ACQ.TRADE_NOT_EXIST"}, false, false, common.TopUpStatusExpired, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, config, user := setupAlipayNativeControllerTest(t)
			now := time.Unix(1800000000, 0)
			order := &model.TopUp{UserId: user.Id, Amount: 1, Money: 1, TradeNo: "reconcile", PaymentMethod: "alipay_native_sandbox", PaymentProvider: model.PaymentProviderAlipayNative, Status: common.TopUpStatusPending, CreateTime: now.Add(-tc.age).Unix()}
			require.NoError(t, order.Insert())
			client := &alipayReconcileStub{query: &alipay.TradeQueryRsp{Error: alipay.Error{Code: "10000"}, OutTradeNo: order.TradeNo, TotalAmount: "1.00", TradeStatus: tc.status}, queryErr: tc.queryErr, close: &alipay.TradeCloseRsp{Error: alipay.Error{Code: "10000"}, OutTradeNo: order.TradeNo}, closeErr: tc.closeErr}
			if tc.queryErr != nil {
				client.query = nil
			}
			if tc.wrongClose {
				client.close.OutTradeNo = "other"
			}
			if tc.missingClose {
				client.close.OutTradeNo = ""
			}
			err := reconcileAlipayNativeOrder(context.Background(), client, order, config.Sandbox, "", now)
			if tc.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tc.want, model.GetTopUpByTradeNo(order.TradeNo).Status)
			assert.Equal(t, tc.wantClose, client.closed)
			require.NoError(t, model.DB.First(user, user.Id).Error)
			if tc.want == common.TopUpStatusSuccess {
				assert.Equal(t, int(common.QuotaPerUnit), user.Quota)
			} else {
				assert.Zero(t, user.Quota)
			}
		})
	}
}

func TestAlipayNativePendingScanAndTerminalSafety(t *testing.T) {
	_, config, user := setupAlipayNativeControllerTest(t)
	for _, order := range []model.TopUp{
		{TradeNo: "old", CreateTime: 10, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderAlipayNative, PaymentMethod: "alipay_native_sandbox", UserId: user.Id, Amount: 1, Money: 1},
		{TradeNo: "new", CreateTime: 30, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderAlipayNative},
		{TradeNo: "paid", CreateTime: 10, Status: common.TopUpStatusSuccess, PaymentProvider: model.PaymentProviderAlipayNative},
		{TradeNo: "other", CreateTime: 10, Status: common.TopUpStatusPending, PaymentProvider: "other"},
	} {
		require.NoError(t, model.DB.Create(&order).Error)
	}
	orders, err := model.PendingAlipayNativeTopUps(0, 20)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	assert.Equal(t, "old", orders[0].TradeNo)
	next, err := model.PendingAlipayNativeTopUps(orders[0].Id, 20)
	require.NoError(t, err)
	assert.Empty(t, next)
	// A success committed by a callback must never be overwritten by closure.
	_, err = model.RechargeAlipayNative("old", config.Sandbox, "")
	require.NoError(t, err)
	require.ErrorIs(t, model.CloseAlipayNativeTopUp("old", config.Sandbox), model.ErrTopUpStatusInvalid)
	assert.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo("old").Status)
	require.NoError(t, model.DB.First(user, user.Id).Error)
	assert.Equal(t, int(common.QuotaPerUnit), user.Quota)
}

func TestAlipayNativeQueryResult(t *testing.T) {
	for _, tc := range []struct {
		name      string
		rsp       *alipay.TradeQueryRsp
		err       error
		wantError bool
	}{
		{"unsigned not yet created", nil, &alipay.Error{Code: "40004", SubCode: "ACQ.TRADE_NOT_EXIST"}, false},
		{"signed not yet created", &alipay.TradeQueryRsp{Error: alipay.Error{Code: "40004", SubCode: "ACQ.TRADE_NOT_EXIST"}}, nil, false},
		{"other business error", nil, &alipay.Error{Code: "40004", SubCode: "ACQ.SYSTEM_ERROR"}, true},
		{"transport error", nil, errors.New("timeout"), true},
		{"empty response", nil, nil, true},
		{"wrong order", &alipay.TradeQueryRsp{Error: alipay.Error{Code: "10000"}, OutTradeNo: "other"}, nil, true},
		{"matching order", &alipay.TradeQueryRsp{Error: alipay.Error{Code: "10000"}, OutTradeNo: "order"}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAlipayNativeQueryResult("order", tc.rsp, tc.err)
			if tc.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func setupAlipayNativeControllerTest(t *testing.T) (*rsa.PrivateKey, model.AlipayNativeConfig, *model.User) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.TopUp{}, &model.User{}, &model.Log{}))
	oldDB, oldLogDB, oldType := model.DB, model.LOG_DB, common.MainDatabaseType()
	oldRedisEnabled := common.RedisEnabled
	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.SetDatabaseTypes(oldType, common.DatabaseTypeSQLite)
		common.RedisEnabled = oldRedisEnabled
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	publicKey, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	require.NoError(t, err)
	config := model.AlipayNativeConfig{Enabled: true, Sandbox: true, AppID: "test-app", SellerID: "test-seller", PrivateKey: string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})), PublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicKey})), UnitPrice: 1, MinTopUp: 1}
	require.NoError(t, model.UpdateAlipayNativeConfig(config))
	user := &model.User{Id: 991, Username: "alipay-native-test", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	return privateKey, config, user
}

func signedAlipayNativeForm(t *testing.T, privateKey *rsa.PrivateKey, values url.Values) string {
	t.Helper()
	keys := make([]string, 0, len(values))
	for key := range values {
		if key != "sign" && key != "sign_type" && key != "alipay_cert_sn" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, key := range keys {
		for _, value := range values[key] {
			pairs = append(pairs, key+"="+value)
		}
	}
	hash := sha256.Sum256([]byte(strings.Join(pairs, "&")))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hash[:])
	require.NoError(t, err)
	values.Set("sign_type", "RSA2")
	values.Set("sign", base64.StdEncoding.EncodeToString(signature))
	return values.Encode()
}

func TestAlipayNativeNotifyVerifiesSignatureIdentityAmountAndIdempotency(t *testing.T) {
	gin.SetMode(gin.TestMode)
	privateKey, config, user := setupAlipayNativeControllerTest(t)
	order := &model.TopUp{UserId: user.Id, Amount: 2, Money: 2, TradeNo: "ALIPAYNOTIFYONCE", PaymentMethod: "alipay_native_sandbox", PaymentProvider: model.PaymentProviderAlipayNative, Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())

	request := func(values url.Values) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		router := gin.New()
		router.POST("/api/alipay/notify", AlipayNativeNotify)
		request := httptest.NewRequest(http.MethodPost, "/api/alipay/notify", strings.NewReader(signedAlipayNativeForm(t, privateKey, values)))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		router.ServeHTTP(recorder, request)
		return recorder
	}
	base := url.Values{"app_id": {config.AppID}, "seller_id": {config.SellerID}, "out_trade_no": {order.TradeNo}, "total_amount": {"2.00"}, "trade_status": {"TRADE_SUCCESS"}}
	first := request(base)
	assert.Equal(t, http.StatusOK, first.Code)
	second := request(base)
	assert.Equal(t, http.StatusOK, second.Code)
	reloaded := model.GetTopUpByTradeNo(order.TradeNo)
	require.NotNil(t, reloaded)
	assert.Equal(t, common.TopUpStatusSuccess, reloaded.Status)

	disabledOrder := &model.TopUp{UserId: user.Id, Amount: 1, Money: 1, TradeNo: "ALIPAYNOTIFYDISABLED", PaymentMethod: "alipay_native_sandbox", PaymentProvider: model.PaymentProviderAlipayNative, Status: common.TopUpStatusPending}
	require.NoError(t, disabledOrder.Insert())
	config.Enabled = false
	require.NoError(t, model.UpdateAlipayNativeConfig(config))
	disabledNotice := url.Values{"app_id": {config.AppID}, "seller_id": {config.SellerID}, "out_trade_no": {disabledOrder.TradeNo}, "total_amount": {"1.00"}, "trade_status": {"TRADE_SUCCESS"}}
	assert.Equal(t, http.StatusOK, request(disabledNotice).Code)
	assert.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo(disabledOrder.TradeNo).Status)

	for _, mutate := range []func(url.Values){
		func(v url.Values) { v.Set("sign", "not-a-signature") },
		func(v url.Values) { v.Set("app_id", "wrong-app") },
		func(v url.Values) { v.Set("seller_id", "wrong-seller") },
		func(v url.Values) { v.Set("total_amount", "3.00") },
	} {
		values := url.Values{"app_id": {config.AppID}, "seller_id": {config.SellerID}, "out_trade_no": {order.TradeNo}, "total_amount": {"2.00"}, "trade_status": {"TRADE_SUCCESS"}}
		body := signedAlipayNativeForm(t, privateKey, values)
		if values.Get("sign") != "" { // preserve a deliberately invalid signature below
			mutate(values)
			if values.Get("sign") == "not-a-signature" {
				body = values.Encode()
			} else {
				body = signedAlipayNativeForm(t, privateKey, values)
			}
		}
		recorder := httptest.NewRecorder()
		router := gin.New()
		router.POST("/api/alipay/notify", AlipayNativeNotify)
		request := httptest.NewRequest(http.MethodPost, "/api/alipay/notify", bytes.NewBufferString(body))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		router.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
	}
}

func TestAlipayNativeConfigHidesPrivateKeyAndOrderLookupScopesOwner(t *testing.T) {
	gin.SetMode(gin.TestMode)
	_, config, user := setupAlipayNativeControllerTest(t)
	order := &model.TopUp{UserId: user.Id, Amount: 1, Money: 1, TradeNo: "ALIPAYPRIVATEORDER", PaymentMethod: "alipay_native_sandbox", PaymentProvider: model.PaymentProviderAlipayNative, Status: common.TopUpStatusSuccess}
	require.NoError(t, order.Insert())

	configRecorder := httptest.NewRecorder()
	configRouter := gin.New()
	configRouter.GET("/api/option/alipay-native/config", GetAlipayNativeConfig)
	configRouter.ServeHTTP(configRecorder, httptest.NewRequest(http.MethodGet, "/api/option/alipay-native/config", nil))
	assert.Equal(t, http.StatusOK, configRecorder.Code)
	assert.NotContains(t, configRecorder.Body.String(), config.PrivateKey)
	assert.Contains(t, configRecorder.Body.String(), "AlipayNativePrivateKeyConfigured")

	orderRecorder := httptest.NewRecorder()
	orderRouter := gin.New()
	orderRouter.GET("/api/user/alipay/order/:trade_no", func(c *gin.Context) { c.Set("id", user.Id+1); GetAlipayNativeOrder(c) })
	orderRouter.ServeHTTP(orderRecorder, httptest.NewRequest(http.MethodGet, "/api/user/alipay/order/"+order.TradeNo, nil))
	assert.Equal(t, http.StatusNotFound, orderRecorder.Code)
}

package controller

import (
	"bytes"
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

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	alipay "github.com/smartwalle/alipay/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

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

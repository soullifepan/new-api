package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	alipay "github.com/smartwalle/alipay/v3"
)

const (
	alipayNativeOrderTimeout   = 10 * time.Minute
	alipayNativeQRCodeCacheTTL = 15 * time.Minute
)

func isAlipayNativeTopUpEnabled() bool {
	config, err := model.GetAlipayNativeConfig()
	return err == nil && isAlipayNativeConfigEnabled(config)
}

func isAlipayNativeConfigEnabled(config model.AlipayNativeConfig) bool {
	if !isPaymentComplianceConfirmed() || !config.Enabled {
		return false
	}
	return validateAlipayNativeConfig(config, true) == nil
}

func validateAlipayNativeConfig(config model.AlipayNativeConfig, requireEnabled bool) error {
	if !config.Enabled && !requireEnabled && strings.TrimSpace(config.AppID) == "" && strings.TrimSpace(config.SellerID) == "" && strings.TrimSpace(config.PrivateKey) == "" && strings.TrimSpace(config.PublicKey) == "" && strings.TrimSpace(config.AppCert) == "" && strings.TrimSpace(config.AlipayCert) == "" && strings.TrimSpace(config.RootCert) == "" {
		return nil
	}
	_, err := newAlipayNativeClient(config, requireEnabled)
	return err
}

func newAlipayNativeClient(config model.AlipayNativeConfig, requireEnabled bool) (*alipay.Client, error) {
	if err := validateAlipayNativeConfigFields(config, requireEnabled); err != nil {
		return nil, err
	}
	client, err := alipay.New(config.AppID, config.PrivateKey, !config.Sandbox)
	if err != nil {
		return nil, err
	}
	client.Client = &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if config.AppCert != "" {
		if err := client.LoadAppCertPublicKey(config.AppCert); err != nil {
			return nil, err
		}
		if err := client.LoadAlipayCertPublicKey(config.AlipayCert); err != nil {
			return nil, err
		}
		if err := client.LoadAliPayRootCert(config.RootCert); err != nil {
			return nil, err
		}
	} else if err := client.LoadAliPayPublicKey(config.PublicKey); err != nil {
		return nil, err
	}
	return client, nil
}

func validateAlipayNativeConfigFields(config model.AlipayNativeConfig, requireEnabled bool) error {
	if !isFinitePositive(config.UnitPrice) || config.MinTopUp <= 0 || strings.TrimSpace(config.AppID) == "" || strings.TrimSpace(config.SellerID) == "" || strings.TrimSpace(config.PrivateKey) == "" || (requireEnabled && !config.Enabled) {
		return fmt.Errorf("支付宝当面付未配置或未启用")
	}
	certMode := strings.TrimSpace(config.AppCert) != "" || strings.TrimSpace(config.AlipayCert) != "" || strings.TrimSpace(config.RootCert) != ""
	if certMode && (strings.TrimSpace(config.AppCert) == "" || strings.TrimSpace(config.AlipayCert) == "" || strings.TrimSpace(config.RootCert) == "" || strings.TrimSpace(config.PublicKey) != "") {
		return fmt.Errorf("支付宝当面付证书配置不完整")
	}
	if !certMode && strings.TrimSpace(config.PublicKey) == "" {
		return fmt.Errorf("支付宝当面付公钥未配置")
	}
	return nil
}

func alipayNativeQuote(config model.AlipayNativeConfig, amount int64, group string) (int64, decimal.Decimal, error) {
	storedAmount := amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		if !isFinitePositive(common.QuotaPerUnit) {
			return 0, decimal.Zero, fmt.Errorf("充值单位无效")
		}
		units := decimal.NewFromFloat(common.QuotaPerUnit)
		quotient, remainder := decimal.NewFromInt(amount).QuoRem(units, 0)
		if !remainder.IsZero() || !quotient.IsInteger() || quotient.LessThanOrEqual(decimal.Zero) {
			return 0, decimal.Zero, fmt.Errorf("TOKENS 模式下充值数量必须是 %s 的整数倍", units.String())
		}
		storedAmount = quotient.IntPart()
	}
	if storedAmount < int64(config.MinTopUp) {
		return 0, decimal.Zero, fmt.Errorf("充值数量不能小于 %d", config.MinTopUp)
	}
	ratio := common.GetTopupGroupRatio(group)
	if !isFinitePositive(ratio) {
		ratio = 1
	}
	discount := 1.0
	if value, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amount)]; ok && isFinitePositive(value) {
		discount = value
	}
	money := decimal.NewFromInt(storedAmount).Mul(decimal.NewFromFloat(config.UnitPrice)).Mul(decimal.NewFromFloat(ratio)).Mul(decimal.NewFromFloat(discount)).Round(2)
	if money.LessThan(decimal.NewFromFloat(0.01)) || money.GreaterThan(decimal.NewFromInt(100000000)) {
		return 0, decimal.Zero, fmt.Errorf("充值金额无效")
	}
	return storedAmount, money, nil
}

func RequestAlipayNativeAmount(c *gin.Context) {
	var req AmountRequest
	config, configErr := model.GetAlipayNativeConfig()
	if err := c.ShouldBindJSON(&req); err != nil || configErr != nil || !isAlipayNativeConfigEnabled(config) {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "支付宝当面付不可用"})
		return
	}
	if rejectInvalidTopUpQuota(c, c.GetInt("id"), req.Amount) {
		return
	}
	group, err := model.GetUserGroup(c.GetInt("id"), true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	_, money, err := alipayNativeQuote(config, req.Amount, group)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": money.StringFixed(2)})
}

func RequestAlipayNativePay(c *gin.Context) {
	var req AmountRequest
	userID := c.GetInt("id")
	config, configErr := model.GetAlipayNativeConfig()
	if err := c.ShouldBindJSON(&req); err != nil || configErr != nil || !isAlipayNativeConfigEnabled(config) {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "支付宝当面付不可用"})
		return
	}
	if rejectInvalidTopUpQuota(c, userID, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(userID, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	storedAmount, money, err := alipayNativeQuote(config, req.Amount, group)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}
	_, err = getTopUpQuota(req.Amount)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值数量无效"})
		return
	}
	checkoutCtx, checkoutCancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer checkoutCancel()
	guard, err := lockAlipayNativeCheckout(checkoutCtx, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}
	defer guard.Release()
	existing, err := guard.Existing(checkoutCtx, storedAmount, money.StringFixed(2), config.Sandbox)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}
	if existing != nil {
		c.JSON(http.StatusOK, gin.H{"message": "success", "data": existing})
		return
	}
	if err := guard.AllowNew(checkoutCtx); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}
	tradeNo := fmt.Sprintf("AN%d%s%d", userID, common.GetRandomString(10), time.Now().UnixNano())
	method := "alipay_native"
	if config.Sandbox {
		method = "alipay_native_sandbox"
	}
	order := &model.TopUp{UserId: userID, Amount: storedAmount, Money: money.InexactFloat64(), TradeNo: tradeNo, PaymentMethod: method, PaymentProvider: model.PaymentProviderAlipayNative, CreateTime: time.Now().Unix(), Status: common.TopUpStatusPending}
	if err := model.CreateAlipayNativeTopUp(order, config); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("alipay native create order failed user_id=%d error=%q", userID, err))
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}
	client, err := newAlipayNativeClient(config, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "支付宝当面付未配置"})
		return
	}
	notifyURL := service.GetCallbackAddress() + "/api/alipay/notify"
	ctx, cancel := context.WithTimeout(checkoutCtx, 12*time.Second)
	defer cancel()
	rsp, err := client.TradePreCreate(ctx, alipay.TradePreCreate{Trade: alipay.Trade{Subject: "账户余额充值", OutTradeNo: tradeNo, TotalAmount: money.StringFixed(2), ProductCode: "FACE_TO_FACE_PAYMENT", SellerId: config.SellerID, NotifyURL: notifyURL, TimeoutExpress: "10m", GoodsType: "0"}})
	if err == nil && rsp != nil && rsp.IsFailure() {
		if markErr := model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderAlipayNative, common.TopUpStatusFailed); markErr != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("alipay native precreate failure status update failed trade_no=%s error=%q", tradeNo, markErr))
		}
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建支付订单失败"})
		return
	}
	if err != nil || rsp == nil || rsp.QRCode == "" || rsp.OutTradeNo != tradeNo {
		logger.LogError(c.Request.Context(), fmt.Sprintf("alipay native precreate uncertain trade_no=%s error=%q", tradeNo, err))
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建支付订单失败，请稍后查询订单状态", "trade_no": tradeNo})
		return
	}
	payment := alipayNativePayment{TradeNo: tradeNo, QRCode: rsp.QRCode, Amount: money.StringFixed(2), Currency: "CNY", Sandbox: config.Sandbox}
	if err := guard.Save(checkoutCtx, payment); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "支付缓存暂不可用，请稍后查询订单状态", "trade_no": tradeNo})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": payment})
}

func alipayNativeVerifyAndCredit(ctx context.Context, tradeNo string, receivedAmount string, status alipay.TradeStatus, sandbox bool, callerIP string) error {
	if status == alipay.TradeStatusClosed {
		return model.CloseAlipayNativeTopUp(tradeNo, sandbox)
	}
	if status != alipay.TradeStatusSuccess && status != alipay.TradeStatusFinished {
		return nil
	}
	order := model.GetTopUpByTradeNo(tradeNo)
	if order == nil {
		return model.ErrTopUpNotFound
	}
	amount, err := decimal.NewFromString(receivedAmount)
	if err != nil {
		return err
	}
	if !amount.Equal(decimal.NewFromFloat(order.Money).Round(2)) {
		return fmt.Errorf("支付宝回调金额不匹配")
	}
	_, err = model.RechargeAlipayNative(tradeNo, sandbox, callerIP)
	return err
}

func AlipayNativeNotify(c *gin.Context) {
	config, configErr := model.GetAlipayNativeConfig()
	if configErr != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	client, err := newAlipayNativeClient(config, false)
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	if err := c.Request.ParseForm(); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	notice, err := client.DecodeNotification(c.Request.Context(), c.Request.PostForm)
	if err != nil || notice.OutTradeNo == "" || notice.AppId != config.AppID || notice.SellerId != config.SellerID {
		c.Status(http.StatusBadRequest)
		return
	}
	if err := alipayNativeVerifyAndCredit(c.Request.Context(), notice.OutTradeNo, notice.TotalAmount, notice.TradeStatus, config.Sandbox, c.ClientIP()); err != nil {
		logger.LogError(c.Request.Context(), "alipay native notify rejected: "+err.Error())
		c.Status(http.StatusBadRequest)
		return
	}
	c.String(http.StatusOK, "success")
}

func isAlipayNativeTradeNotExist(rsp *alipay.TradeQueryRsp, err error) bool {
	var upstreamErr *alipay.Error
	if errors.As(err, &upstreamErr) {
		return upstreamErr.Code == "40004" && upstreamErr.SubCode == "ACQ.TRADE_NOT_EXIST"
	}
	return rsp != nil && rsp.Code == "40004" && rsp.SubCode == "ACQ.TRADE_NOT_EXIST"
}

func validateAlipayNativeQueryResult(tradeNo string, rsp *alipay.TradeQueryRsp, queryErr error) error {
	var upstreamErr *alipay.Error
	if errors.As(queryErr, &upstreamErr) {
		if upstreamErr.Code == "40004" && upstreamErr.SubCode == "ACQ.TRADE_NOT_EXIST" {
			return nil
		}
		return fmt.Errorf("query rejected code=%q sub_code=%q", upstreamErr.Code, upstreamErr.SubCode)
	}
	if queryErr != nil {
		return fmt.Errorf("query transport or verification error type=%T", queryErr)
	}
	if rsp == nil {
		return errors.New("empty query response")
	}
	if rsp.Code == "40004" && rsp.SubCode == "ACQ.TRADE_NOT_EXIST" {
		return nil
	}
	if !rsp.IsSuccess() {
		return fmt.Errorf("query rejected code=%q sub_code=%q", rsp.Code, rsp.SubCode)
	}
	if rsp.OutTradeNo != tradeNo {
		return errors.New("query order identity mismatch")
	}
	return nil
}

type alipayNativeOrderClient interface {
	TradeQuery(context.Context, alipay.TradeQuery) (*alipay.TradeQueryRsp, error)
	TradeClose(context.Context, alipay.TradeClose) (*alipay.TradeCloseRsp, error)
}

// Reconciliation preserves a precreated order during its payment window. Once
// that window has elapsed, an authenticated terminal response may expire it;
// TradeClose cannot refund a paid transaction, unlike TradeCancel.
func reconcileAlipayNativeOrder(ctx context.Context, client alipayNativeOrderClient, order *model.TopUp, sandbox bool, callerIP string, now time.Time) error {
	expectedMethod := "alipay_native"
	if sandbox {
		expectedMethod = "alipay_native_sandbox"
	}
	if order.PaymentProvider != model.PaymentProviderAlipayNative || order.PaymentMethod != expectedMethod {
		return model.ErrPaymentMethodMismatch
	}
	if order.Status != common.TopUpStatusPending {
		return nil
	}
	rsp, err := client.TradeQuery(ctx, alipay.TradeQuery{OutTradeNo: order.TradeNo})
	if isAlipayNativeTradeNotExist(rsp, err) {
		if order.CreateTime <= 0 || now.Before(time.Unix(order.CreateTime, 0).Add(alipayNativeOrderTimeout)) {
			return nil
		}
		return model.CloseAlipayNativeTopUp(order.TradeNo, sandbox)
	}
	if queryErr := validateAlipayNativeQueryResult(order.TradeNo, rsp, err); queryErr != nil {
		return queryErr
	}
	if err == nil && rsp != nil && rsp.IsSuccess() {
		switch rsp.TradeStatus {
		case alipay.TradeStatusSuccess, alipay.TradeStatusFinished, alipay.TradeStatusClosed:
			return alipayNativeVerifyAndCredit(ctx, order.TradeNo, rsp.TotalAmount, rsp.TradeStatus, sandbox, callerIP)
		case alipay.TradeStatusWaitBuyerPay:
		default:
			return errors.New("unknown Alipay trade status")
		}
	}
	if order.CreateTime <= 0 || now.Before(time.Unix(order.CreateTime, 0).Add(alipayNativeOrderTimeout)) {
		return nil
	}
	return closeAlipayNativeTrade(ctx, client, order, sandbox)
}

// closeAlipayNativeTrade is called only after the local payment window has
// elapsed, so TRADE_NOT_EXIST is then sufficient evidence of expiry.
func closeAlipayNativeTrade(ctx context.Context, client alipayNativeOrderClient, order *model.TopUp, sandbox bool) error {
	closed, closeErr := client.TradeClose(ctx, alipay.TradeClose{OutTradeNo: order.TradeNo})
	if isAlipayNativeCloseNotExist(closed, closeErr) {
		return model.CloseAlipayNativeTopUp(order.TradeNo, sandbox)
	}
	if closeErr == nil && closed != nil && closed.IsSuccess() && closed.OutTradeNo == order.TradeNo {
		return model.CloseAlipayNativeTopUp(order.TradeNo, sandbox)
	}
	code, subCode := alipayNativeCloseErrorCode(closed, closeErr)
	missingOutTradeNo := closed == nil || closed.OutTradeNo == ""
	logger.LogWarn(ctx, fmt.Sprintf("alipay native close unconfirmed trade_no=%s code=%q sub_code=%q missing_out_trade_no=%t", order.TradeNo, code, subCode, missingOutTradeNo))
	return errors.New("close not confirmed for requested order")
}

func isAlipayNativeCloseNotExist(rsp *alipay.TradeCloseRsp, err error) bool {
	code, subCode := alipayNativeCloseErrorCode(rsp, err)
	return code == "40004" && subCode == "ACQ.TRADE_NOT_EXIST"
}

func alipayNativeCloseErrorCode(rsp *alipay.TradeCloseRsp, err error) (string, string) {
	var upstreamErr *alipay.Error
	if errors.As(err, &upstreamErr) {
		return string(upstreamErr.Code), upstreamErr.SubCode
	}
	if rsp == nil {
		return "", ""
	}
	return string(rsp.Code), rsp.SubCode
}

func GetAlipayNativeOrder(c *gin.Context) {
	tradeNo := c.Param("trade_no")
	userID := c.GetInt("id")
	order := model.GetTopUpByTradeNo(tradeNo)
	if order == nil || order.UserId != userID || order.PaymentProvider != model.PaymentProviderAlipayNative {
		c.JSON(http.StatusNotFound, gin.H{"message": "error", "data": "订单不存在"})
		return
	}
	if order.Status == common.TopUpStatusPending {
		config, configErr := model.GetAlipayNativeConfig()
		if configErr != nil {
			common.ApiError(c, configErr)
			return
		}
		client, err := newAlipayNativeClient(config, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
		defer cancel()
		if err := reconcileAlipayNativeOrder(ctx, client, order, config.Sandbox, c.ClientIP(), time.Now()); err != nil {
			logger.LogError(ctx, fmt.Sprintf("alipay native query trade_no=%s: %s", tradeNo, err))
			c.JSON(http.StatusBadGateway, gin.H{"message": "error", "data": "支付宝订单查询失败"})
			return
		}
		order = model.GetTopUpByTradeNo(tradeNo)
		if order == nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "error", "data": "订单不存在"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{"trade_no": tradeNo, "status": order.Status}})
}

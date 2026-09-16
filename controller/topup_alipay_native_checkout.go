package controller

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/go-redis/redis/v8"
	"github.com/shopspring/decimal"
)

type alipayNativePayment struct {
	TradeNo  string `json:"trade_no"`
	QRCode   string `json:"qr_code"`
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
	Sandbox  bool   `json:"sandbox"`
}

type alipayNativeCheckoutGuard struct {
	client                            *redis.Client
	userID                            int
	token, lockKey, cacheKey, rateKey string
}

func lockAlipayNativeCheckout(ctx context.Context, userID int) (*alipayNativeCheckoutGuard, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return nil, fmt.Errorf("支付缓存暂不可用，请稍后重试")
	}
	prefix := fmt.Sprintf("alipay_native:checkout:%d", userID)
	g := &alipayNativeCheckoutGuard{client: common.RDB, userID: userID, token: common.GetRandomString(32), lockKey: prefix + ":lock", cacheKey: prefix + ":payment", rateKey: prefix + ":rate"}
	ok, err := g.client.SetNX(ctx, g.lockKey, g.token, 45*time.Second).Result()
	if err != nil || !ok {
		return nil, fmt.Errorf("支付请求正在处理或服务暂不可用，请稍后重试")
	}
	return g, nil
}

func (g *alipayNativeCheckoutGuard) Release() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// Only the lease owner may release the lock, including after lease expiry.
	_ = g.client.Eval(ctx, `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, []string{g.lockKey}, g.token).Err()
}

func (g *alipayNativeCheckoutGuard) AllowNew(ctx context.Context) error {
	ok, err := g.client.SetNX(ctx, g.rateKey, "1", 15*time.Second).Result()
	if err != nil || !ok {
		return fmt.Errorf("创建订单过于频繁或服务暂不可用，请稍后重试")
	}
	return nil
}

func (g *alipayNativeCheckoutGuard) Existing(ctx context.Context, amount int64, money string, sandbox bool) (*alipayNativePayment, error) {
	method := "alipay_native"
	if sandbox {
		method += "_sandbox"
	}
	quotedMoney, err := decimal.NewFromString(money)
	if err != nil {
		return nil, fmt.Errorf("充值金额无效")
	}
	order, err := model.PendingAlipayNativeTopUpForUser(g.userID, amount, quotedMoney.InexactFloat64(), method)
	if err != nil {
		return nil, fmt.Errorf("查询待支付订单失败，请稍后重试")
	}
	if order == nil {
		return nil, nil
	}
	if order.Amount != amount || decimal.NewFromFloat(order.Money).StringFixed(2) != money || order.PaymentMethod != method || time.Now().Unix() >= order.CreateTime+int64(alipayNativeOrderTimeout/time.Second) {
		return nil, nil
	}
	data, err := g.client.Get(ctx, g.cacheKey+":"+order.TradeNo).Bytes()
	if err != nil {
		return nil, nil
	}
	var payment alipayNativePayment
	if common.Unmarshal(data, &payment) != nil || payment.TradeNo != order.TradeNo || payment.Amount != money || payment.Sandbox != sandbox || payment.Currency != "CNY" || payment.QRCode == "" {
		return nil, nil
	}
	return &payment, nil
}

func (g *alipayNativeCheckoutGuard) Save(ctx context.Context, payment alipayNativePayment) error {
	data, err := common.Marshal(payment)
	if err != nil {
		return err
	}
	return g.client.Set(ctx, g.cacheKey+":"+payment.TradeNo, data, alipayNativeQRCodeCacheTTL).Err()
}

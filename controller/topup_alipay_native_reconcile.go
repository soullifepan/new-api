package controller

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

// Reuse the system-task lease for cross-instance exclusion and restart recovery.
// Existing orders must reconcile even when creation of new payments is disabled.
type alipayNativeReconcileHandler struct{}

func (alipayNativeReconcileHandler) Type() string            { return "alipay_native_reconcile" }
func (alipayNativeReconcileHandler) Interval() time.Duration { return time.Minute }
func (alipayNativeReconcileHandler) NewPayload() any         { return nil }
func (alipayNativeReconcileHandler) Enabled() bool {
	orders, err := model.PendingAlipayNativeTopUps(0, time.Now().Add(-alipayNativeOrderTimeout).Unix())
	return err == nil && len(orders) > 0
}

func (alipayNativeReconcileHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	cutoff := time.Now().Add(-alipayNativeOrderTimeout).Unix()
	var cursor, checked, unresolved int
	var runErr error
	for ctx.Err() == nil {
		orders, err := model.PendingAlipayNativeTopUps(cursor, cutoff)
		if err != nil {
			runErr = err
			break
		}
		if len(orders) == 0 {
			break
		}
		for i := range orders {
			if ctx.Err() != nil {
				break
			}
			order := &orders[i]
			cursor = order.Id
			config, err := model.GetAlipayNativeConfig()
			if err != nil {
				runErr = err
				break
			}
			client, err := newAlipayNativeClient(config, false)
			if err != nil {
				runErr = fmt.Errorf("alipay reconciliation configuration invalid")
				break
			}
			orderCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
			err = reconcileAlipayNativeOrder(orderCtx, client, order, config.Sandbox, "", time.Now())
			cancel()
			checked++
			if err != nil {
				unresolved++
				logger.LogWarn(ctx, fmt.Sprintf("alipay reconciliation pending trade_no=%s error=%s", order.TradeNo, err))
			}
		}
		if runErr != nil {
			break
		}
	}
	if ctx.Err() != nil {
		runErr = ctx.Err()
	}
	status := model.SystemTaskStatusSucceeded
	if runErr != nil || unresolved > 0 {
		status = model.SystemTaskStatusFailed
	}
	finishSystemTaskHandler(task, runnerID, status, map[string]int{"checked": checked, "unresolved": unresolved}, runErr)
}

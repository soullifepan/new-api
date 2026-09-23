package controller

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type walletTransferInput struct {
	SourceUsername string `json:"source_username"`
	Recipient      string `json:"recipient"`
	Amount         string `json:"amount"`
	Currency       string `json:"currency"`
	ExchangeRate   string `json:"exchange_rate"`
	RequestID      string `json:"request_id"`
}

func GetWalletTransferSummary(c *gin.Context) {
	rate := operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Wallet currency rate is unavailable"})
		return
	}
	quota, err := model.GetUserQuota(c.GetInt("id"), false)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Wallet balance is temporarily unavailable"})
		return
	}
	transferableQuota, err := model.GetTransferableWalletQuota(c.GetInt("id"))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Transferable balance is temporarily unavailable"})
		return
	}
	reserveQuota, err := model.WalletTransferReserveQuota()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Wallet reserve is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"quota": quota, "transferable_quota": transferableQuota, "reserve_quota": reserveQuota, "quota_per_unit": common.QuotaPerUnit,
		"currency":         operation_setting.GetQuotaDisplayType(),
		"currency_symbol":  operation_setting.GetCurrencySymbol(),
		"exchange_rate":    decimal.NewFromFloat(rate).String(),
		"transfer_enabled": true,
	}})
}

func GetWalletTransfers(c *gin.Context) {
	userID := c.GetInt("id")
	if c.GetInt("role") >= common.RoleAdminUser {
		if sourceID := c.Query("user_id"); sourceID != "" {
			parsed, err := strconv.Atoi(sourceID)
			if err != nil || parsed <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid user ID"})
				return
			}
			userID = parsed
		}
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 1_000_000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid page"})
		return
	}
	const pageSize = 20
	transfers, total, err := model.ListWalletTransfers(userID, pageSize, (page-1)*pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Unable to load transfers"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"items": transfers, "total": total, "page": page,
	}})
}

func TransferWalletBalance(c *gin.Context) {
	createWalletTransfer(c, false)
}

func AdminTransferWalletBalance(c *gin.Context) {
	createWalletTransfer(c, true)
}

func createWalletTransfer(c *gin.Context, admin bool) {
	var input walletTransferInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid transfer request"})
		return
	}
	sourceID := c.GetInt("id")
	if admin {
		username := strings.TrimSpace(input.SourceUsername)
		if username == "" || len(username) > model.UserNameMaxLength {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid source account"})
			return
		}
		var source model.User
		if err := model.DB.Select("id").Where("username = ?", username).First(&source).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Source account unavailable"})
			return
		}
		sourceID = source.Id
	} else if strings.TrimSpace(input.SourceUsername) != "" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Cannot transfer another account's balance"})
		return
	}
	amount, err := decimal.NewFromString(strings.TrimSpace(input.Amount))
	if err != nil || !amount.IsPositive() || common.QuotaPerUnit <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid transfer amount"})
		return
	}
	if input.Currency != operation_setting.GetQuotaDisplayType() {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Wallet currency has changed; refresh and try again"})
		return
	}
	rate := operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Wallet currency rate is unavailable"})
		return
	}
	requestedRate, rateErr := decimal.NewFromString(input.ExchangeRate)
	if rateErr != nil || !requestedRate.Equal(decimal.NewFromFloat(rate)) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Wallet exchange rate has changed; refresh and try again"})
		return
	}
	quotaAmount := amount
	switch input.Currency {
	case operation_setting.QuotaDisplayTypeUSD:
		quotaAmount = amount.Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	case operation_setting.QuotaDisplayTypeCNY, operation_setting.QuotaDisplayTypeCustom:
		quotaAmount = amount.Div(decimal.NewFromFloat(rate)).Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	case operation_setting.QuotaDisplayTypeTokens:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid wallet currency"})
		return
	}
	quota, err := common.WalletQuotaFromDecimalStrict(quotaAmount)
	if err != nil || quota <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid transfer amount"})
		return
	}
	recipient := strings.TrimSpace(input.Recipient)
	if recipient == "" || len(recipient) > model.UserNameMaxLength {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid recipient"})
		return
	}
	var target model.User
	if err := model.DB.Select("id").Where("username = ? AND status = ?", recipient, common.UserStatusEnabled).First(&target).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Recipient unavailable"})
		return
	}
	transfer, err := model.TransferWalletQuota(sourceID, target.Id, c.GetInt("id"), c.GetInt("role"), quota, input.RequestID)
	if err != nil {
		status := http.StatusInternalServerError
		message := "Unable to transfer balance"
		switch {
		case errors.Is(err, model.ErrWalletTransferInvalid):
			status, message = http.StatusBadRequest, "Invalid transfer request"
		case errors.Is(err, model.ErrWalletTransferPermission):
			status, message = http.StatusForbidden, "Transfer is not permitted"
		case errors.Is(err, model.ErrWalletTransferInsufficient):
			status, message = http.StatusConflict, "Insufficient wallet balance"
		case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
			status, message = http.StatusConflict, "Recipient wallet limit exceeded"
		case errors.Is(err, model.ErrWalletTransferRecipient):
			status, message = http.StatusNotFound, "Recipient unavailable"
		case errors.Is(err, model.ErrWalletTransferUnavailable):
			status, message = http.StatusServiceUnavailable, "Wallet transfer is temporarily unavailable"
		}
		c.JSON(status, gin.H{"success": false, "message": message})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": transfer})
}

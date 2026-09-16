package controller

import (
	"math"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type alipayNativeConfigRequest struct {
	Enabled    bool    `json:"AlipayNativeEnabled"`
	Sandbox    bool    `json:"AlipayNativeSandbox"`
	AppID      string  `json:"AlipayNativeAppID"`
	SellerID   string  `json:"AlipayNativeSellerID"`
	PrivateKey string  `json:"AlipayNativePrivateKey"`
	PublicKey  string  `json:"AlipayNativePublicKey"`
	AppCert    string  `json:"AlipayNativeAppCert"`
	AlipayCert string  `json:"AlipayNativeAlipayCert"`
	RootCert   string  `json:"AlipayNativeRootCert"`
	UnitPrice  float64 `json:"AlipayNativeUnitPrice"`
	MinTopUp   int     `json:"AlipayNativeMinTopUp"`
}

func GetAlipayNativeConfig(c *gin.Context) {
	config, err := model.GetAlipayNativeConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"AlipayNativeEnabled": config.Enabled, "AlipayNativeSandbox": config.Sandbox, "AlipayNativeAppID": config.AppID, "AlipayNativeSellerID": config.SellerID, "AlipayNativePublicKey": config.PublicKey, "AlipayNativeAppCert": config.AppCert, "AlipayNativeAlipayCert": config.AlipayCert, "AlipayNativeRootCert": config.RootCert, "AlipayNativeUnitPrice": config.UnitPrice, "AlipayNativeMinTopUp": config.MinTopUp, "AlipayNativePrivateKeyConfigured": strings.TrimSpace(config.PrivateKey) != ""}})
}

func UpdateAlipayNativeConfig(c *gin.Context) {
	var req alipayNativeConfigRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || !isFinitePositive(req.UnitPrice) || req.MinTopUp <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的支付宝当面付配置"})
		return
	}
	previous, err := model.GetAlipayNativeConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	privateKey := req.PrivateKey
	if strings.TrimSpace(privateKey) == "" {
		privateKey = previous.PrivateKey
	}
	config := model.AlipayNativeConfig{Enabled: req.Enabled, Sandbox: req.Sandbox, AppID: req.AppID, SellerID: req.SellerID, PrivateKey: privateKey, PublicKey: req.PublicKey, AppCert: req.AppCert, AlipayCert: req.AlipayCert, RootCert: req.RootCert, UnitPrice: req.UnitPrice, MinTopUp: req.MinTopUp, PreservePrivateKey: strings.TrimSpace(req.PrivateKey) == ""}
	if err := validateAlipayNativeConfig(config, req.Enabled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "启用前必须填写完整且互斥的公钥或三证书配置"})
		return
	}
	if err := model.UpdateAlipayNativeConfig(config); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func isFinitePositive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

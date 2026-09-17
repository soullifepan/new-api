package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/tapcomfy"
	"github.com/gin-gonic/gin"
)

func GetTapComfyStorageSTS(c *gin.Context) {
	credentials, err := tapcomfy.LoadConfig().AssumeRole(c.Request.Context())
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, tapcomfy.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": "TapComfy storage is unavailable"})
		return
	}
	c.JSON(http.StatusOK, credentials)
}

func UploadTapComfyAsset(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 101<<20)
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	assetType := c.PostForm("assetType")
	reader, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file"})
		return
	}
	defer reader.Close()
	asset, err := tapcomfy.LoadConfig().UploadAsset(c.Request.Context(), assetType, file.Filename, file.Header.Get("Content-Type"), file.Size, reader)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, tapcomfy.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		} else if !errors.Is(err, tapcomfy.ErrInvalidAsset) {
			status = http.StatusBadGateway
		}
		c.JSON(status, gin.H{"error": "TapComfy asset upload failed"})
		return
	}
	c.JSON(http.StatusOK, asset)
}

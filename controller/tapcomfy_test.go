package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTapComfyStorageHandlersReturnExpectedErrors(t *testing.T) {
	t.Setenv("TAPCOMFY_OSS_ENDPOINT", "")
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/storage/sts", GetTapComfyStorageSTS)
	engine.POST("/admin/assets", UploadTapComfyAsset)

	sts := httptest.NewRecorder()
	engine.ServeHTTP(sts, httptest.NewRequest(http.MethodGet, "/storage/sts", nil))
	assert.Equal(t, http.StatusServiceUnavailable, sts.Code)

	upload := httptest.NewRecorder()
	engine.ServeHTTP(upload, httptest.NewRequest(http.MethodPost, "/admin/assets", nil))
	assert.Equal(t, http.StatusBadRequest, upload.Code)
}

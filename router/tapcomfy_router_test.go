package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTapComfyRoutesRequireNewAPIAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	for _, testCase := range []struct{ method, path string }{{http.MethodGet, "/api/tapcomfy/v1/storage/sts"}, {http.MethodPost, "/api/tapcomfy/v1/admin/assets"}} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(testCase.method, testCase.path, nil))
		assert.Equal(t, http.StatusUnauthorized, recorder.Code, testCase.path)
	}
}

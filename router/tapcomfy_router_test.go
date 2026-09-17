package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
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

func TestTapComfyCatalogRoutesRegister(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	for _, route := range []string{"GET /api/tapcomfy/v1/models", "GET /api/tapcomfy/v1/admin/models", "POST /api/tapcomfy/v1/admin/models", "PUT /api/tapcomfy/v1/admin/models/:id", "DELETE /api/tapcomfy/v1/admin/models/:id"} {
		assert.True(t, registered[route], route)
	}
}

func TestTapComfyRouteRolesReachOnlyAuthorizedHandlers(t *testing.T) {
	previousDB, previousLogDB, previousRedis := model.DB, model.LOG_DB, common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuditLog{}))
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	t.Cleanup(func() { model.DB, model.LOG_DB, common.RedisEnabled = previousDB, previousLogDB, previousRedis })
	t.Setenv("TAPCOMFY_OSS_ENDPOINT", "")
	commonToken, adminToken := "tapcomfy-common-token", "tapcomfy-admin-token"
	require.NoError(t, db.Create(&model.User{Username: "tapcomfy-common", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AccessToken: &commonToken, AuthVersion: 1, AffCode: "tapcomfy-common-aff"}).Error)
	require.NoError(t, db.Create(&model.User{Username: "tapcomfy-admin", Password: "placeholder", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AccessToken: &adminToken, AuthVersion: 1, AffCode: "tapcomfy-admin-aff"}).Error)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)

	sts := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/tapcomfy/v1/storage/sts", nil)
	request.Header.Set("Authorization", "Bearer "+commonToken)
	engine.ServeHTTP(sts, request)
	assert.Equal(t, http.StatusServiceUnavailable, sts.Code, "ordinary authenticated user reached STS handler")

	upload := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/assets", nil)
	request.Header.Set("Authorization", "Bearer "+commonToken)
	engine.ServeHTTP(upload, request)
	assert.Equal(t, http.StatusForbidden, upload.Code)

	adminUpload := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/assets", nil)
	request.Header.Set("Authorization", "Bearer "+adminToken)
	engine.ServeHTTP(adminUpload, request)
	assert.Equal(t, http.StatusBadRequest, adminUpload.Code, "administrator reached upload handler")
}

package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestTapComfyRoutesRequireNewAPIAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	for _, testCase := range []struct{ method, path string }{
		{http.MethodGet, "/api/tapcomfy/v1/storage/sts"},
		{http.MethodPost, "/api/tapcomfy/v1/admin/assets"},
		{http.MethodGet, "/api/tapcomfy/v1/wallet"},
		{http.MethodGet, "/api/tapcomfy/v1/invitations"},
		{http.MethodGet, "/api/tapcomfy/v1/wallet/transfers"},
		{http.MethodPost, "/api/tapcomfy/v1/wallet/transfers"},
		{http.MethodPost, "/api/tapcomfy/v1/admin/wallet/transfers"},
	} {
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
	for _, route := range []string{"GET /api/tapcomfy/v1/models", "GET /api/tapcomfy/v1/admin/models", "POST /api/tapcomfy/v1/admin/models", "PUT /api/tapcomfy/v1/admin/models/:id", "DELETE /api/tapcomfy/v1/admin/models/:id", "GET /api/tapcomfy/v1/wallet", "GET /api/tapcomfy/v1/invitations", "GET /api/tapcomfy/v1/wallet/transfers", "POST /api/tapcomfy/v1/wallet/transfers", "POST /api/tapcomfy/v1/admin/wallet/transfers"} {
		assert.True(t, registered[route], route)
	}
}

func TestTapComfyInvitationsReturnOnlyCurrentUsersInvitees(t *testing.T) {
	for _, database := range []struct {
		name, env string
		open      func(string) gorm.Dialector
	}{
		{name: "sqlite", open: func(dsn string) gorm.Dialector { return sqlite.Open(dsn) }},
		{name: "mysql", env: "TEST_MYSQL_DSN", open: func(dsn string) gorm.Dialector { return mysql.Open(dsn) }},
		{name: "postgres", env: "TEST_POSTGRES_DSN", open: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	} {
		t.Run(database.name, func(t *testing.T) {
			dsn := ":memory:"
			if database.env != "" {
				dsn = os.Getenv(database.env)
				if dsn == "" {
					t.Skip(database.env + " is not configured")
				}
			}
			previousDB, previousLogDB, previousRedis := model.DB, model.LOG_DB, common.RedisEnabled
			db, err := gorm.Open(database.open(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuditLog{}))
			model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
			t.Cleanup(func() { model.DB, model.LOG_DB, common.RedisEnabled = previousDB, previousLogDB, previousRedis })
			ownerToken, otherToken := "invite-owner-pat", "invite-other-pat"
			owner := model.User{Username: "invite-owner", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "owner-aff", AccessToken: &ownerToken, AuthVersion: 1}
			other := model.User{Username: "invite-other", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "other-aff", AccessToken: &otherToken, AuthVersion: 1}
			require.NoError(t, db.Create(&owner).Error)
			require.NoError(t, db.Create(&other).Error)
			for i := range 21 {
				username := fmt.Sprintf("invited-%02d", i)
				require.NoError(t, db.Create(&model.User{Username: username, Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: username, InviterId: owner.Id}).Error)
			}
			require.NoError(t, db.Create(&model.User{Username: "other-invitee", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "other-invitee", InviterId: other.Id}).Error)

			gin.SetMode(gin.TestMode)
			engine := gin.New()
			SetApiRouter(engine)
			for _, tc := range []struct {
				name, token, path, first string
				count, total             int
			}{
				{name: "first page", token: ownerToken, path: "/api/tapcomfy/v1/invitations", first: "invited-20", count: 20, total: 21},
				{name: "second page", token: ownerToken, path: "/api/tapcomfy/v1/invitations?page=2", first: "invited-00", count: 1, total: 21},
				{name: "empty page", token: ownerToken, path: "/api/tapcomfy/v1/invitations?page=3", count: 0, total: 21},
				{name: "another inviter", token: otherToken, path: "/api/tapcomfy/v1/invitations?user_id=1", first: "other-invitee", count: 1, total: 1},
			} {
				t.Run(tc.name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodGet, tc.path, nil)
					request.Header.Set("Authorization", "Bearer "+tc.token)
					recorder := httptest.NewRecorder()
					engine.ServeHTTP(recorder, request)
					require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
					var result struct {
						Success bool `json:"success"`
						Data    struct {
							Items []map[string]any `json:"items"`
							Total int              `json:"total"`
						} `json:"data"`
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
					require.True(t, result.Success)
					assert.Equal(t, tc.total, result.Data.Total)
					require.Len(t, result.Data.Items, tc.count)
					if tc.count > 0 {
						assert.Equal(t, tc.first, result.Data.Items[0]["username"])
						assert.Len(t, result.Data.Items[0], 2)
						assert.NotZero(t, result.Data.Items[0]["created_at"])
					}
				})
			}
			request := httptest.NewRequest(http.MethodGet, "/api/tapcomfy/v1/invitations?page=0", nil)
			request.Header.Set("Authorization", "Bearer "+ownerToken)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			assert.Equal(t, http.StatusBadRequest, recorder.Code)
		})
	}
}

func TestTapComfyWalletTransferWithPAT(t *testing.T) {
	previousDB, previousLogDB, previousRedis := model.DB, model.LOG_DB, common.RedisEnabled
	previousBatch, previousUnit := common.BatchUpdateEnabled, common.QuotaPerUnit
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuditLog{}, &model.WalletTransfer{}, &model.WalletBatchMarker{}))
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled, common.BatchUpdateEnabled, common.QuotaPerUnit = false, false, 500000
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled = previousDB, previousLogDB, previousRedis
		common.BatchUpdateEnabled, common.QuotaPerUnit = previousBatch, previousUnit
	})
	userToken, adminToken := "wallet-user-test-pat", "wallet-admin-test-pat"
	sender := model.User{Username: "wallet-sender", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AccessToken: &userToken, AuthVersion: 1, AffCode: "wallet-sender-aff", Quota: 100000000}
	admin := model.User{Username: "wallet-admin", Password: "placeholder", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AccessToken: &adminToken, AuthVersion: 1, AffCode: "wallet-admin-aff"}
	require.NoError(t, db.Create(&sender).Error)
	require.NoError(t, db.Create(&admin).Error)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	request := httptest.NewRequest(http.MethodGet, "/api/tapcomfy/v1/wallet", nil)
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), `"reserve_quota":10000000`)

	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/wallet/transfers", strings.NewReader(`{"source_username":"wallet-sender","recipient":"wallet-admin","amount":"1","currency":"USD","exchange_rate":"1","request_id":"wallet-pat-001"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusForbidden, recorder.Code)

	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/wallet/transfers", strings.NewReader(`{"recipient":"wallet-admin","amount":"1","currency":"USD","exchange_rate":"1","request_id":"wallet-pat-002"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var debit, credit model.User
	require.NoError(t, db.First(&debit, sender.Id).Error)
	require.NoError(t, db.First(&credit, admin.Id).Error)
	assert.Equal(t, 99500000, debit.Quota)
	assert.Equal(t, 500000, credit.Quota)
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/wallet/transfers", strings.NewReader(`{"source_username":"wallet-sender","recipient":"wallet-admin","amount":"1","currency":"USD","exchange_rate":"1","request_id":"wallet-pat-003"}`))
	request.Header.Set("Authorization", "Bearer "+adminToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())

	request = httptest.NewRequest(http.MethodGet, "/api/tapcomfy/v1/wallet/transfers", nil)
	request.Header.Set("Authorization", "Bearer "+adminToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), "wallet-pat-002")
	assert.Contains(t, recorder.Body.String(), "wallet-pat-003")

	previousDisplayType, previousRate := operation_setting.GetGeneralSetting().QuotaDisplayType, operation_setting.USDExchangeRate
	operation_setting.GetGeneralSetting().QuotaDisplayType, operation_setting.USDExchangeRate = operation_setting.QuotaDisplayTypeCNY, 7
	t.Cleanup(func() {
		operation_setting.GetGeneralSetting().QuotaDisplayType, operation_setting.USDExchangeRate = previousDisplayType, previousRate
	})
	request = httptest.NewRequest(http.MethodGet, "/api/tapcomfy/v1/wallet", nil)
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Contains(t, recorder.Body.String(), `"reserve_quota":10000000`)
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/wallet/transfers", strings.NewReader(`{"recipient":"wallet-admin","amount":"7","currency":"CNY","exchange_rate":"7","request_id":"wallet-pat-004"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/wallet/transfers", strings.NewReader(`{"recipient":"wallet-admin","amount":"3.5","currency":"CNY","exchange_rate":"7","request_id":"wallet-pat-005"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.NoError(t, db.First(&debit, sender.Id).Error)
	assert.Equal(t, 98250000, debit.Quota)
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/wallet/transfers", strings.NewReader(`{"recipient":"wallet-admin","amount":"1","currency":"USD","exchange_rate":"1","request_id":"wallet-pat-006"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/wallet/transfers", strings.NewReader(`{"recipient":"wallet-admin","amount":"1","currency":"CNY","exchange_rate":"6","request_id":"wallet-pat-007"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)

	common.BatchUpdateEnabled = true
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/wallet/transfers", strings.NewReader(`{"recipient":"wallet-admin","amount":"1","currency":"CNY","exchange_rate":"7","request_id":"wallet-pat-batch-001"}`))
	request.Header.Set("Authorization", "Bearer "+userToken)
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
}

func TestTapComfyRouteRolesReachOnlyAuthorizedHandlers(t *testing.T) {
	previousDB, previousLogDB, previousRedis := model.DB, model.LOG_DB, common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuditLog{}, &model.TapComfyModel{}))
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

	adminModel := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/models", nil)
	request.Header.Set("Authorization", "Bearer "+commonToken)
	engine.ServeHTTP(adminModel, request)
	assert.Equal(t, http.StatusForbidden, adminModel.Code)

	adminUpload := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/assets", nil)
	request.Header.Set("Authorization", "Bearer "+adminToken)
	engine.ServeHTTP(adminUpload, request)
	assert.Equal(t, http.StatusBadRequest, adminUpload.Code, "administrator reached upload handler")
}

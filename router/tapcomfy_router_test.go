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
	"gorm.io/gorm/schema"
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

func TestPartnerAPIContractAndOwnerIsolation(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			oldDB, oldLog, oldRedis := model.DB, model.LOG_DB, common.RedisEnabled
			oldOptions := common.OptionMap
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "partner_api_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			tables := []any{&model.User{}, &model.UserSession{}, &model.AuditLog{}, &model.Option{}, &model.Partner{}, &model.PartnerCommission{}, &model.PartnerPayout{}}
			require.NoError(t, db.Migrator().DropTable(tables...))
			require.NoError(t, db.AutoMigrate(tables...))
			model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
			common.OptionMap = map[string]string{"PartnerProgram": `{"enabled":true,"min_payout_cents":1}`}
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(tables...))
				model.DB, model.LOG_DB, common.RedisEnabled = oldDB, oldLog, oldRedis
				common.OptionMap = oldOptions
				_ = sqlDB.Close()
			})
			ownerToken, otherToken, adminToken := "partner-owner-pat", "partner-other-pat", "partner-admin-pat"
			for _, u := range []model.User{{Id: 1, Username: "partner-owner", AccessToken: &ownerToken, Role: common.RoleCommonUser, AffCode: "owner"}, {Id: 2, Username: "partner-other", AccessToken: &otherToken, Role: common.RoleCommonUser, AffCode: "other"}, {Id: 3, Username: "partner-admin", AccessToken: &adminToken, Role: common.RoleAdminUser, AffCode: "admin"}, {Id: 4, Username: "partner-buyer", InviterId: 1, Role: common.RoleCommonUser, AffCode: "buyer"}} {
				u.Group = "default"
				u.Status = common.UserStatusEnabled
				u.AuthVersion = 1
				require.NoError(t, db.Create(&u).Error)
			}
			require.NoError(t, db.Create(&model.Partner{UserID: 1, Status: "approved", ApprovedAt: 1700000000, AvailableQuota: 100, EarnedQuota: 100}).Error)
			require.NoError(t, db.Create(&model.Partner{UserID: 4, Status: "pending"}).Error)
			require.NoError(t, db.Create(&model.PartnerCommission{PartnerID: 1, UserID: 4, TopUpID: 99, TopUpQuota: 1000, CommissionQuota: 100}).Error)
			require.NoError(t, db.Create(&model.PartnerPayout{UserID: 1, RequestID: "private-account", Account: "private-payee", Status: "pending"}).Error)
			engine := gin.New()
			SetApiRouter(engine)
			for _, tc := range []struct {
				method, path, token string
				status              int
				contains            string
			}{
				{"GET", "/api/tapcomfy/v1/admin/partners", ownerToken, 403, ""},
				{"GET", "/api/tapcomfy/v1/admin/partners?status=approved", adminToken, 200, `"username":"partner-owner"`},
				{"GET", "/api/tapcomfy/v1/admin/partners?size=1&page=2", adminToken, 200, `"items":[]`},
				{"GET", "/api/user/aff", ownerToken, 200, `"data":"owner"`},
				{"GET", "/api/user/aff", otherToken, 409, "partner_state"},
				{"GET", "/api/tapcomfy/v1/partner/access", otherToken, 200, `"can_access":false`},
				{"GET", "/api/tapcomfy/v1/partner/access", ownerToken, 200, `"can_access":true`},
				{"GET", "/api/tapcomfy/v1/partner/access", "", 401, ""},
				{"GET", "/api/tapcomfy/v1/partner", otherToken, 403, "partner_required"},
				{"POST", "/api/tapcomfy/v1/partner/application", otherToken, 403, "partner_invite_only"},
				{"POST", "/api/tapcomfy/v1/partner/payouts", otherToken, 403, "partner_required"},
				{"POST", "/api/tapcomfy/v1/admin/partners", ownerToken, 403, ""},
				{"GET", "/api/tapcomfy/v1/partner", ownerToken, 200, `"referral_code":"owner"`},
				{"GET", "/api/tapcomfy/v1/partner/invitees", ownerToken, 200, `"topup_count":1`},
				{"GET", "/api/tapcomfy/v1/partner/invitees?user_id=1", otherToken, 403, "partner_required"},
				{"GET", "/api/tapcomfy/v1/partner/commissions?user_id=1", otherToken, 403, "partner_required"},
				{"GET", "/api/tapcomfy/v1/partner/payouts?user_id=1", otherToken, 403, "partner_required"},
				{"GET", "/api/tapcomfy/v1/admin/partners/payouts", ownerToken, 403, ""},
				{"PUT", "/api/tapcomfy/v1/admin/partners/payouts/1", ownerToken, 403, ""},
				{"PUT", "/api/tapcomfy/v1/admin/partners/config", ownerToken, 403, ""},
				{"GET", "/api/tapcomfy/v1/admin/partners/payouts", adminToken, 200, "private-payee"},
				{"GET", "/api/tapcomfy/v1/admin/partners/payouts?size=101", adminToken, 400, "partner_invalid"},
				{"GET", "/api/tapcomfy/v1/admin/partners/payouts?size=1&page=2", adminToken, 200, `"items":[]`},
				{"GET", "/api/tapcomfy/v1/partner/payouts?page=-1", ownerToken, 400, "partner_invalid"},
				{"POST", "/api/tapcomfy/v1/partner/payouts", ownerToken, 400, "partner_invalid"},
				{"GET", "/api/tapcomfy/v1/partner", "", 401, ""},
				{"POST", "/api/tapcomfy/v1/partner/application", "", 401, ""},
			} {
				t.Run(tc.method+tc.path+tc.token, func(t *testing.T) {
					req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
					req.Header.Set("Content-Type", "application/json")
					if tc.token != "" {
						req.Header.Set("Authorization", "Bearer "+tc.token)
					}
					rec := httptest.NewRecorder()
					engine.ServeHTTP(rec, req)
					require.Equal(t, tc.status, rec.Code, rec.Body.String())
					if tc.contains != "" {
						assert.Contains(t, rec.Body.String(), tc.contains)
					}
					if tc.path == "/api/tapcomfy/v1/admin/partners?status=approved" {
						assert.NotContains(t, rec.Body.String(), "access_token")
						assert.NotContains(t, rec.Body.String(), "password")
						assert.NotContains(t, rec.Body.String(), "partner-buyer")
					}
					if tc.token == otherToken {
						assert.NotContains(t, rec.Body.String(), "private-payee")
					}
					if strings.Contains(tc.path, "invitees") {
						assert.NotContains(t, rec.Body.String(), "consumed")
					}
				})
			}

			for _, tc := range []struct {
				body string
				code int
			}{
				{`{"user_id":0}`, 400}, {`{"user_id":999}`, 404},
				{`{"user_id":2,"notes":"线下合作","channels":"视频号","links":"https://example.com/account","plan":"直播","contact":"微信","evidence":"https://example.com/proof","review_note":"已沟通"}`, 200}, {`{"user_id":2,"notes":"重试"}`, 200},
			} {
				req := httptest.NewRequest(http.MethodPost, "/api/tapcomfy/v1/admin/partners", strings.NewReader(tc.body))
				req.Header.Set("Authorization", "Bearer "+adminToken)
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				engine.ServeHTTP(rec, req)
				require.Equal(t, tc.code, rec.Code, rec.Body.String())
			}
			opened, err := model.GetPartner(2)
			require.NoError(t, err)
			assert.Equal(t, "approved", opened.Status)
			assert.Equal(t, "线下合作", opened.Notes)
			assert.Equal(t, "视频号", opened.Channels)
			assert.Equal(t, "https://example.com/account", opened.Links)
			assert.Equal(t, "直播", opened.Plan)
			assert.Equal(t, "微信", opened.Contact)
			assert.Equal(t, "https://example.com/proof", opened.Evidence)
			assert.Equal(t, "已沟通", opened.ReviewNote)
			assert.Positive(t, opened.ApprovedAt)

			common.OptionMap["PartnerProgram"] = `{"enabled":true,"commission_bps":1000,"duration_days":365,"min_payout_cents":1}`
			for _, tc := range []struct {
				name, token, body        string
				code, wantRate, wantDays int
			}{
				{"forbidden", ownerToken, `{"commission_bps":1250}`, 403, 1000, 365},
				{"omitted", adminToken, `{}`, 400, 1000, 365},
				{"negative", adminToken, `{"commission_bps":-1}`, 400, 1000, 365},
				{"too high", adminToken, `{"commission_bps":10001}`, 400, 1000, 365},
				{"fraction", adminToken, `{"commission_bps":12.5}`, 400, 1000, 365},
				{"string", adminToken, `{"commission_bps":"1250"}`, 400, 1000, 365},
				{"custom", adminToken, `{"commission_bps":1250}`, 200, 1250, 365},
				{"zero", adminToken, `{"commission_bps":0}`, 200, 0, 365},
				{"restore", adminToken, `{"commission_bps":null}`, 200, 1000, 365},
				{"duration forbidden", ownerToken, `{"duration_days":30}`, 403, 1000, 365},
				{"duration custom", adminToken, `{"duration_days":730}`, 200, 1000, 730},
				{"rate preserves duration", adminToken, `{"commission_bps":1250}`, 200, 1250, 730},
				{"duration negative", adminToken, `{"duration_days":-1}`, 400, 1250, 730},
				{"duration too high", adminToken, `{"duration_days":36501}`, 400, 1250, 730},
				{"duration fraction", adminToken, `{"duration_days":1.5}`, 400, 1250, 730},
				{"duration string", adminToken, `{"duration_days":"30"}`, 400, 1250, 730},
				{"unknown field", adminToken, `{"duration_days":30,"unknown":null}`, 400, 1250, 730},
				{"atomic validation", adminToken, `{"commission_bps":100,"duration_days":-1}`, 400, 1250, 730},
				{"duration unlimited", adminToken, `{"duration_days":0}`, 200, 1250, 0},
				{"duration restore", adminToken, `{"duration_days":null}`, 200, 1250, 365},
				{"both terms", adminToken, `{"commission_bps":1500,"duration_days":30}`, 200, 1500, 30},
			} {
				t.Run("commission_"+tc.name, func(t *testing.T) {
					req := httptest.NewRequest(http.MethodPut, "/api/tapcomfy/v1/admin/partners/1/commission", strings.NewReader(tc.body))
					req.Header.Set("Authorization", "Bearer "+tc.token)
					req.Header.Set("Content-Type", "application/json")
					rec := httptest.NewRecorder()
					engine.ServeHTTP(rec, req)
					require.Equal(t, tc.code, rec.Code, rec.Body.String())
					for _, token := range []string{ownerToken, otherToken} {
						req = httptest.NewRequest(http.MethodGet, "/api/tapcomfy/v1/partner", nil)
						req.Header.Set("Authorization", "Bearer "+token)
						rec = httptest.NewRecorder()
						engine.ServeHTTP(rec, req)
						require.Equal(t, 200, rec.Code, rec.Body.String())
						var overview struct {
							Data struct {
								Config model.PartnerConfig `json:"config"`
							} `json:"data"`
						}
						require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &overview))
						want := tc.wantRate
						wantDays := tc.wantDays
						if token == otherToken {
							want = 1000
							wantDays = 365
						}
						assert.Equal(t, want, overview.Data.Config.CommissionBPS)
						assert.Equal(t, wantDays, overview.Data.Config.DurationDays)
					}
					assert.Equal(t, 1000, model.GetPartnerConfig().CommissionBPS, "global rate is unchanged")
					assert.Equal(t, 365, model.GetPartnerConfig().DurationDays, "global duration is unchanged")
				})
			}

			require.NoError(t, db.Model(&model.Partner{}).Where("user_id = ?", 1).Update("approved_at", 0).Error)
			for _, path := range []string{"/api/tapcomfy/v1/partner/access", "/api/tapcomfy/v1/partner"} {
				req := httptest.NewRequest(http.MethodGet, path, nil)
				req.Header.Set("Authorization", "Bearer "+ownerToken)
				rec := httptest.NewRecorder()
				engine.ServeHTTP(rec, req)
				if strings.HasSuffix(path, "/access") {
					assert.Equal(t, 200, rec.Code)
					assert.Contains(t, rec.Body.String(), `"can_access":false`)
				} else {
					assert.Equal(t, 403, rec.Code)
				}
			}
			require.NoError(t, db.Model(&model.Partner{}).Where("user_id = ?", 1).Update("approved_at", 1700000000).Error)
			for _, status := range []string{"pending", "needs_info", "rejected", "suspended", "approved"} {
				t.Run("invitation_gate_"+status, func(t *testing.T) {
					require.NoError(t, db.Model(&model.Partner{}).Where("user_id = ?", 1).Update("status", status).Error)
					// Closing applications must not revoke an approved partner.
					if status == "approved" {
						common.OptionMap["PartnerProgram"] = `{"enabled":false,"min_payout_cents":1}`
					}
					for _, path := range []string{"/api/user/aff", "/api/tapcomfy/v1/partner", "/api/tapcomfy/v1/partner/payouts", "/api/tapcomfy/v1/partner/access"} {
						req := httptest.NewRequest(http.MethodGet, path, nil)
						req.Header.Set("Authorization", "Bearer "+ownerToken)
						rec := httptest.NewRecorder()
						engine.ServeHTTP(rec, req)
						switch path {
						case "/api/tapcomfy/v1/partner/access":
							assert.Equal(t, 200, rec.Code)
							var access struct {
								Data struct {
									CanAccess bool `json:"can_access"`
								} `json:"data"`
							}
							require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &access))
							assert.Equal(t, status == "approved" || status == "suspended", access.Data.CanAccess)
						case "/api/user/aff":
							if status == "approved" {
								assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
								assert.Contains(t, rec.Body.String(), `"data":"owner"`)
							} else {
								assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
								assert.Contains(t, rec.Body.String(), "partner_state")
							}
						case "/api/tapcomfy/v1/partner":
							if status != "approved" && status != "suspended" {
								assert.Equal(t, 403, rec.Code)
								assert.Contains(t, rec.Body.String(), "partner_required")
								continue
							}
							assert.Equal(t, 200, rec.Code, rec.Body.String())
							if status == "approved" {
								assert.Contains(t, rec.Body.String(), `"referral_code":"owner"`)
							} else {
								assert.Contains(t, rec.Body.String(), `"referral_code":""`)
							}
						default:
							if status != "approved" && status != "suspended" {
								assert.Equal(t, 403, rec.Code)
								continue
							}
							assert.Equal(t, 200, rec.Code, rec.Body.String())
							assert.Contains(t, rec.Body.String(), "private-payee", "former partners can access historical funds")
						}
					}
				})
			}

		})
	}
}

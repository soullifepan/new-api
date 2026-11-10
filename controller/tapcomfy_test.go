package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/tapcomfy"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
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

func TestTapComfyCatalogHandlersFilterAndValidateAssets(t *testing.T) {
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open("file:tapcomfy_controller?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.TapComfyModel{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
	for key, value := range map[string]string{"TAPCOMFY_OSS_ENDPOINT": "https://oss.example.com", "TAPCOMFY_OSS_BUCKET": "bucket", "TAPCOMFY_OSS_REGION": "region", "TAPCOMFY_OSS_ACCESS_KEY_ID": "id", "TAPCOMFY_OSS_ACCESS_KEY_SECRET": "secret"} {
		t.Setenv(key, value)
	}
	require.NoError(t, db.Create(&model.TapComfyModel{ID: "published", Name: "Published", Category: "JC", ThumbnailURL: "https://bucket.oss.example.com/3d_models/thumbnails/a.png", ThumbnailObjectKey: "3d_models/thumbnails/a.png", ModelURL: "https://bucket.oss.example.com/3d_models/models/a.glb", ModelObjectKey: "3d_models/models/a.glb", Format: "glb", FileSize: 1, Status: model.TapComfyModelStatusPublished}).Error)
	require.NoError(t, db.Create(&model.TapComfyModel{ID: "hidden", Name: "Hidden", Category: "SS", ThumbnailURL: "x", ThumbnailObjectKey: "x", ModelURL: "x", ModelObjectKey: "x", Format: "glb", FileSize: 1, Status: model.TapComfyModelStatusHidden}).Error)
	var count int64
	require.NoError(t, model.DB.Model(&model.TapComfyModel{}).Where("status = ?", model.TapComfyModelStatusPublished).Count(&count).Error)
	require.Equal(t, int64(1), count)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/models", GetTapComfyModels)
	router.POST("/models", CreateTapComfyModel)
	router.PUT("/models/:id", UpdateTapComfyModel)
	router.DELETE("/models/:id", DeleteTapComfyModel)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/models?limit=999&category=JC", nil))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "published")
	assert.NotContains(t, recorder.Body.String(), "hidden")
	assert.NotContains(t, recorder.Body.String(), "model_object_key")
	assert.Contains(t, recorder.Body.String(), `"limit":100`)
	invalid := `{"name":"bad","category":"JC","thumbnail_url":"https://evil/x","thumbnail_object_key":"3d_models/thumbnails/a.png","model_url":"https://evil/x","model_object_key":"3d_models/models/a.glb","format":"GLB","file_size":1,"status":"published"}`
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/models", bytes.NewBufferString(invalid)))
	assert.Equal(t, http.StatusBadRequest, recorder.Code)

	valid := `{"name":"New","category":"JC","thumbnail_url":"https://bucket.oss.example.com/3d_models/thumbnails/new.png","thumbnail_object_key":"3d_models/thumbnails/new.png","model_url":"https://bucket.oss.example.com/3d_models/models/new.glb","model_object_key":"3d_models/models/new.glb","format":"GLB","file_size":2,"sort":3,"status":"published"}`
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/models", bytes.NewBufferString(valid)))
	require.Equal(t, http.StatusCreated, recorder.Code)
	var created model.TapComfyModel
	require.NoError(t, db.Where("name = ?", "New").First(&created).Error)
	assert.Equal(t, "glb", created.Format)

	updated := `{"name":"Updated","category":"JC","thumbnail_url":"https://bucket.oss.example.com/3d_models/thumbnails/new.png","thumbnail_object_key":"3d_models/thumbnails/new.png","model_url":"https://bucket.oss.example.com/3d_models/models/new.glb","model_object_key":"3d_models/models/new.glb","format":".GLB","file_size":3,"sort":4,"status":"hidden"}`
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, "/models/"+created.ID, bytes.NewBufferString(updated)))
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, db.Where("id = ?", created.ID).First(&created).Error)
	assert.Equal(t, "glb", created.Format)
	assert.Equal(t, model.TapComfyModelStatusHidden, created.Status)

	require.NoError(t, db.Create(&model.TapComfyModel{ID: "legacy", Name: "Legacy", Category: "JC", ThumbnailURL: "https://legacy.example/3d_models/a.png", ThumbnailObjectKey: "3d_models/a.png", ModelURL: "https://legacy.example/3d_models/a.glb", ModelObjectKey: "3d_models/a.glb", Format: "glb", FileSize: 1, Status: model.TapComfyModelStatusPublished}).Error)
	legacyUpdate := `{"name":"Legacy","category":"JC","thumbnail_url":"https://legacy.example/3d_models/a.png","thumbnail_object_key":"3d_models/a.png","model_url":"https://legacy.example/3d_models/a.glb","model_object_key":"3d_models/a.glb","format":"glb","file_size":1,"status":"hidden"}`
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, "/models/legacy", bytes.NewBufferString(legacyUpdate)))
	assert.Equal(t, http.StatusOK, recorder.Code)

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/models/"+created.ID, nil))
	assert.Equal(t, http.StatusNoContent, recorder.Code)
}

// Exercise the production auth/distribution/controller and real BillingSession
// against a disposable SQLite file. Only the paid provider is replaced.
func TestElevenLabsSoundControllerBillingEndToEnd(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.Log{}))
	require.NoError(t, i18n.Init())
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, consume, rate := common.BatchUpdateEnabled, common.LogConsumeEnabled, setting.ModelRequestRateLimitEnabled
	quotaSettings := *operation_setting.GetQuotaSetting()
	groupRatios, err := common.Marshal(ratio_setting.GetGroupRatioCopy())
	require.NoError(t, err)
	specialRatios := ratio_setting.GroupGroupRatio2JSONString()
	groups := setting.UserUsableGroups2JSONString()
	common.BatchUpdateEnabled, common.LogConsumeEnabled, setting.ModelRequestRateLimitEnabled = false, true, false
	operation_setting.GetQuotaSetting().PreConsumeMultiplier = 1
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-sound":1250}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":0.8}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"default":{"default":0.5}}`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	t.Cleanup(func() {
		common.BatchUpdateEnabled, common.LogConsumeEnabled, setting.ModelRequestRateLimitEnabled = batch, consume, rate
		*operation_setting.GetQuotaSetting() = quotaSettings
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(string(groupRatios)))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(specialRatios))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(groups))
	})
	audio, err := os.ReadFile("../tapcomfy/testdata/sound-lame-44101-samples.mp3")
	require.NoError(t, err)
	type observation struct {
		userQuota, tokenQuota, tokenUsed int
		version, path, query, auth       string
		err                              error
	}
	observed := make(chan observation, 1)
	var requests atomic.Int32
	var failMode atomic.Int32
	var userID, tokenID atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var u model.User
		var token model.Token
		err := db.First(&u, int(userID.Load())).Error
		if err == nil {
			err = db.First(&token, int(tokenID.Load())).Error
		}
		body, readErr := io.ReadAll(r.Body)
		if err == nil {
			err = readErr
		}
		var payload struct {
			ModelID string `json:"model_id"`
		}
		if err == nil {
			err = common.Unmarshal(body, &payload)
		}
		observed <- observation{u.Quota, token.RemainQuota, token.UsedQuota, payload.ModelID, r.URL.Path, r.URL.RawQuery, r.Header.Get("Authorization"), err}
		if failMode.Load() == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"error":{"message":"fixture refusal","type":"invalid_request_error"}}`))
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		if failMode.Load() == 2 {
			_, _ = w.Write(audio[:len(audio)-1])
			return
		}
		_, _ = w.Write(audio)
	}))
	defer upstream.Close()
	mapping := `{"elevenlabs-sound":"must-not-override-version","eleven_text_to_sound_v3":"fixture-v3"}`
	channel := model.Channel{Name: "sound-fixture", Type: 1, Key: "fixture-provider", Status: common.ChannelStatusEnabled, Models: tapcomfy.ElevenLabsSoundModel, Group: "default", BaseURL: &upstream.URL, ModelMapping: &mapping, AutoBan: common.GetPointer(0)}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.AddAbilities(db))
	engine := gin.New()
	engine.Use(middleware.RequestId())
	route := engine.Group("/v1", middleware.RouteTag("relay"), middleware.SystemPerformanceCheck(), middleware.TokenAuth(), middleware.ModelRequestRateLimit())
	route.POST("/sound-generation", tapcomfy.PrepareElevenLabsSound, middleware.Distribute(), RelayElevenLabsSound)
	for index, tc := range []struct {
		name, version, expectedVersion                             string
		fail, truncated, noAuth, forbidden, insufficient, tokenLow bool
		status, charge                                             int
	}{
		{name: "default version success", expectedVersion: "fixture-v3", status: 200, charge: 1250},
		{name: "removed v2 rejected before upstream", version: "eleven_text_to_sound_v2", status: 400},
		{name: "explicit v3 success", version: "eleven_text_to_sound_v3", expectedVersion: "fixture-v3", status: 200, charge: 1250},
		{name: "provider rejection refunds", fail: true, expectedVersion: "fixture-v3", status: 422},
		{name: "truncated audio refunds", truncated: true, expectedVersion: "fixture-v3", status: 502},
		{name: "token reserve exceeds balance", tokenLow: true, status: 403},
		{name: "missing auth", noAuth: true, status: 401},
		{name: "internal version grants no public access", version: "eleven_text_to_sound_v3", forbidden: true, status: 403},
		{name: "reserve exceeds balance", insufficient: true, status: 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			initial := 100000
			if tc.insufficient {
				initial = 1000
			}
			user := model.User{Username: fmt.Sprintf("sound-%d", index), AffCode: fmt.Sprintf("sound-aff-%d", index), Password: "test-only", Status: common.UserStatusEnabled, Group: "default", Quota: initial, Setting: `{"billing_preference":"wallet_only"}`}
			require.NoError(t, db.Create(&user).Error)
			limits := tapcomfy.ElevenLabsSoundModel
			if tc.forbidden {
				limits = "eleven_text_to_sound_v3"
			}
			token := model.Token{UserId: user.Id, Key: fmt.Sprintf("soundfixture%d", index), Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 100000, Group: "default", ModelLimitsEnabled: true, ModelLimits: limits}
			if tc.tokenLow {
				token.RemainQuota = 1000
			}
			require.NoError(t, db.Create(&token).Error)
			userID.Store(int64(user.Id))
			tokenID.Store(int64(token.Id))
			failMode.Store(0)
			if tc.fail {
				failMode.Store(1)
			}
			if tc.truncated {
				failMode.Store(2)
			}
			before := requests.Load()
			body := `{"text":"offline fixture sound","duration_seconds":3.2}`
			if tc.version != "" {
				body = fmt.Sprintf(`{"text":"offline fixture sound","duration_seconds":3.2,"model_id":%q}`, tc.version)
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/sound-generation?enable_logging=false&output_format=mp3_44100_128", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if !tc.noAuth {
				req.Header.Set("Authorization", "Bearer sk-"+token.Key)
			}
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, req)
			require.Equal(t, tc.status, response.Code, response.Body.String())
			assert.NotEmpty(t, response.Header().Get(common.RequestIdKey))
			submitted := tc.status == 200 || tc.fail || tc.truncated
			if submitted {
				require.Equal(t, before+1, requests.Load(), "never resubmit a paid generation")
				got := <-observed
				require.NoError(t, got.err)
				assert.Equal(t, initial-2500, got.userQuota, "ceil(3.2)*1250*special-group(0.5) reserved before provider")
				assert.Equal(t, 100000-2500, got.tokenQuota)
				assert.Equal(t, 2500, got.tokenUsed)
				assert.Equal(t, tc.expectedVersion, got.version)
				assert.Equal(t, "/v1/sound-generation", got.path)
				assert.Equal(t, "enable_logging=false&output_format=mp3_44100_128", got.query)
				assert.Equal(t, "Bearer fixture-provider", got.auth)
			} else {
				assert.Equal(t, before, requests.Load())
			}
			// Refund is asynchronous in the existing billing session; wait for the
			// externally observable wallet AND token state, never a fixed sleep.
			require.EventuallyWithT(t, func(c *assert.CollectT) {
				var gotUser model.User
				var gotToken model.Token
				if !assert.NoError(c, db.First(&gotUser, user.Id).Error) || !assert.NoError(c, db.First(&gotToken, token.Id).Error) {
					return
				}
				assert.Equal(c, initial-tc.charge, gotUser.Quota)
				assert.Equal(c, token.RemainQuota-tc.charge, gotToken.RemainQuota)
				assert.Equal(c, tc.charge, gotToken.UsedQuota)
			}, time.Second*3, time.Millisecond*10)
			var finalUser model.User
			require.NoError(t, db.First(&finalUser, user.Id).Error)
			assert.Equal(t, tc.charge, finalUser.UsedQuota)
			var logs []model.Log
			require.NoError(t, db.Where("user_id = ? AND type = ?", user.Id, model.LogTypeConsume).Find(&logs).Error)
			if tc.charge > 0 {
				assert.Equal(t, audio, response.Body.Bytes())
				assert.Equal(t, "2", response.Header().Get("X-Sound-Billable-Seconds"))
				require.Len(t, logs, 1)
				assert.Equal(t, tapcomfy.ElevenLabsSoundModel, logs[0].ModelName)
				assert.Equal(t, 1250, logs[0].Quota)
				assert.Equal(t, 0, logs[0].PromptTokens)
				var other map[string]any
				require.NoError(t, common.Unmarshal([]byte(logs[0].Other), &other))
				assert.Equal(t, "second", other["billing_usage_unit"])
				assert.Equal(t, 0.5, other["group_ratio"])
				assert.Equal(t, float64(2), other["sound_billable_seconds"])
				assert.Equal(t, 1, finalUser.RequestCount)
			} else {
				assert.Empty(t, logs)
				assert.Zero(t, finalUser.RequestCount)
			}
		})
	}
	var finalChannel model.Channel
	require.NoError(t, db.First(&finalChannel, channel.Id).Error)
	assert.Equal(t, int64(2500), finalChannel.UsedQuota)
}

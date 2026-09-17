package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
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

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/models/"+created.ID, nil))
	assert.Equal(t, http.StatusNoContent, recorder.Code)
}

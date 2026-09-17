package tapcomfy

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestFetchLegacyModelsPaginatesAndRejectsNonSuccess(t *testing.T) {
	requests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		require.Equal(t, "Bearer service-role", request.Header.Get("Authorization"))
		require.Equal(t, "service-role", request.Header.Get("apikey"))
		switch request.Header.Get("Range") {
		case "0-1":
			requests++
			_, _ = w.Write([]byte(`[{"id":"one","name":"One","category":"JC","image_url":"https://legacy.example/3d_models/one.png","model_url":"https://legacy.example/3d_models/one.glb"},{"id":"two","name":"Two","category":"JC","image_url":"https://legacy.example/3d_models/two.png","model_url":"https://legacy.example/3d_models/two.glb"}]`))
		case "2-3":
			requests++
			_, _ = w.Write([]byte(`[{"id":"three","name":"Three","category":"JC","image_url":"https://legacy.example/3d_models/three.png","model_url":"https://legacy.example/3d_models/three.glb"}]`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer server.Close()

	rows, err := fetchLegacyModels(context.Background(), server.Client(), server.URL, "service-role", 2)
	require.NoError(t, err)
	assert.Len(t, rows, 3)
	assert.Equal(t, 2, requests)

	failed := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer failed.Close()
	_, err = fetchLegacyModels(context.Background(), failed.Client(), failed.URL, "service-role", 2)
	require.Error(t, err)

	_, err = FetchLegacyModels(context.Background(), "http://legacy.example", "service-role", 2)
	require.Error(t, err)
}

func TestImportLegacyModelsCopiesPublishedMetadataAndIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:tapcomfy-import?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.TapComfyModel{}))

	rows := []LegacyModel{
		{
			ID:        "legacy-chair",
			Name:      " Chair ",
			Category:  "JC",
			ImageURL:  "https://legacy.example/3d_models/chair.png",
			ModelURL:  "https://legacy.example/3d_models/chair.glb",
			CreatedAt: "2026-01-02T03:04:05Z",
			Sort:      7,
		},
	}
	uploads := 0
	upload := func(_ context.Context, assetType, sourceURL string) (*UploadedAsset, int64, error) {
		uploads++
		if assetType == "3d-thumbnail" {
			assert.Equal(t, "https://legacy.example/3d_models/chair.png", sourceURL)
			return &UploadedAsset{URL: "https://assets.example/3d_models/thumbnails/chair.png", ObjectKey: "3d_models/thumbnails/chair.png", AssetType: assetType}, 12, nil
		}
		assert.Equal(t, "https://legacy.example/3d_models/chair.glb", sourceURL)
		return &UploadedAsset{URL: "https://assets.example/3d_models/models/chair.glb", ObjectKey: "3d_models/models/chair.glb", AssetType: assetType}, 34, nil
	}

	result, err := ImportLegacyModels(context.Background(), db, rows, upload)
	require.NoError(t, err)
	assert.Equal(t, LegacyImportResult{Created: 1}, result)
	assert.Equal(t, 2, uploads)

	var imported model.TapComfyModel
	require.NoError(t, db.First(&imported, "id = ?", "legacy-chair").Error)
	assert.Equal(t, "Chair", imported.Name)
	assert.Equal(t, "glb", imported.Format)
	assert.Equal(t, int64(34), imported.FileSize)
	assert.Equal(t, model.TapComfyModelStatusPublished, imported.Status)
	assert.Equal(t, "3d_models/models/chair.glb", imported.ModelObjectKey)

	result, err = ImportLegacyModels(context.Background(), db, rows, upload)
	require.NoError(t, err)
	assert.Equal(t, LegacyImportResult{Skipped: 1}, result)
	assert.Equal(t, 2, uploads)
}

func TestImportLegacyModelsRejectsInvalidRowsWithoutWritingMetadata(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:tapcomfy-import-invalid?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.TapComfyModel{}))

	_, err = ImportLegacyModels(context.Background(), db, []LegacyModel{{
		ID:       "bad",
		Name:     "Bad",
		Category: "JC",
		ImageURL: "https://legacy.example/3d_models/chair.png",
		ModelURL: "https://legacy.example/3d_models/chair.exe",
	}}, func(context.Context, string, string) (*UploadedAsset, int64, error) {
		return nil, 0, errors.New("must not upload")
	})
	require.Error(t, err)

	var count int64
	require.NoError(t, db.Model(&model.TapComfyModel{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestParseLegacyAssetURLUpgradesHTTPWithoutPermittingOtherSchemes(t *testing.T) {
	parsed, err := parseLegacyAssetURL("http://legacy.example/3d_models/chair.glb", "3d-model")
	require.NoError(t, err)
	assert.Equal(t, "https", parsed.Scheme)

	_, err = parseLegacyAssetURL("ftp://legacy.example/3d_models/chair.glb", "3d-model")
	require.Error(t, err)
}

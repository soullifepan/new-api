package tapcomfy

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAssumeRoleReturnsLegacyStorageContract(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "AssumeRole", r.URL.Query().Get("Action"))
		assert.NotEmpty(t, r.URL.Query().Get("Signature"))
		_, _ = io.WriteString(w, `{"Credentials":{"AccessKeyId":"temporary-id","AccessKeySecret":"temporary-secret","SecurityToken":"temporary-token","Expiration":"2026-09-17T14:00:00Z"}}`)
	}))
	defer server.Close()
	original := http.DefaultClient
	http.DefaultClient = server.Client()
	t.Cleanup(func() { http.DefaultClient = original })

	config := Config{OSSEndpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "tapcomfy-models", Region: "cn-hangzhou", AccessKeyID: "id", AccessKeySecret: "secret", STSEndpoint: server.URL, STSRoleARN: "acs:ram::123:role/tapcomfy"}
	credentials, err := config.AssumeRole(context.Background())
	require.NoError(t, err)
	assert.Equal(t, &STSCredentials{AccessKeyID: "temporary-id", AccessKeySecret: "temporary-secret", SecurityToken: "temporary-token", Expiration: "2026-09-17T14:00:00Z", Bucket: "tapcomfy-models", Region: "cn-hangzhou"}, credentials)
}

func TestStorageValidationAndAssetWhitelist(t *testing.T) {
	assert.ErrorIs(t, Config{}.validate(true), ErrNotConfigured)
	assert.Error(t, Config{OSSEndpoint: "http://oss.example.com", Bucket: "bucket", Region: "region", AccessKeyID: "id", AccessKeySecret: "secret"}.validate(false))

	directory, limit, extensions := assetRules("3d-model")
	assert.Equal(t, "3d_models/models/", directory)
	assert.Equal(t, int64(100<<20), limit)
	assert.True(t, extensions[".glb"])
	assert.False(t, extensions[".exe"])
	directory, limit, extensions = assetRules("3d-thumbnail")
	assert.Equal(t, "3d_models/thumbnails/", directory)
	assert.Equal(t, int64(10<<20), limit)
	assert.True(t, extensions[".png"])
	directory, _, _ = assetRules("../3d-model")
	assert.Empty(t, directory)
	configured := Config{OSSEndpoint: "https://oss.example.com", Bucket: "bucket", Region: "region", AccessKeyID: "id", AccessKeySecret: "secret"}
	_, err := configured.UploadAsset(context.Background(), "3d-model", "payload.exe", "application/octet-stream", 1, bytes.NewReader([]byte("x")))
	assert.ErrorIs(t, err, ErrInvalidAsset)
	_, err = configured.UploadAsset(context.Background(), "3d-thumbnail", "preview.png", "image/png", 11<<20, bytes.NewReader([]byte("x")))
	assert.ErrorIs(t, err, ErrInvalidAsset)
}

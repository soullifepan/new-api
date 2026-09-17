package tapcomfy

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/aliyun/alibaba-cloud-sdk-go/services/sts"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAssumeRoleReturnsLegacyStorageContract(t *testing.T) {
	config := Config{Bucket: "tapcomfy-models", Region: "cn-hangzhou"}
	credentials, err := config.storageCredentials(sts.Credentials{AccessKeyId: "temporary-id", AccessKeySecret: "temporary-secret", SecurityToken: "temporary-token", Expiration: "2026-09-17T14:00:00Z"})
	require.NoError(t, err)
	assert.Equal(t, &STSCredentials{AccessKeyID: "temporary-id", AccessKeySecret: "temporary-secret", SecurityToken: "temporary-token", Expiration: "2026-09-17T14:00:00Z", Bucket: "tapcomfy-models", Region: "cn-hangzhou"}, credentials)
	_, err = config.storageCredentials(sts.Credentials{AccessKeyId: "temporary-id"})
	assert.ErrorContains(t, err, "incomplete")
}

func TestStorageHTTPGuardsRejectRedirectsAndTimeouts(t *testing.T) {
	redirect := &rejectRedirectTransport{base: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusFound, Body: http.NoBody}, nil
	})}
	_, err := (&http.Client{Transport: redirect, Timeout: 20 * time.Millisecond}).Get("https://storage.example.com")
	assert.ErrorContains(t, err, "redirects are not allowed")
	timeout := &rejectRedirectTransport{base: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	client := &http.Client{Transport: timeout, Timeout: 20 * time.Millisecond}
	_, err = client.Get("https://storage.example.com")
	assert.Error(t, err)
	assert.True(t, errors.Is(err, context.DeadlineExceeded))
}

func TestAssumeRoleRejectsUpstreamNonSuccess(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assert.Equal(t, http.MethodPost, request.Method)
		writer.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(writer, `{"Message":"unavailable"}`)
	}))
	defer server.Close()
	endpoint, err := url.Parse(server.URL)
	require.NoError(t, err)
	transport := server.Client().Transport.(*http.Transport).Clone()
	config := Config{OSSEndpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "tapcomfy-models", Region: "cn-hangzhou", AccessKeyID: "id", AccessKeySecret: "secret", STSEndpoint: server.URL, STSRoleARN: "acs:ram::123:role/tapcomfy"}
	_, err = config.assumeRole(context.Background(), transport)
	require.Error(t, err)
	assert.Contains(t, endpoint.Host, "127.0.0.1")
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
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
	_, ok := assetContentAllowed("3d-thumbnail", ".png", "image/png", []byte{'\x89', 'P', 'N', 'G', '\r', '\n', '\x1a', '\n'})
	assert.True(t, ok)
	_, ok = assetContentAllowed("3d-thumbnail", ".png", "image/png", []byte("not a PNG"))
	assert.False(t, ok)
	config := Config{OSSEndpoint: "https://oss.example.com", Bucket: "bucket", Region: "region", AccessKeyID: "id", AccessKeySecret: "secret"}
	assert.True(t, config.ValidateAssetReference("3d-model", "3d_models/models/example.glb", "https://bucket.oss.example.com/3d_models/models/example.glb"))
	assert.False(t, config.ValidateAssetReference("3d-model", "3d_models/models/../secret.glb", "https://bucket.oss.example.com/3d_models/models/../secret.glb"))
	assert.False(t, Config{}.ValidateAssetReference("3d-model", "3d_models/models/example.glb", "https://bucket.oss.example.com/3d_models/models/example.glb"))
}

func TestAssetContentAllowedValidates3DFormatsAndMIME(t *testing.T) {
	for _, testCase := range []struct {
		name, extension, declared string
		content                   []byte
		allowed                   bool
	}{
		{"GLB magic with empty MIME", ".glb", "", append([]byte("glTF"), make([]byte, 8)...), true},
		{"GLB rejects wrong magic", ".glb", "application/octet-stream", []byte("not-a-glb-file"), false},
		{"GLTF structured JSON", ".gltf", "application/octet-stream", []byte(`{"asset":{"version":"2.0"},"scenes":[]}`), true},
		{"GLTF rejects unrelated JSON", ".gltf", "", []byte(`{"name":"not gltf"}`), false},
		{"FBX binary header", ".fbx", "", []byte("Kaydara FBX Binary  \x00\x1a\x00\x00"), true},
		{"FBX ASCII header", ".fbx", "model/fbx", []byte("; FBX 7.4.0 project file\n"), true},
		{"FBX rejects generic binary", ".fbx", "application/octet-stream", []byte{0, 1, 2, 3}, false},
		{"OBJ instruction", ".obj", "", []byte("# mesh\nv 0 0 0\nf 1 1 1\n"), true},
		{"OBJ rejects arbitrary text", ".obj", "model/obj", []byte("hello world"), false},
		{"model MIME rejects unrelated declaration", ".obj", "text/plain", []byte("v 0 0 0\n"), false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, allowed := assetContentAllowed("3d-model", testCase.extension, testCase.declared, testCase.content)
			assert.Equal(t, testCase.allowed, allowed)
		})
	}
}

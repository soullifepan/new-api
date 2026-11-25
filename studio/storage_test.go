package studio

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/aliyun/alibaba-cloud-sdk-go/services/sts"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestS3CredentialsAreScopedToAuthenticatedUser(t *testing.T) {
	storage := S3Config{Region: "ap-southeast-1", Bucket: "cines-uploads", AssetsBucket: "cines-assets", PublicBaseURL: "https://media.example.com/", AssetsPublicBaseURL: "https://media.example.com", UploadRoleARN: "arn:aws:iam::123456789012:role/client-upload"}
	for _, test := range []struct {
		name, expiration string
		userID           int
		wantError        string
	}{
		{"scoped temporary credentials", "2099-01-01T00:00:00Z", 42, ""},
		{"expired response rejected", "2000-01-01T00:00:00Z", 42, "expired"},
		{"no identity never calls STS", "2099-01-01T00:00:00Z", 0, "authenticated"},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			config := aws.Config{Region: storage.Region, Credentials: credentials.NewStaticCredentialsProvider("test-id", "test-secret", "test-session"), RetryMaxAttempts: 1,
				HTTPClient: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
					called = true
					body, err := io.ReadAll(request.Body)
					require.NoError(t, err)
					values, err := url.ParseQuery(string(body))
					require.NoError(t, err)
					assert.Equal(t, "AssumeRole", values.Get("Action"))
					assert.Equal(t, "3600", values.Get("DurationSeconds"))
					assert.Equal(t, storage.UploadRoleARN, values.Get("RoleArn"))
					var policy map[string]any
					require.NoError(t, common.UnmarshalJsonStr(values.Get("Policy"), &policy))
					assert.Equal(t, map[string]any{"Version": "2012-10-17", "Statement": []any{map[string]any{"Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::cines-uploads/temp/42/*"}}}, policy)
					response := `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials><AccessKeyId>temporary-id</AccessKeyId><SecretAccessKey>temporary-secret</SecretAccessKey><SessionToken>temporary-token</SessionToken><Expiration>` + test.expiration + `</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`
					return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"text/xml"}}, Body: io.NopCloser(strings.NewReader(response))}, nil
				})}}
			result, err := storage.assumeRole(context.Background(), test.userID, config)
			if test.wantError != "" {
				require.ErrorContains(t, err, test.wantError)
				assert.Equal(t, test.userID > 0, called)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "s3", result.Provider)
			assert.Equal(t, "temp/42/", result.KeyPrefix)
			assert.Equal(t, "https://cines-uploads.s3.ap-southeast-1.amazonaws.com", result.Endpoint)
			assert.Equal(t, "https://media.example.com", result.PublicBaseURL)
			assert.Equal(t, 604800, result.ObjectTTLSeconds)
			assert.Equal(t, 590400, result.CacheTTLSeconds)
			assert.Equal(t, "temporary-token", result.SecurityToken)
		})
	}
}

func TestS3AssetsStreamToPrivateBucketAndValidateCDNReference(t *testing.T) {
	storage := S3Config{Region: "ap-southeast-1", Bucket: "cines-uploads", AssetsBucket: "cines-assets", PublicBaseURL: "https://media.example.com", AssetsPublicBaseURL: "https://media.example.com"}
	config := Config{Provider: "s3", S3: storage}
	assert.NoError(t, config.validate(false))
	assert.ErrorIs(t, config.validate(true), ErrNotConfigured)
	assert.True(t, config.ValidateAssetReference("3d-model", "3d_models/models/a.glb", "https://media.example.com/3d_models/models/a.glb"))
	assert.False(t, config.ValidateAssetReference("3d-model", "3d_models/models/a.glb", "https://evil.example/3d_models/models/a.glb"))
	assert.False(t, config.ValidateAssetReference("3d-model", "3d_models/models/../a.glb", "https://media.example.com/3d_models/models/../a.glb"))
	assert.Error(t, Config{Provider: "unknown"}.validate(false))
	payload := "glTFmodel-bytes"
	awsConfig := aws.Config{Region: storage.Region, Credentials: credentials.NewStaticCredentialsProvider("test-id", "test-secret", "test-session"), RetryMaxAttempts: 1,
		HTTPClient: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			assert.Equal(t, "cines-assets.s3.ap-southeast-1.amazonaws.com", request.URL.Host)
			assert.Equal(t, "/3d_models/models/a.glb", request.URL.Path)
			assert.Equal(t, int64(len(payload)), request.ContentLength)
			assert.Equal(t, "model/gltf-binary", request.Header.Get("Content-Type"))
			assert.Empty(t, request.Header.Get("X-Amz-Acl"))
			assert.Equal(t, "test-session", request.Header.Get("X-Amz-Security-Token"))
			body, err := io.ReadAll(request.Body)
			require.NoError(t, err)
			assert.Equal(t, payload, string(body))
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: http.NoBody}, nil
		})}}
	asset, err := storage.uploadAsset(context.Background(), awsConfig, "3d-model", "3d_models/models/a.glb", "model/gltf-binary", int64(len(payload)), io.MultiReader(strings.NewReader(payload[:4]), strings.NewReader(payload[4:])))
	require.NoError(t, err)
	assert.Equal(t, "https://media.example.com/3d_models/models/a.glb", asset.URL)
}

func TestClientDiagnosticsUseFixedDestinationAndServerIdentity(t *testing.T) {
	input := ClientLogInput{Source: "backend", Operation: "upload", ErrorType: "network", Message: "Authorization: Bearer private-jwt\nfailed project://private/file.png", Stack: `password="hidden value" token=hidden-token`, AppVersion: "1.2.3"}
	require.NoError(t, input.Validate())
	config := ClientLogConfig{Region: "ap-southeast-1", Group: "/cines/client-errors", Stream: "application-errors"}
	awsConfig := aws.Config{Region: config.Region, Credentials: credentials.NewStaticCredentialsProvider("test-id", "test-secret", "test-session"), RetryMaxAttempts: 1,
		HTTPClient: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			assert.Equal(t, "logs.ap-southeast-1.amazonaws.com", request.URL.Host)
			body, err := io.ReadAll(request.Body)
			require.NoError(t, err)
			var envelope struct {
				LogGroupName  string `json:"logGroupName"`
				LogStreamName string `json:"logStreamName"`
				LogEvents     []struct {
					Message   string `json:"message"`
					Timestamp int64  `json:"timestamp"`
				} `json:"logEvents"`
			}
			require.NoError(t, common.Unmarshal(body, &envelope))
			assert.Equal(t, config.Group, envelope.LogGroupName)
			assert.Equal(t, config.Stream, envelope.LogStreamName)
			require.Len(t, envelope.LogEvents, 1)
			var event map[string]any
			require.NoError(t, common.UnmarshalJsonStr(envelope.LogEvents[0].Message, &event))
			assert.Equal(t, float64(42), event["user_id"])
			assert.Equal(t, "application_error", event["event"])
			assert.Len(t, event["fingerprint"], 64)
			for _, secret := range []string{"private-jwt", "private/file.png", "hidden value", "hidden-token"} {
				assert.NotContains(t, envelope.LogEvents[0].Message, secret)
			}
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/x-amz-json-1.1"}}, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
		})}}
	require.NoError(t, config.write(context.Background(), 42, input, awsConfig))
	input.Source = "untrusted"
	assert.ErrorIs(t, input.Validate(), ErrInvalidClientLog)
	input.Source, input.Message = "frontend", strings.Repeat("界", 1025)
	assert.ErrorIs(t, input.Validate(), ErrInvalidClientLog)
}

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

func TestLoadConfigSupportsStudioAndLegacyTapComfyEnvFallback(t *testing.T) {
	t.Setenv("STUDIO_STORAGE_PROVIDER", "")
	t.Setenv("TAPCOMFY_STORAGE_PROVIDER", "s3")
	t.Setenv("STUDIO_S3_REGION", "")
	t.Setenv("TAPCOMFY_S3_REGION", "ap-southeast-1")
	t.Setenv("STUDIO_S3_BUCKET", "")
	t.Setenv("TAPCOMFY_S3_BUCKET", "legacy-uploads")
	t.Setenv("STUDIO_S3_ASSETS_BUCKET", "")
	t.Setenv("TAPCOMFY_S3_ASSETS_BUCKET", "legacy-assets")
	t.Setenv("STUDIO_S3_PUBLIC_BASE_URL", "")
	t.Setenv("TAPCOMFY_S3_PUBLIC_BASE_URL", "https://media.example.com")
	t.Setenv("STUDIO_S3_ASSETS_PUBLIC_BASE_URL", "")
	t.Setenv("TAPCOMFY_S3_ASSETS_PUBLIC_BASE_URL", "https://assets.example.com")
	t.Setenv("STUDIO_S3_UPLOAD_ROLE_ARN", "")
	t.Setenv("TAPCOMFY_S3_UPLOAD_ROLE_ARN", "arn:aws:iam::123456789012:role/legacy")
	t.Setenv("STUDIO_CLIENT_LOG_GROUP", "")
	t.Setenv("TAPCOMFY_CLIENT_LOG_GROUP", "/cines/client-errors")
	t.Setenv("STUDIO_CLIENT_LOG_STREAM", "")
	t.Setenv("TAPCOMFY_CLIENT_LOG_STREAM", "application-errors")

	cfg := LoadConfig()
	assert.Equal(t, "s3", cfg.Provider)
	assert.Equal(t, "ap-southeast-1", cfg.S3.Region)
	assert.Equal(t, "legacy-uploads", cfg.S3.Bucket)
	assert.Equal(t, "legacy-assets", cfg.S3.AssetsBucket)
	assert.Equal(t, "https://media.example.com", cfg.S3.PublicBaseURL)
	assert.Equal(t, "https://assets.example.com", cfg.S3.AssetsPublicBaseURL)
	assert.Equal(t, "arn:aws:iam::123456789012:role/legacy", cfg.S3.UploadRoleARN)

	logCfg := LoadClientLogConfig()
	assert.Equal(t, "/cines/client-errors", logCfg.Group)
	assert.Equal(t, "application-errors", logCfg.Stream)

	t.Setenv("STUDIO_S3_BUCKET", "studio-uploads")
	t.Setenv("STUDIO_CLIENT_LOG_GROUP", "/studio/client-errors")
	cfg = LoadConfig()
	assert.Equal(t, "studio-uploads", cfg.S3.Bucket)
	assert.Equal(t, "/studio/client-errors", LoadClientLogConfig().Group)
}

// Package studio contains isolated integrations required by the Studio UI.
package studio

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk/auth/credentials"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk/requests"
	"github.com/aliyun/alibaba-cloud-sdk-go/services/sts"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/google/uuid"
)

const (
	StorageProviderEnv               = "STUDIO_STORAGE_PROVIDER"
	StorageProviderFallbackEnv       = "TAPCOMFY_STORAGE_PROVIDER"
	S3RegionEnv                      = "STUDIO_S3_REGION"
	S3RegionFallbackEnv              = "TAPCOMFY_S3_REGION"
	S3BucketEnv                      = "STUDIO_S3_BUCKET"
	S3BucketFallbackEnv              = "TAPCOMFY_S3_BUCKET"
	S3AssetsBucketEnv                = "STUDIO_S3_ASSETS_BUCKET"
	S3AssetsBucketFallbackEnv        = "TAPCOMFY_S3_ASSETS_BUCKET"
	S3PublicBaseURLEnv               = "STUDIO_S3_PUBLIC_BASE_URL"
	S3PublicBaseURLFallbackEnv       = "TAPCOMFY_S3_PUBLIC_BASE_URL"
	S3AssetsPublicBaseURLEnv         = "STUDIO_S3_ASSETS_PUBLIC_BASE_URL"
	S3AssetsPublicBaseURLFallbackEnv = "TAPCOMFY_S3_ASSETS_PUBLIC_BASE_URL"
	S3UploadRoleARNEnv               = "STUDIO_S3_UPLOAD_ROLE_ARN"
	S3UploadRoleARNFallbackEnv       = "TAPCOMFY_S3_UPLOAD_ROLE_ARN"
	OSSEndpointEnv                   = "STUDIO_OSS_ENDPOINT"
	OSSEndpointFallbackEnv           = "TAPCOMFY_OSS_ENDPOINT"
	OSSBucketEnv                     = "STUDIO_OSS_BUCKET"
	OSSBucketFallbackEnv             = "TAPCOMFY_OSS_BUCKET"
	OSSAssetsBucketEnv               = "STUDIO_OSS_ASSETS_BUCKET"
	OSSAssetsBucketFallbackEnv       = "TAPCOMFY_OSS_ASSETS_BUCKET"
	OSSRegionEnv                     = "STUDIO_OSS_REGION"
	OSSRegionFallbackEnv             = "TAPCOMFY_OSS_REGION"
	OSSAccessKeyIDEnv                = "STUDIO_OSS_ACCESS_KEY_ID"
	OSSAccessKeyIDFallbackEnv        = "TAPCOMFY_OSS_ACCESS_KEY_ID"
	OSSAccessKeySecretEnv            = "STUDIO_OSS_ACCESS_KEY_SECRET"
	OSSAccessKeySecretFallbackEnv    = "TAPCOMFY_OSS_ACCESS_KEY_SECRET"
	OSSPublicBaseURLEnv              = "STUDIO_OSS_PUBLIC_BASE_URL"
	OSSPublicBaseURLFallbackEnv      = "TAPCOMFY_OSS_PUBLIC_BASE_URL"
	STSEndpointEnv                   = "STUDIO_STS_ENDPOINT"
	STSEndpointFallbackEnv           = "TAPCOMFY_STS_ENDPOINT"
	STSRoleARNEnv                    = "STUDIO_STS_ROLE_ARN"
	STSRoleARNFallbackEnv            = "TAPCOMFY_STS_ROLE_ARN"
)

var (
	ErrNotConfigured = errors.New("Studio storage is not configured")
	ErrInvalidAsset  = errors.New("invalid Studio asset")
)

const (
	storageConnectTimeout = 5 * time.Second
	storageRequestTimeout = 30 * time.Second
)

func envOrFallback(primary, fallback, defaultValue string) string {
	if value := os.Getenv(primary); value != "" {
		return value
	}
	if fallback != "" {
		if value := os.Getenv(fallback); value != "" {
			return value
		}
	}
	return defaultValue
}

type Config struct {
	Provider                                                                                                        string
	S3                                                                                                              S3Config
	OSSEndpoint, Bucket, AssetsBucket, Region, AccessKeyID, AccessKeySecret, PublicBaseURL, STSEndpoint, STSRoleARN string
}

func LoadConfig() Config {
	bucket := envOrFallback(OSSBucketEnv, OSSBucketFallbackEnv, "")
	return Config{
		Provider: envOrFallback(StorageProviderEnv, StorageProviderFallbackEnv, "oss"),
		S3: S3Config{
			Region:              envOrFallback(S3RegionEnv, S3RegionFallbackEnv, ""),
			Bucket:              envOrFallback(S3BucketEnv, S3BucketFallbackEnv, ""),
			AssetsBucket:        envOrFallback(S3AssetsBucketEnv, S3AssetsBucketFallbackEnv, ""),
			PublicBaseURL:       envOrFallback(S3PublicBaseURLEnv, S3PublicBaseURLFallbackEnv, ""),
			AssetsPublicBaseURL: envOrFallback(S3AssetsPublicBaseURLEnv, S3AssetsPublicBaseURLFallbackEnv, ""),
			UploadRoleARN:       envOrFallback(S3UploadRoleARNEnv, S3UploadRoleARNFallbackEnv, ""),
		},
		OSSEndpoint:     envOrFallback(OSSEndpointEnv, OSSEndpointFallbackEnv, ""),
		Bucket:          bucket,
		AssetsBucket:    envOrFallback(OSSAssetsBucketEnv, OSSAssetsBucketFallbackEnv, bucket),
		Region:          envOrFallback(OSSRegionEnv, OSSRegionFallbackEnv, ""),
		AccessKeyID:     envOrFallback(OSSAccessKeyIDEnv, OSSAccessKeyIDFallbackEnv, ""),
		AccessKeySecret: envOrFallback(OSSAccessKeySecretEnv, OSSAccessKeySecretFallbackEnv, ""),
		PublicBaseURL:   envOrFallback(OSSPublicBaseURLEnv, OSSPublicBaseURLFallbackEnv, ""),
		STSEndpoint:     envOrFallback(STSEndpointEnv, STSEndpointFallbackEnv, "https://sts.aliyuncs.com"),
		STSRoleARN:      envOrFallback(STSRoleARNEnv, STSRoleARNFallbackEnv, ""),
	}
}

func (c Config) validate(requireRole bool) error {
	if c.Provider == "s3" {
		return c.S3.validate(requireRole)
	}
	if c.Provider != "" && c.Provider != "oss" {
		return ErrNotConfigured
	}
	if c.OSSEndpoint == "" || c.Bucket == "" || c.assetsBucket() == "" || c.Region == "" || c.AccessKeyID == "" || c.AccessKeySecret == "" || (requireRole && c.STSRoleARN == "") {
		return ErrNotConfigured
	}
	for _, raw := range []string{c.OSSEndpoint, c.STSEndpoint, c.PublicBaseURL} {
		if raw != "" {
			u, err := url.Parse(raw)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
				return fmt.Errorf("invalid Studio URL configuration")
			}
		}
	}
	return nil
}

func (c Config) assetsBucket() string {
	if c.AssetsBucket != "" {
		return c.AssetsBucket
	}
	return c.Bucket
}

type STSCredentials struct {
	Provider         string `json:"provider,omitempty"`
	AccessKeyID      string `json:"accessKeyId"`
	AccessKeySecret  string `json:"accessKeySecret"`
	SecurityToken    string `json:"securityToken"`
	Expiration       string `json:"expiration"`
	Bucket           string `json:"bucket"`
	Region           string `json:"region"`
	Endpoint         string `json:"endpoint,omitempty"`
	PublicBaseURL    string `json:"publicBaseUrl,omitempty"`
	KeyPrefix        string `json:"keyPrefix,omitempty"`
	ObjectTTLSeconds int    `json:"objectTtlSeconds,omitempty"`
	CacheTTLSeconds  int    `json:"cacheTtlSeconds,omitempty"`
}

func (c Config) AssumeRole(ctx context.Context, userID int) (*STSCredentials, error) {
	if err := c.validate(true); err != nil {
		return nil, err
	}
	if c.Provider == "s3" {
		if userID <= 0 {
			return nil, ErrInvalidStorageUser
		}
		config, err := loadAWSConfig(ctx, c.S3.Region)
		if err != nil {
			return nil, err
		}
		return c.S3.assumeRole(ctx, userID, config)
	}
	return c.assumeRole(ctx, http.DefaultTransport.(*http.Transport).Clone())
}

func (c Config) assumeRole(ctx context.Context, transport *http.Transport) (*STSCredentials, error) {
	endpoint, _ := url.Parse(c.STSEndpoint)
	client, err := sts.NewClientWithOptions(c.Region, sdk.NewConfig().WithScheme("HTTPS").WithTimeout(storageRequestTimeout).WithHttpTransport(transport), credentials.NewAccessKeyCredential(c.AccessKeyID, c.AccessKeySecret))
	if err != nil {
		return nil, err
	}
	client.SetTransport(&rejectRedirectTransport{base: transport})
	client.SetEndpointRules(map[string]string{c.Region: endpoint.Host}, "regional", "")
	request := sts.CreateAssumeRoleRequest()
	request.Method = requests.POST
	request.RoleArn = c.STSRoleARN
	request.RoleSessionName = "studio-storage"
	request.SetConnectTimeout(storageConnectTimeout)
	request.SetReadTimeout(storageRequestTimeout)
	response, err := client.AssumeRole(request)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.storageCredentials(response.Credentials)
}

func (c Config) storageCredentials(credentials sts.Credentials) (*STSCredentials, error) {
	if credentials.AccessKeyId == "" || credentials.AccessKeySecret == "" || credentials.SecurityToken == "" || credentials.Expiration == "" {
		return nil, errors.New("STS response is incomplete")
	}
	return &STSCredentials{AccessKeyID: credentials.AccessKeyId, AccessKeySecret: credentials.AccessKeySecret, SecurityToken: credentials.SecurityToken, Expiration: credentials.Expiration, Bucket: c.Bucket, Region: c.Region}, nil
}

type UploadedAsset struct {
	URL       string `json:"url"`
	ObjectKey string `json:"objectKey"`
	AssetType string `json:"assetType"`
}

func (c Config) UploadAsset(ctx context.Context, assetType, filename, contentType string, size int64, body io.Reader) (*UploadedAsset, error) {
	if err := c.validate(false); err != nil {
		return nil, err
	}
	directory, maxSize, allowed := assetRules(assetType)
	if directory == "" || size <= 0 || size > maxSize {
		return nil, ErrInvalidAsset
	}
	ext := strings.ToLower(path.Ext(filename))
	if !allowed[ext] {
		return nil, ErrInvalidAsset
	}
	declaredType, _, _ := mime.ParseMediaType(contentType)
	probe := make([]byte, 64<<10)
	n, readErr := io.ReadFull(body, probe)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return nil, ErrInvalidAsset
	}
	probe = probe[:n]
	storedContentType, ok := assetContentAllowed(assetType, ext, declaredType, probe)
	if !ok {
		return nil, ErrInvalidAsset
	}
	contentType = storedContentType
	objectKey := directory + uuid.NewString() + ext
	if c.Provider == "s3" {
		config, err := loadAWSConfig(ctx, c.S3.Region)
		if err != nil {
			return nil, err
		}
		return c.S3.uploadAsset(ctx, config, assetType, objectKey, contentType, size, io.MultiReader(bytes.NewReader(probe), body))
	}
	client, err := oss.New(c.OSSEndpoint, c.AccessKeyID, c.AccessKeySecret, oss.Timeout(5, 30), oss.HTTPClient(&http.Client{Timeout: storageRequestTimeout, Transport: &rejectRedirectTransport{base: http.DefaultTransport.(*http.Transport).Clone()}}))
	if err != nil {
		return nil, err
	}
	bucket, err := client.Bucket(c.assetsBucket())
	if err != nil {
		return nil, err
	}
	if err := bucket.PutObject(objectKey, io.MultiReader(bytes.NewReader(probe), body), oss.ContentType(contentType)); err != nil {
		return nil, err
	}
	base := strings.TrimSuffix(c.PublicBaseURL, "/")
	if base == "" {
		base = "https://" + c.assetsBucket() + "." + c.OSSEndpointHost()
	}
	return &UploadedAsset{URL: base + "/" + objectKey, ObjectKey: objectKey, AssetType: assetType}, nil
}

func (c Config) ValidateAssetReference(assetType, objectKey, assetURL string) bool {
	if c.validate(false) != nil {
		return false
	}
	directory, _, _ := assetRules(assetType)
	if directory == "" || !strings.HasPrefix(objectKey, directory) || strings.Contains(objectKey, "..") || strings.Contains(objectKey, "\\") || strings.ContainsAny(objectKey, "?#") {
		return false
	}
	ext := strings.ToLower(path.Ext(objectKey))
	_, _, allowed := assetRules(assetType)
	if !allowed[ext] || strings.TrimPrefix(objectKey, directory) == "" {
		return false
	}
	base := strings.TrimSuffix(c.PublicBaseURL, "/")
	if c.Provider == "s3" {
		base = strings.TrimSuffix(c.S3.AssetsPublicBaseURL, "/")
	}
	if base == "" {
		base = "https://" + c.assetsBucket() + "." + c.OSSEndpointHost()
	}
	return assetURL == base+"/"+objectKey
}

func assetContentAllowed(assetType, extension, declared string, content []byte) (string, bool) {
	if assetType == "3d-thumbnail" {
		detected := http.DetectContentType(content)
		if extension == ".png" && declared == "image/png" && detected == "image/png" {
			return detected, true
		}
		if (extension == ".jpg" || extension == ".jpeg") && declared == "image/jpeg" && detected == "image/jpeg" {
			return detected, true
		}
		if extension == ".webp" && declared == "image/webp" && detected == "image/webp" {
			return detected, true
		}
		return "", false
	}
	if !modelMIMEAllowed(extension, declared) {
		return "", false
	}
	switch extension {
	case ".glb":
		if len(content) >= 12 && bytes.Equal(content[:4], []byte{'g', 'l', 'T', 'F'}) {
			return "model/gltf-binary", true
		}
	case ".gltf":
		var document struct {
			Asset struct {
				Version string `json:"version"`
			} `json:"asset"`
		}
		if common.Unmarshal(content, &document) == nil && document.Asset.Version != "" {
			return "model/gltf+json", true
		}
	case ".fbx":
		if bytes.HasPrefix(content, []byte("Kaydara FBX Binary  \x00\x1a\x00")) || bytes.HasPrefix(content, []byte("; FBX ")) {
			return "model/fbx", true
		}
	case ".obj":
		for line := range strings.SplitSeq(string(content), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "v ") || strings.HasPrefix(line, "vt ") || strings.HasPrefix(line, "vn ") || strings.HasPrefix(line, "f ") || strings.HasPrefix(line, "o ") || strings.HasPrefix(line, "g ") {
				return "model/obj", true
			}
		}
	}
	return "", false
}

func modelMIMEAllowed(extension, declared string) bool {
	if declared == "" || declared == "application/octet-stream" {
		return true
	}
	return (extension == ".glb" && declared == "model/gltf-binary") || (extension == ".gltf" && (declared == "model/gltf+json" || declared == "application/json")) || (extension == ".fbx" && declared == "model/fbx") || (extension == ".obj" && declared == "model/obj")
}

type rejectRedirectTransport struct{ base http.RoundTripper }

func (t *rejectRedirectTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(request)
	if err != nil || response.StatusCode < 300 || response.StatusCode >= 400 {
		return response, err
	}
	response.Body.Close()
	return nil, fmt.Errorf("redirects are not allowed")
}

func (c Config) OSSEndpointHost() string { u, _ := url.Parse(c.OSSEndpoint); return u.Host }

func assetRules(assetType string) (string, int64, map[string]bool) {
	switch assetType {
	case "3d-model":
		return "3d_models/models/", 100 << 20, map[string]bool{".glb": true, ".gltf": true, ".fbx": true, ".obj": true}
	case "3d-thumbnail":
		return "3d_models/thumbnails/", 10 << 20, map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true}
	default:
		return "", 0, nil
	}
}

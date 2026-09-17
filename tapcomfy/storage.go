// Package tapcomfy contains isolated integrations required by the TapComfy UI.
package tapcomfy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
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
	OSSEndpointEnv        = "TAPCOMFY_OSS_ENDPOINT"
	OSSBucketEnv          = "TAPCOMFY_OSS_BUCKET"
	OSSAssetsBucketEnv    = "TAPCOMFY_OSS_ASSETS_BUCKET"
	OSSRegionEnv          = "TAPCOMFY_OSS_REGION"
	OSSAccessKeyIDEnv     = "TAPCOMFY_OSS_ACCESS_KEY_ID"
	OSSAccessKeySecretEnv = "TAPCOMFY_OSS_ACCESS_KEY_SECRET"
	OSSPublicBaseURLEnv   = "TAPCOMFY_OSS_PUBLIC_BASE_URL"
	STSEndpointEnv        = "TAPCOMFY_STS_ENDPOINT"
	STSRoleARNEnv         = "TAPCOMFY_STS_ROLE_ARN"
)

var (
	ErrNotConfigured = errors.New("TapComfy storage is not configured")
	ErrInvalidAsset  = errors.New("invalid TapComfy asset")
)

const (
	storageConnectTimeout = 5 * time.Second
	storageRequestTimeout = 30 * time.Second
)

type Config struct {
	OSSEndpoint, Bucket, AssetsBucket, Region, AccessKeyID, AccessKeySecret, PublicBaseURL, STSEndpoint, STSRoleARN string
}

func LoadConfig() Config {
	return Config{
		OSSEndpoint: common.GetEnvOrDefaultString(OSSEndpointEnv, ""), Bucket: common.GetEnvOrDefaultString(OSSBucketEnv, ""),
		AssetsBucket: common.GetEnvOrDefaultString(OSSAssetsBucketEnv, common.GetEnvOrDefaultString(OSSBucketEnv, "")), Region: common.GetEnvOrDefaultString(OSSRegionEnv, ""), AccessKeyID: common.GetEnvOrDefaultString(OSSAccessKeyIDEnv, ""),
		AccessKeySecret: common.GetEnvOrDefaultString(OSSAccessKeySecretEnv, ""), PublicBaseURL: common.GetEnvOrDefaultString(OSSPublicBaseURLEnv, ""),
		STSEndpoint: common.GetEnvOrDefaultString(STSEndpointEnv, "https://sts.aliyuncs.com"), STSRoleARN: common.GetEnvOrDefaultString(STSRoleARNEnv, ""),
	}
}

func (c Config) validate(requireRole bool) error {
	if c.OSSEndpoint == "" || c.Bucket == "" || c.assetsBucket() == "" || c.Region == "" || c.AccessKeyID == "" || c.AccessKeySecret == "" || (requireRole && c.STSRoleARN == "") {
		return ErrNotConfigured
	}
	for _, raw := range []string{c.OSSEndpoint, c.STSEndpoint, c.PublicBaseURL} {
		if raw != "" {
			u, err := url.Parse(raw)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
				return fmt.Errorf("invalid TapComfy URL configuration")
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
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	SecurityToken   string `json:"securityToken"`
	Expiration      string `json:"expiration"`
	Bucket          string `json:"bucket"`
	Region          string `json:"region"`
}

func (c Config) AssumeRole(ctx context.Context) (*STSCredentials, error) {
	if err := c.validate(true); err != nil {
		return nil, err
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
	request.RoleSessionName = "tapcomfy-storage"
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

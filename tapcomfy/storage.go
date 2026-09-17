// Package tapcomfy contains isolated integrations required by the TapComfy UI.
package tapcomfy

import (
	"context"
	"crypto/hmac"
	"crypto/sha1" // Alibaba Cloud STS SignatureVersion 1.0 requires HMAC-SHA1.
	"encoding/base64"
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
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

const (
	OSSEndpointEnv        = "TAPCOMFY_OSS_ENDPOINT"
	OSSBucketEnv          = "TAPCOMFY_OSS_BUCKET"
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

type Config struct {
	OSSEndpoint, Bucket, Region, AccessKeyID, AccessKeySecret, PublicBaseURL, STSEndpoint, STSRoleARN string
}

func LoadConfig() Config {
	return Config{
		OSSEndpoint: common.GetEnvOrDefaultString(OSSEndpointEnv, ""), Bucket: common.GetEnvOrDefaultString(OSSBucketEnv, ""),
		Region: common.GetEnvOrDefaultString(OSSRegionEnv, ""), AccessKeyID: common.GetEnvOrDefaultString(OSSAccessKeyIDEnv, ""),
		AccessKeySecret: common.GetEnvOrDefaultString(OSSAccessKeySecretEnv, ""), PublicBaseURL: common.GetEnvOrDefaultString(OSSPublicBaseURLEnv, ""),
		STSEndpoint: common.GetEnvOrDefaultString(STSEndpointEnv, "https://sts.aliyuncs.com"), STSRoleARN: common.GetEnvOrDefaultString(STSRoleARNEnv, ""),
	}
}

func (c Config) validate(requireRole bool) error {
	if c.OSSEndpoint == "" || c.Bucket == "" || c.Region == "" || c.AccessKeyID == "" || c.AccessKeySecret == "" || (requireRole && c.STSRoleARN == "") {
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
	params := url.Values{"Action": {"AssumeRole"}, "Version": {"2015-04-01"}, "Format": {"JSON"}, "AccessKeyId": {c.AccessKeyID}, "SignatureMethod": {"HMAC-SHA1"}, "Timestamp": {time.Now().UTC().Format("2006-01-02T15:04:05Z")}, "SignatureVersion": {"1.0"}, "SignatureNonce": {uuid.NewString()}, "RoleArn": {c.STSRoleARN}, "RoleSessionName": {"tapcomfy-storage"}}
	canonical := params.Encode()
	toSign := "GET&%2F&" + url.QueryEscape(canonical)
	mac := hmac.New(sha1.New, []byte(c.AccessKeySecret+"&"))
	_, _ = mac.Write([]byte(toSign))
	params.Set("Signature", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.STSEndpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("STS returned %s", response.Status)
	}
	var payload struct {
		Credentials struct {
			AccessKeyID     string `json:"AccessKeyId"`
			AccessKeySecret string `json:"AccessKeySecret"`
			SecurityToken   string `json:"SecurityToken"`
			Expiration      string `json:"Expiration"`
		} `json:"Credentials"`
	}
	if err := common.DecodeJson(response.Body, &payload); err != nil {
		return nil, err
	}
	if payload.Credentials.AccessKeyID == "" || payload.Credentials.AccessKeySecret == "" || payload.Credentials.SecurityToken == "" || payload.Credentials.Expiration == "" {
		return nil, errors.New("STS response is incomplete")
	}
	return &STSCredentials{AccessKeyID: payload.Credentials.AccessKeyID, AccessKeySecret: payload.Credentials.AccessKeySecret, SecurityToken: payload.Credentials.SecurityToken, Expiration: payload.Credentials.Expiration, Bucket: c.Bucket, Region: c.Region}, nil
}

type UploadedAsset struct {
	URL string `json:"url"`
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
	contentType, _, _ = mime.ParseMediaType(contentType)
	if contentType == "" {
		contentType = mime.TypeByExtension(ext)
	}
	objectKey := directory + uuid.NewString() + ext
	client := s3.New(s3.Options{Region: c.Region, BaseEndpoint: aws.String(c.OSSEndpoint), UsePathStyle: true, Credentials: credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.AccessKeySecret, "")})
	_, err := client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(c.Bucket), Key: aws.String(objectKey), Body: body, ContentType: aws.String(contentType)})
	if err != nil {
		return nil, err
	}
	base := strings.TrimSuffix(c.PublicBaseURL, "/")
	if base == "" {
		base = "https://" + c.Bucket + "." + c.OSSEndpointHost()
	}
	return &UploadedAsset{URL: base + "/" + objectKey}, nil
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

package studio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/arn"
	awsv4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

var ErrInvalidStorageUser = errors.New("authenticated storage user is required")

var s3BucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)
var awsRegionName = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]+$`)

// S3Config deliberately uses the AWS credential chain, not the legacy OSS keys.
// Public URLs come from the configured CDN; neither bucket needs a public ACL.
type S3Config struct {
	Region, Bucket, AssetsBucket, PublicBaseURL, AssetsPublicBaseURL, UploadRoleARN string
}

func (c S3Config) validate(requireRole bool) error {
	if c.Region == "" || c.Bucket == "" || c.AssetsBucket == "" || c.PublicBaseURL == "" || c.AssetsPublicBaseURL == "" || (requireRole && c.UploadRoleARN == "") {
		return ErrNotConfigured
	}
	if !awsRegionName.MatchString(c.Region) || !s3BucketName.MatchString(c.Bucket) || !s3BucketName.MatchString(c.AssetsBucket) {
		return errors.New("invalid S3 region or bucket")
	}
	for _, raw := range []string{c.PublicBaseURL, c.AssetsPublicBaseURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return errors.New("invalid S3 public URL")
		}
	}
	return nil
}

func loadAWSConfig(ctx context.Context, region string) (aws.Config, error) {
	return awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithRetryMaxAttempts(2),
		awsconfig.WithHTTPClient(&http.Client{
			Timeout:   storageRequestTimeout,
			Transport: &rejectRedirectTransport{base: http.DefaultTransport},
		}),
	)
}

func (c S3Config) assumeRole(ctx context.Context, userID int, config aws.Config) (*STSCredentials, error) {
	if userID <= 0 {
		return nil, ErrInvalidStorageUser
	}
	prefix := fmt.Sprintf("temp/%d/", userID)
	role, err := arn.Parse(c.UploadRoleARN)
	if err != nil || role.Service != "iam" || !strings.HasPrefix(role.Resource, "role/") || role.AccountID == "" {
		return nil, errors.New("invalid S3 upload role")
	}
	policy, err := common.Marshal(map[string]any{
		"Version": "2012-10-17",
		"Statement": []any{map[string]any{
			"Effect": "Allow", "Action": "s3:PutObject",
			"Resource": "arn:" + role.Partition + ":s3:::" + c.Bucket + "/" + prefix + "*",
		}},
	})
	if err != nil {
		return nil, err
	}
	result, err := sts.NewFromConfig(config).AssumeRole(ctx, &sts.AssumeRoleInput{
		RoleArn: aws.String(c.UploadRoleARN), RoleSessionName: aws.String(fmt.Sprintf("cines-user-%d", userID)),
		DurationSeconds: aws.Int32(3600), Policy: aws.String(string(policy)),
	})
	if err != nil {
		return nil, err
	}
	credentials := result.Credentials
	if credentials == nil || aws.ToString(credentials.AccessKeyId) == "" || aws.ToString(credentials.SecretAccessKey) == "" || aws.ToString(credentials.SessionToken) == "" || credentials.Expiration == nil || !credentials.Expiration.After(time.Now()) {
		return nil, errors.New("S3 temporary credentials are incomplete or expired")
	}
	suffix := "amazonaws.com"
	if strings.HasPrefix(c.Region, "cn-") {
		suffix = "amazonaws.com.cn"
	}
	return &STSCredentials{
		Provider: "s3", AccessKeyID: aws.ToString(credentials.AccessKeyId), AccessKeySecret: aws.ToString(credentials.SecretAccessKey),
		SecurityToken: aws.ToString(credentials.SessionToken), Expiration: credentials.Expiration.UTC().Format(time.RFC3339),
		Bucket: c.Bucket, Region: c.Region, Endpoint: "https://" + c.Bucket + ".s3." + c.Region + "." + suffix,
		PublicBaseURL: strings.TrimSuffix(c.PublicBaseURL, "/"), KeyPrefix: prefix,
		ObjectTTLSeconds: 7 * 24 * 60 * 60, CacheTTLSeconds: (6*24 + 20) * 60 * 60,
	}, nil
}

func (c S3Config) uploadAsset(ctx context.Context, config aws.Config, assetType, objectKey, contentType string, size int64, body io.Reader) (*UploadedAsset, error) {
	client := s3.NewFromConfig(config, func(options *s3.Options) {
		// The validated multipart upload is a bounded non-seekable reader after
		// content sniffing. HTTPS protects the streaming body without buffering
		// the whole (up to 100 MiB) model to calculate the SigV4 payload hash.
		options.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.AssetsBucket), Key: aws.String(objectKey), Body: body,
		ContentType: aws.String(contentType), ContentLength: aws.Int64(size),
	}, s3.WithAPIOptions(awsv4.SwapComputePayloadSHA256ForUnsignedPayloadMiddleware))
	if err != nil {
		return nil, err
	}
	return &UploadedAsset{URL: strings.TrimSuffix(c.AssetsPublicBaseURL, "/") + "/" + objectKey, ObjectKey: objectKey, AssetType: assetType}, nil
}

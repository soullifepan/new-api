package studio

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
)

var ErrInvalidClientLog = errors.New("invalid client diagnostic")

var diagnosticHeaders = regexp.MustCompile(`(?i)\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*`)
var diagnosticSecrets = regexp.MustCompile(`(?i)["']?(?:api[_-]?key|access[_-]?key(?:id|secret)?|secret(?:accesskey)?|password|token|securitytoken|x-amz-(?:credential|signature|security-token))["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)`)
var diagnosticBearer = regexp.MustCompile(`(?i)\bbearer\s+[^\s,;]+`)
var diagnosticProjectPath = regexp.MustCompile(`(?:project|\[project-path\])://[^\s"'<>]+`)

type ClientLogInput struct {
	Source     string `json:"source"`
	Operation  string `json:"operation"`
	ErrorType  string `json:"errorType"`
	Message    string `json:"message"`
	Stack      string `json:"stack,omitempty"`
	AppVersion string `json:"appVersion,omitempty"`
}

func (input ClientLogInput) Validate() error {
	if input.Source != "frontend" && input.Source != "agent" && input.Source != "backend" {
		return ErrInvalidClientLog
	}
	for _, value := range []string{input.Operation, input.ErrorType, input.Message} {
		if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 1024 {
			return ErrInvalidClientLog
		}
	}
	if !utf8.ValidString(input.Stack) || !utf8.ValidString(input.AppVersion) || utf8.RuneCountInString(input.Stack) > 1024 || utf8.RuneCountInString(input.AppVersion) > 64 {
		return ErrInvalidClientLog
	}
	return nil
}

type ClientLogConfig struct {
	Region, Group, Stream string
}

func LoadClientLogConfig() ClientLogConfig {
	return ClientLogConfig{
		Region: envOrFallback("STUDIO_CLIENT_LOG_REGION", "TAPCOMFY_CLIENT_LOG_REGION", common.GetEnvOrDefaultString("AWS_REGION", "")),
		Group:  envOrFallback("STUDIO_CLIENT_LOG_GROUP", "TAPCOMFY_CLIENT_LOG_GROUP", ""),
		Stream: envOrFallback("STUDIO_CLIENT_LOG_STREAM", "TAPCOMFY_CLIENT_LOG_STREAM", ""),
	}
}

func (c ClientLogConfig) Send(ctx context.Context, userID int, input ClientLogInput) error {
	if userID <= 0 {
		return ErrInvalidClientLog
	}
	if err := input.Validate(); err != nil {
		return err
	}
	if c.Region == "" || c.Group == "" || c.Stream == "" {
		return ErrNotConfigured
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	config, err := loadAWSConfig(ctx, c.Region)
	if err != nil {
		return err
	}
	return c.write(ctx, userID, input, config)
}

func (c ClientLogConfig) write(ctx context.Context, userID int, input ClientLogInput, config aws.Config) error {
	operation, errorType, message := sanitizeDiagnostic(input.Operation), sanitizeDiagnostic(input.ErrorType), sanitizeDiagnostic(input.Message)
	now := time.Now().UTC()
	fields := map[string]any{
		"event": "application_error", "source": input.Source, "user_id": userID,
		"operation": operation, "error_type": errorType, "message": message,
		"fingerprint": fmt.Sprintf("%x", sha256.Sum256([]byte(input.Source+"\n"+operation+"\n"+errorType+"\n"+message))),
		"app_version": sanitizeDiagnostic(input.AppVersion), "timestamp": now.Format(time.RFC3339),
	}
	if input.Stack != "" {
		fields["stack"] = sanitizeDiagnostic(input.Stack)
	}
	encoded, err := common.Marshal(fields)
	if err != nil {
		return err
	}
	result, err := cloudwatchlogs.NewFromConfig(config).PutLogEvents(ctx, &cloudwatchlogs.PutLogEventsInput{
		LogGroupName: aws.String(c.Group), LogStreamName: aws.String(c.Stream),
		LogEvents: []types.InputLogEvent{{Message: aws.String(string(encoded)), Timestamp: aws.Int64(now.UnixMilli())}},
	})
	if err != nil {
		return err
	}
	if result.RejectedLogEventsInfo != nil {
		return errors.New("client diagnostic was rejected")
	}
	return nil
}

func sanitizeDiagnostic(value string) string {
	value = diagnosticHeaders.ReplaceAllString(value, "[redacted]")
	value = diagnosticSecrets.ReplaceAllString(value, "[redacted]")
	value = diagnosticBearer.ReplaceAllString(value, "[redacted]")
	value = diagnosticProjectPath.ReplaceAllString(value, "[project-path]")
	value = strings.ReplaceAll(value, "\r", "")
	runes := []rune(value)
	return string(runes[:min(len(runes), 1024)])
}

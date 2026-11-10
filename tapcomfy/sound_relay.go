package tapcomfy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

const soundMaxResponseBytes = 2 << 20
const soundRequestTimeout = 120 * time.Second

// PrepareElevenLabsSound validates before Distribute sees a model. The version
// is a generation parameter; the single public identity controls authorization.
func PrepareElevenLabsSound(c *gin.Context) {
	storage, err := common.GetBodyStorage(c)
	var body []byte
	if err == nil {
		body, err = storage.Bytes()
	}
	if err != nil {
		status := http.StatusBadRequest
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		apiErr := types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, status, types.ErrOptionWithSkipRetry())
		c.AbortWithStatusJSON(status, gin.H{"error": apiErr.ToOpenAIError()})
		return
	}
	request, apiErr := ParseElevenLabsSoundRequest(body, c.Request.URL.RawQuery)
	if apiErr != nil {
		c.AbortWithStatusJSON(apiErr.StatusCode, gin.H{"error": apiErr.ToOpenAIError()})
		return
	}
	c.Set("elevenlabs_sound_request", request)
	c.Set("resolved_task_model", request.Model)
	c.Next()
}

// SoundQuota uses the same per-unit ModelRatio and truncating quota conversion
// as Music. Here one billing unit is a generated second, never a text token.
// A USD/minute selling price P corresponds to P*QuotaPerUnit/60 as ModelRatio.
func SoundQuota(info *relaycommon.RelayInfo, seconds float64) (int, error) {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 || seconds > 30 {
		return 0, errors.New("invalid sound duration")
	}
	ratio, group := info.PriceData.ModelRatio, info.PriceData.GroupRatioInfo.GroupRatio
	if info.PriceData.UsePrice || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || math.IsNaN(group) || math.IsInf(group, 0) || group < 0 {
		return 0, errors.New("invalid sound price or group ratio")
	}
	cost := decimal.NewFromFloat(math.Ceil(seconds)).Mul(decimal.NewFromFloat(ratio)).Mul(decimal.NewFromFloat(group))
	quota, clamp := common.QuotaFromDecimalChecked(cost)
	if clamp != nil {
		info.QuotaClamp = clamp
		return 0, clamp
	}
	if quota == 0 && ratio > 0 && group > 0 {
		quota = 1
	}
	return quota, nil
}

// RelayElevenLabsSound buffers a complete bounded response before committing
// binary success. No generation retry is performed, including on local errors.
func RelayElevenLabsSound(c *gin.Context, info *relaycommon.RelayInfo, request *ElevenLabsSoundRequest) *types.NewAPIError {
	info.InitChannelMeta(c)
	if info.ChannelType != constant.ChannelTypeOpenAI {
		return types.NewErrorWithStatusCode(errors.New("channel does not support sound generation"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	// Apply the existing mapping algorithm to the selected internal version only.
	// The public origin model remains unchanged for permissions and accounting.
	mapped := &relaycommon.RelayInfo{OriginModelName: request.VersionModel, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: request.VersionModel}}
	if err := helper.ModelMappedHelper(c, mapped, request); err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}
	info.UpstreamModelName = mapped.UpstreamModelName
	info.IsModelMapped = mapped.IsModelMapped
	body, err := request.UpstreamBody()
	if err != nil {
		return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	info.RequestURLPath = request.UpstreamPath()
	adaptor := relay.GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(errors.New("invalid sound channel API type"), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	ctx, cancel := context.WithTimeout(c.Request.Context(), soundRequestTimeout)
	defer cancel()
	upstreamURL, err := adaptor.GetRequestURL(info)
	if err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	// The generic synchronous adaptor currently builds a request without the
	// caller context. Build it locally to enforce Sound's deadline/cancellation,
	// while retaining the selected adaptor's URL, auth and channel proxy policy.
	// A non-replayable body prevents transport retries of a submitted generation.
	upstream, err := http.NewRequestWithContext(ctx, http.MethodPost, upstreamURL, io.LimitReader(bytes.NewReader(body), int64(len(body))))
	if err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	upstream.ContentLength = int64(len(body))
	if err := adaptor.SetupRequestHeader(c, &upstream.Header, info); err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	if err := channel.ApplyHeaderOverride(info, c, upstream); err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	upstream.Header.Set("Content-Type", "application/json")
	client, err := service.GetHttpClientWithProxySettings(info.ChannelSetting.Proxy, info.ChannelSetting)
	if err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	boundedClient := *client
	boundedClient.Timeout = soundRequestTimeout
	boundedClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	common.SetContextKey(c, constant.ContextKeyUpstreamRequestOrigin, upstream.URL.Scheme+"://"+upstream.URL.Host)
	resp, err := boundedClient.Do(upstream)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, status, types.ErrOptionWithSkipRetry())
	}
	if resp == nil || resp.Body == nil {
		return types.NewOpenAIError(errors.New("invalid sound response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	defer resp.Body.Close()
	if id := resp.Header.Get(common.RequestIdKey); id != "" {
		c.Set(common.UpstreamRequestIdKey, id)
	}
	if resp.ContentLength > soundMaxResponseBytes {
		return types.NewOpenAIError(errors.New("sound response exceeds size limit"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	audio, err := io.ReadAll(io.LimitReader(resp.Body, soundMaxResponseBytes+1))
	if err != nil || len(audio) > soundMaxResponseBytes || len(audio) == 0 || (resp.ContentLength >= 0 && int64(len(audio)) != resp.ContentLength) {
		status := http.StatusBadGateway
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		return types.NewOpenAIError(errors.New("sound response is empty, incomplete or exceeds limits"), types.ErrorCodeBadResponseBody, status, types.ErrOptionWithSkipRetry())
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body = io.NopCloser(bytes.NewReader(audio))
		apiErr := service.RelayErrorHandler(ctx, resp, false)
		service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
		return apiErr
	}
	seconds, err := soundMP3Duration(audio)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	if err := ctx.Err(); err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, status, types.ErrOptionWithSkipRetry())
	}
	seconds = min(seconds, request.DurationLimitSeconds())
	quota, err := SoundQuota(info, seconds)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
	}
	if err := service.SettleBilling(c, info, quota); err != nil {
		// Existing billing may already have committed one funding component.
		// Return an error before audio success, retain correlated reconciliation
		// evidence, and rely on the existing session's refund guards.
		logger.LogError(c, fmt.Sprintf("sound settlement failed; request_id=%s user_id=%d token_id=%d channel_id=%d quota=%d billable_seconds=%.0f: %v", info.RequestId, info.UserId, info.TokenId, info.ChannelId, quota, math.Ceil(seconds), err))
		return types.NewErrorWithStatusCode(errors.New("sound billing settlement failed; contact the administrator with the request ID"), types.ErrorCodeUpdateDataError, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	model.UpdateUserUsedQuotaAndRequestCount(info.UserId, quota)
	model.UpdateChannelUsedQuota(info.ChannelId, quota)
	other := model.NewLogOther()
	other.SetPublic("billing_usage_unit", "second")
	other.SetPublic("sound_seconds", seconds)
	other.SetPublic("sound_billable_seconds", math.Ceil(seconds))
	other.SetPublic("model_ratio", info.PriceData.ModelRatio)
	other.SetPublic("group_ratio", info.PriceData.GroupRatioInfo.GroupRatio)
	other.SetPublic("sound_model_id", request.VersionModel)
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{ChannelId: info.ChannelId, ModelName: info.OriginModelName, TokenName: c.GetString("token_name"), TokenId: info.TokenId, Quota: quota, Group: info.UsingGroup, Other: other})
	c.Header("Content-Type", "audio/mpeg")
	c.Header("Content-Disposition", `attachment; filename="sound.mp3"`)
	c.Header("Content-Length", strconv.Itoa(len(audio)))
	c.Header("X-Sound-Billable-Seconds", strconv.FormatFloat(math.Ceil(seconds), 'f', 0, 64))
	c.Status(http.StatusOK)
	if _, err := c.Writer.Write(audio); err != nil {
		// A fully measured, settled generation remains charged if delivery fails.
		logger.LogWarn(c, fmt.Sprintf("sound audio delivery stopped; request_id=%s: %v", info.RequestId, err))
	}
	return nil
}

// PrepareSoundPrice reuses Music's configured ratio and group snapshot. Require
// an explicit ratio, even in self-use mode, and reject conflicting per-request
// or expression prices instead of silently charging in a different unit.
func PrepareSoundPrice(c *gin.Context, info *relaycommon.RelayInfo, request *ElevenLabsSoundRequest) *types.NewAPIError {
	if !ratio_setting.HasConfiguredModelRatio(request.Model) {
		return types.NewErrorWithStatusCode(errors.New("sound ModelRatio is not configured; one billing unit is one generated second"), types.ErrorCodeModelPriceError, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	if _, configured := ratio_setting.GetModelPrice(request.Model, false); configured || billing_setting.GetBillingMode(request.Model) != billing_setting.BillingModeRatio {
		return types.NewErrorWithStatusCode(errors.New("sound requires ratio pricing; remove conflicting ModelPrice or expression pricing"), types.ErrorCodeModelPriceError, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	seconds := common.QuotaFromFloat(math.Ceil(request.DurationLimitSeconds()))
	info.SetEstimatePromptTokens(seconds)
	if _, err := helper.ModelPriceHelper(c, info, seconds, request.GetTokenCountMeta()); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeModelPriceError, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	quota, err := SoundQuota(info, request.DurationLimitSeconds())
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeModelPriceError, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	// Never let a global input multiplier below one or wallet trust bypass
	// admit concurrent requests without covering their maximum charge.
	quota = max(quota, info.PriceData.QuotaToPreConsume)
	info.PriceData.QuotaToPreConsume = quota
	info.PriceData.FreeModel = quota == 0
	info.ForcePreConsume = true
	if quota == 0 {
		return nil
	}
	return service.PreConsumeBilling(c, quota, info)
}

package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/tapcomfy"
	"github.com/gin-gonic/gin"
)

func RelayElevenLabsSpeechWithTimestamps(c *gin.Context) {
	relayElevenLabs(c, tapcomfy.ElevenLabsSpeechWithTimestamps)
}

func RelayElevenLabsMusic(c *gin.Context) {
	relayElevenLabs(c, tapcomfy.ElevenLabsMusic)
}

func RelayElevenLabsSound(c *gin.Context) {
	var apiErr *types.NewAPIError
	defer func() {
		if apiErr != nil {
			service.RecordRequestPolicyTermination(c, apiErr)
			logger.LogError(c, common.LogText("relay error: %s", common.LocalLogPreview(apiErr.Error())))
			apiErr.SetMessage(common.MessageWithRequestId(apiErr.Error(), c.GetString(common.RequestIdKey)))
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.ToOpenAIError(common.UpstreamAddresses(c)...)})
		}
	}()
	value, exists := c.Get("elevenlabs_sound_request")
	request, ok := value.(*tapcomfy.ElevenLabsSoundRequest)
	if !exists || !ok {
		apiErr = types.NewErrorWithStatusCode(errors.New("sound request was not validated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		return
	}
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIAudio, request, nil)
	if err != nil {
		apiErr = types.NewError(err, types.ErrorCodeGenRelayInfoFailed, types.ErrOptionWithSkipRetry())
		return
	}
	channel, channelErr := getChannel(c, info, &service.RetryParam{Ctx: c, TokenGroup: info.TokenGroup, ModelName: request.Model, RequestPath: c.Request.URL.Path, Retry: common.GetPointer(0)})
	if channelErr != nil {
		apiErr = channelErr
		return
	}
	service.AppendUsedChannel(c, channel.Id)
	defer func() {
		if apiErr != nil && info.Billing != nil {
			// Sound failure never adds a violation fee. Refund follows the
			// existing session's guards for partly committed settlements.
			info.Billing.Refund(c)
		}
	}()
	if apiErr = tapcomfy.PrepareSoundPrice(c, info, request); apiErr != nil {
		return
	}
	apiErr = tapcomfy.RelayElevenLabsSound(c, info, request)
	if apiErr == nil {
		service.MarkRequestPolicySuccess(c, nil)
		return
	}
	service.RecordPolicyFailure(c, channel.Id, apiErr, service.DecideRelayRetry(c, apiErr, 0))
	processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), apiErr, info)
}

// relayElevenLabs follows Relay for one channel attempt: the upstream bills
// every accepted generation, so a failure is never sent again.
func relayElevenLabs(c *gin.Context, operation tapcomfy.ElevenLabsOperation) {
	var newAPIError *types.NewAPIError
	defer func() {
		if newAPIError == nil {
			return
		}
		service.RecordRequestPolicyTermination(c, newAPIError)
		logger.LogError(c, common.LogText("relay error: %s", common.LocalLogPreview(newAPIError.Error())))
		newAPIError.SetMessage(common.MessageWithRequestId(newAPIError.Error(), c.GetString(common.RequestIdKey)))
		c.JSON(newAPIError.StatusCode, gin.H{"error": newAPIError.ToOpenAIError(common.UpstreamAddresses(c)...)})
	}()

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
		newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, status, types.ErrOptionWithSkipRetry())
		return
	}
	request, newAPIError := tapcomfy.ParseElevenLabsRequest(operation, body)
	if newAPIError != nil {
		return
	}
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIAudio, request, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}

	info.SetEstimatePromptTokens(request.BillableTokens)
	priceData, err := helper.ModelPriceHelper(c, info, request.BillableTokens, request.GetTokenCountMeta())
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
		return
	}
	if !priceData.FreeModel {
		if newAPIError = service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info); newAPIError != nil {
			return
		}
	}
	defer func() {
		newAPIError = relay.RefundFailedRequestBilling(c, info, newAPIError)
	}()

	channel, channelErr := getChannel(c, info, &service.RetryParam{
		Ctx:         c,
		TokenGroup:  info.TokenGroup,
		ModelName:   info.OriginModelName,
		RequestPath: c.Request.URL.Path,
		Retry:       common.GetPointer(0),
	})
	if channelErr != nil {
		newAPIError = channelErr
		return
	}
	service.AppendUsedChannel(c, channel.Id)
	if newAPIError = service.PrepareTieredBillingForSelectedGroup(c, info); newAPIError != nil {
		return
	}

	newAPIError = tapcomfy.RelayElevenLabs(c, info, request)
	if newAPIError == nil {
		service.MarkRequestPolicySuccess(c, nil)
		return
	}
	newAPIError = service.NormalizeViolationFeeError(newAPIError)
	service.RecordPolicyFailure(c, channel.Id, newAPIError, service.DecideRelayRetry(c, newAPIError, 0))
	processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), newAPIError, info)
}

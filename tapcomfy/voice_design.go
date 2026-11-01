package tapcomfy

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

const ElevenLabsVoiceCloneModel = "elevenlabs-voice-clone"

type ElevenLabsVoiceOperation int

const (
	ElevenLabsVoiceClone ElevenLabsVoiceOperation = iota + 1
	ElevenLabsVoiceList
	ElevenLabsVoiceGet
	ElevenLabsVoiceEdit
	ElevenLabsVoiceDelete
)

type ElevenLabsVoiceRequest struct {
	Operation      ElevenLabsVoiceOperation
	Model          string
	BillableTokens int
	body           []byte
	contentType    string
	voiceID        string
	upstreamModel  string
}

func (r *ElevenLabsVoiceRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
}

func (*ElevenLabsVoiceRequest) IsStream(*http.Request) bool { return false }

func (r *ElevenLabsVoiceRequest) SetModelName(modelName string) { r.upstreamModel = modelName }

// ElevenLabsVoiceModel selects the fixed routing model before Distribute runs;
// voice management requests have no JSON model field to inspect.
func ElevenLabsVoiceModel(c *gin.Context) {
	c.Set("resolved_task_model", ElevenLabsVoiceCloneModel)
	c.Next()
}

func voiceInvalid(message string) *types.NewAPIError {
	return types.NewError(errors.New(message), types.ErrorCodeInvalidRequest, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
}

func ParseElevenLabsVoiceRequest(operation ElevenLabsVoiceOperation, contentType string, body []byte, voiceID string) (*ElevenLabsVoiceRequest, *types.NewAPIError) {
	request := &ElevenLabsVoiceRequest{Operation: operation, Model: ElevenLabsVoiceCloneModel, body: body, contentType: contentType, voiceID: voiceID, upstreamModel: ElevenLabsVoiceCloneModel}
	if operation != ElevenLabsVoiceClone && operation != ElevenLabsVoiceEdit {
		return request, nil
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		return nil, voiceInvalid("Content-Type must be multipart/form-data")
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		return nil, voiceInvalid("invalid multipart form")
	}
	defer form.RemoveAll()

	name := form.Value["name"]
	if len(name) != 1 || utf8.RuneCountInString(name[0]) < 1 || utf8.RuneCountInString(name[0]) > 100 {
		return nil, voiceInvalid("name must contain 1 to 100 characters")
	}
	if labels, ok := form.Value["labels"]; ok {
		if len(labels) != 1 {
			return nil, voiceInvalid("labels must be a JSON object with string values")
		}
		var parsed map[string]string
		if err := common.UnmarshalJsonStr(labels[0], &parsed); err != nil || parsed == nil {
			return nil, voiceInvalid("labels must be a JSON object with string values")
		}
	}
	if noise, ok := form.Value["remove_background_noise"]; ok && (len(noise) != 1 || (noise[0] != "true" && noise[0] != "false")) {
		return nil, voiceInvalid("remove_background_noise must be true or false")
	}
	if operation == ElevenLabsVoiceClone {
		files := form.File["files"]
		if len(files) == 0 {
			return nil, voiceInvalid("at least one non-empty files part is required")
		}
		hasNonEmptyFile := false
		for _, file := range files {
			hasNonEmptyFile = hasNonEmptyFile || file.Size > 0
		}
		if !hasNonEmptyFile {
			return nil, voiceInvalid("at least one non-empty files part is required")
		}
	}
	request.BillableTokens = 1
	return request, nil
}

func RelayElevenLabsVoice(c *gin.Context, info *relaycommon.RelayInfo, request *ElevenLabsVoiceRequest) *types.NewAPIError {
	info.InitChannelMeta(c)
	if info.ChannelType != constant.ChannelTypeOpenAI {
		return types.NewError(fmt.Errorf("channel does not support %s", c.Request.URL.Path), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if err := helper.ModelMappedHelper(c, info, request); err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	info.RequestURLPath = "/v1/elevenlabs/voices"
	if request.voiceID != "" {
		info.RequestURLPath += "/" + url.PathEscape(request.voiceID)
	}
	if request.Operation == ElevenLabsVoiceEdit {
		info.RequestURLPath += "/edit"
	}
	if c.Request.URL.RawQuery != "" {
		info.RequestURLPath += "?" + c.Request.URL.RawQuery
	}

	adaptor := relay.GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	response, err := adaptor.DoRequest(c, info, bytes.NewReader(request.body))
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	httpResponse, ok := response.(*http.Response)
	if !ok || httpResponse == nil {
		return types.NewOpenAIError(errors.New("invalid http response"), types.ErrorCodeDoRequestFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	defer httpResponse.Body.Close()
	if httpResponse.StatusCode < http.StatusOK || httpResponse.StatusCode >= http.StatusMultipleChoices {
		apiErr := service.RelayErrorHandler(c.Request.Context(), httpResponse, false)
		service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
		return apiErr
	}
	responseBody, err := io.ReadAll(httpResponse.Body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	if request.BillableTokens > 0 {
		voiceID := gjson.GetBytes(responseBody, "voice_id")
		if !gjson.ValidBytes(responseBody) || voiceID.Type != gjson.String || strings.TrimSpace(voiceID.String()) == "" {
			return types.NewOpenAIError(errors.New("invalid ElevenLabs voice response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
		}
	}
	contentType := httpResponse.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Data(httpResponse.StatusCode, contentType, responseBody)
	if request.BillableTokens > 0 {
		service.PostTextConsumeQuota(c, info, &dto.Usage{PromptTokens: request.BillableTokens, TotalTokens: request.BillableTokens}, nil)
	}
	return nil
}

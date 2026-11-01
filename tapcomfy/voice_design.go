package tapcomfy

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
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
	"github.com/tidwall/sjson"
)

const ElevenLabsVoiceDesignModel = "elevenlabs-voice-design"

type ElevenLabsVoiceOperation int

const (
	ElevenLabsVoiceDesign ElevenLabsVoiceOperation = iota + 1
	ElevenLabsVoiceSave
)

type ElevenLabsVoiceRequest struct {
	Operation      ElevenLabsVoiceOperation
	Model          string
	BillableTokens int
	body           []byte
	upstreamModel  string
}

func (r *ElevenLabsVoiceRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
}

func (*ElevenLabsVoiceRequest) IsStream(*http.Request) bool { return false }

func (r *ElevenLabsVoiceRequest) SetModelName(modelName string) { r.upstreamModel = modelName }

func voiceInvalid(message string) *types.NewAPIError {
	return types.NewError(
		errors.New(message),
		types.ErrorCodeInvalidRequest,
		types.ErrOptionWithStatusCode(http.StatusBadRequest),
		types.ErrOptionWithSkipRetry(),
	)
}

func voiceString(body []byte, field string, minimum, maximum int, required bool) (string, *types.NewAPIError) {
	value := gjson.GetBytes(body, field)
	if !value.Exists() && !required {
		return "", nil
	}
	if value.Type != gjson.String {
		return "", voiceInvalid(field + " must be a string")
	}
	text := value.String()
	length := utf8.RuneCountInString(text)
	if length < minimum || length > maximum {
		return "", voiceInvalid(fmt.Sprintf("%s must contain %d to %d characters", field, minimum, maximum))
	}
	return text, nil
}

func ParseElevenLabsVoiceRequest(operation ElevenLabsVoiceOperation, body []byte) (*ElevenLabsVoiceRequest, *types.NewAPIError) {
	if !gjson.ValidBytes(body) || !gjson.ParseBytes(body).IsObject() {
		return nil, voiceInvalid("request body must be a JSON object")
	}
	model := gjson.GetBytes(body, "model")
	if model.Type != gjson.String || model.String() != ElevenLabsVoiceDesignModel {
		return nil, voiceInvalid("model must be " + ElevenLabsVoiceDesignModel)
	}
	request := &ElevenLabsVoiceRequest{Operation: operation, Model: model.String(), body: body, upstreamModel: model.String()}
	allowedFields := map[string]bool{"model": true}
	if operation == ElevenLabsVoiceDesign {
		for _, field := range []string{"description", "preview_text", "auto_generate_text", "loudness", "guidance_scale"} {
			allowedFields[field] = true
		}
	} else if operation == ElevenLabsVoiceSave {
		for _, field := range []string{"design_id", "name", "description"} {
			allowedFields[field] = true
		}
	}
	var unsupported string
	gjson.ParseBytes(body).ForEach(func(key, _ gjson.Result) bool {
		if !allowedFields[key.String()] {
			unsupported = key.String()
			return false
		}
		return true
	})
	if unsupported != "" {
		return nil, voiceInvalid("unsupported field: " + unsupported)
	}
	if operation == ElevenLabsVoiceDesign {
		if _, err := voiceString(body, "description", 10, 1000, true); err != nil {
			return nil, err
		}
		preview := gjson.GetBytes(body, "preview_text")
		hasPreview := preview.Exists() && preview.Type != gjson.Null
		if hasPreview {
			if _, err := voiceString(body, "preview_text", 100, 1000, true); err != nil {
				return nil, err
			}
		}
		auto := gjson.GetBytes(body, "auto_generate_text")
		if auto.Exists() && !auto.IsBool() {
			return nil, voiceInvalid("auto_generate_text must be a boolean")
		}
		if !hasPreview && auto.Exists() && !auto.Bool() {
			return nil, voiceInvalid("auto_generate_text must be true when preview_text is absent")
		}
		for _, field := range []string{"loudness", "guidance_scale"} {
			value := gjson.GetBytes(body, field)
			if value.Exists() && value.Type != gjson.Number {
				return nil, voiceInvalid(field + " must be a number")
			}
		}
		if loudness := gjson.GetBytes(body, "loudness"); loudness.Exists() && (loudness.Float() < -1 || loudness.Float() > 1) {
			return nil, voiceInvalid("loudness must be between -1 and 1")
		}
		if guidance := gjson.GetBytes(body, "guidance_scale"); guidance.Exists() && (guidance.Float() < 0 || guidance.Float() > 100) {
			return nil, voiceInvalid("guidance_scale must be between 0 and 100")
		}
		request.BillableTokens = 1
		return request, nil
	}
	if operation != ElevenLabsVoiceSave {
		return nil, voiceInvalid("unsupported ElevenLabs voice operation")
	}
	if _, err := voiceString(body, "design_id", 1, 128, true); err != nil {
		return nil, err
	}
	if _, err := voiceString(body, "name", 1, 100, true); err != nil {
		return nil, err
	}
	if _, err := voiceString(body, "description", 10, 1000, true); err != nil {
		return nil, err
	}
	return request, nil
}

func (r *ElevenLabsVoiceRequest) upstreamBody() ([]byte, error) {
	var body []byte
	var err error
	if r.Operation == ElevenLabsVoiceDesign {
		body, err = sjson.SetBytes(r.body, "voice_description", gjson.GetBytes(r.body, "description").String())
		if err != nil {
			return nil, err
		}
		body, err = sjson.DeleteBytes(body, "description")
		if err != nil {
			return nil, err
		}
		preview := gjson.GetBytes(body, "preview_text")
		hasPreview := preview.Exists() && preview.Type == gjson.String && preview.String() != ""
		if hasPreview {
			body, err = sjson.SetBytes(body, "text", preview.String())
			if err != nil {
				return nil, err
			}
		}
		if preview.Exists() {
			body, err = sjson.DeleteBytes(body, "preview_text")
			if err != nil {
				return nil, err
			}
		}
		if !gjson.GetBytes(body, "auto_generate_text").Exists() && !hasPreview {
			body, err = sjson.SetBytes(body, "auto_generate_text", true)
			if err != nil {
				return nil, err
			}
		}
		body, err = sjson.SetBytes(body, "model_id", "eleven_multilingual_ttv_v2")
		if err != nil {
			return nil, err
		}
		return sjson.DeleteBytes(body, "model")
	}
	body, err = sjson.SetBytes(r.body, "voice_name", gjson.GetBytes(r.body, "name").String())
	if err != nil {
		return nil, err
	}
	body, err = sjson.SetBytes(body, "voice_description", gjson.GetBytes(r.body, "description").String())
	if err != nil {
		return nil, err
	}
	body, err = sjson.SetBytes(body, "generated_voice_id", gjson.GetBytes(r.body, "design_id").String())
	if err != nil {
		return nil, err
	}
	for _, field := range []string{"model", "name", "description", "design_id"} {
		body, err = sjson.DeleteBytes(body, field)
		if err != nil {
			return nil, err
		}
	}
	return body, nil
}

func RelayElevenLabsVoice(c *gin.Context, info *relaycommon.RelayInfo, request *ElevenLabsVoiceRequest) *types.NewAPIError {
	info.InitChannelMeta(c)
	if info.ChannelType != constant.ChannelTypeOpenAI {
		return types.NewError(fmt.Errorf("channel does not support %s", c.Request.URL.Path), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if err := helper.ModelMappedHelper(c, info, request); err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}
	body, err := request.upstreamBody()
	if err != nil {
		return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	info.RequestURLPath = "/v1/text-to-voice/design"
	if request.Operation == ElevenLabsVoiceSave {
		info.RequestURLPath = "/v1/text-to-voice"
	}
	adaptor := relay.GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	response, err := adaptor.DoRequest(c, info, bytes.NewReader(body))
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
	if err != nil || !gjson.ValidBytes(responseBody) || !gjson.ParseBytes(responseBody).IsObject() {
		return types.NewOpenAIError(errors.New("invalid ElevenLabs voice response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	normalized, apiErr := normalizeElevenLabsVoiceResponse(request.Operation, responseBody)
	if apiErr != nil {
		return apiErr
	}
	c.Header("Content-Type", "application/json")
	c.Status(httpResponse.StatusCode)
	_, _ = c.Writer.Write(normalized)
	if request.BillableTokens > 0 {
		service.PostTextConsumeQuota(c, info, &dto.Usage{PromptTokens: request.BillableTokens, TotalTokens: request.BillableTokens}, nil)
	}
	return nil
}

func normalizeElevenLabsVoiceResponse(operation ElevenLabsVoiceOperation, body []byte) ([]byte, *types.NewAPIError) {
	invalid := func() ([]byte, *types.NewAPIError) {
		return nil, types.NewOpenAIError(errors.New("invalid ElevenLabs voice response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	if operation == ElevenLabsVoiceSave {
		voiceID := gjson.GetBytes(body, "voice_id")
		name := gjson.GetBytes(body, "name")
		if voiceID.Type != gjson.String || voiceID.String() == "" || name.Type != gjson.String || name.String() == "" {
			return invalid()
		}
		output, err := common.Marshal(gin.H{"voice_id": voiceID.String(), "name": name.String()})
		if err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
		}
		return output, nil
	}
	text := gjson.GetBytes(body, "text")
	previews := gjson.GetBytes(body, "previews")
	if text.Type != gjson.String || !previews.IsArray() || len(previews.Array()) == 0 {
		return invalid()
	}
	output := make([]gin.H, 0, len(previews.Array()))
	for _, preview := range previews.Array() {
		designID := preview.Get("generated_voice_id")
		audio := preview.Get("audio_base_64")
		if audio.Type == gjson.Null {
			audio = preview.Get("audio_base64")
		}
		if designID.Type != gjson.String || designID.String() == "" || audio.Type != gjson.String || audio.String() == "" {
			return invalid()
		}
		duration := preview.Get("duration_secs")
		if duration.Type != gjson.Number || duration.Float() < 0 {
			return invalid()
		}
		output = append(output, gin.H{
			"design_id": designID.String(), "audio_base64": audio.String(), "media_type": "audio/mpeg", "duration_secs": duration.Float(),
		})
	}
	normalized, err := common.Marshal(gin.H{"previews": output, "text": text.String()})
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	return normalized, nil
}

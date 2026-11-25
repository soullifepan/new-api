package elevenlabs

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	defaultTTSOutputFormat = "mp3_44100_128"
	pcm24000OutputFormat   = "pcm_24000"
	opusOutputFormat       = "opus_48000_128"
)

var modelList = []string{
	"eleven_v4",
	"eleven_v4_turbo",
	"eleven_v3",
	"eleven_multilingual_v2",
	"eleven_flash_v2_5",
	"scribe_v2",
	"music_v2_5",
	"elevenlabs-voice-clone",
	"elevenlabs-sound",
}

type Adaptor struct {
	requestURLPath string
	responseFormat string
}

// MapOutputFormat maps OpenAI-style audio formats to official ElevenLabs output_format values.
func MapOutputFormat(format string) string {
	trimmed := strings.TrimSpace(format)
	switch strings.ToLower(trimmed) {
	case "", "mp3":
		return defaultTTSOutputFormat
	case "wav", "pcm":
		return pcm24000OutputFormat
	case "opus":
		return opusOutputFormat
	default:
		if strings.Contains(trimmed, "_") {
			return trimmed
		}
		return defaultTTSOutputFormat
	}
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	baseURL := strings.TrimRight(info.ChannelBaseUrl, "/")
	if baseURL == "" {
		baseURL = constant.GetChannelBaseURL(constant.ChannelTypeElevenLabs)
	}
	if a.requestURLPath != "" {
		return baseURL + a.requestURLPath, nil
	}
	return relaycommon.GetFullRequestURL(baseURL, info.RequestURLPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, header *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, header)
	hasKeyOverride := false
	for k := range info.HeadersOverride {
		if strings.EqualFold(k, "xi-api-key") {
			hasKeyOverride = true
			break
		}
	}
	if !hasKeyOverride {
		header.Set("xi-api-key", info.ApiKey)
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertClaudeRequest(*gin.Context, *relaycommon.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertGeminiRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertRerankRequest(*gin.Context, int, dto.RerankRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertEmbeddingRequest(*gin.Context, *relaycommon.RelayInfo, dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertImageRequest(*gin.Context, *relaycommon.RelayInfo, dto.ImageRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(*gin.Context, *relaycommon.RelayInfo, dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	a.responseFormat = request.ResponseFormat
	switch info.RelayMode {
	case relayconstant.RelayModeAudioSpeech:
		return a.convertTTSRequest(c, request)
	case relayconstant.RelayModeAudioTranscription:
		return a.convertSTTRequest(c, request)
	default:
		return nil, fmt.Errorf("unsupported elevenlabs audio relay mode: %d", info.RelayMode)
	}
}

func (a *Adaptor) convertTTSRequest(c *gin.Context, request dto.AudioRequest) (io.Reader, error) {
	voiceID := strings.TrimSpace(request.Voice)
	if voiceID == "" {
		return nil, errors.New("voice is required")
	}
	if request.Input == "" {
		return nil, errors.New("input is required")
	}

	outputFormat := MapOutputFormat(request.ResponseFormat)
	a.requestURLPath = fmt.Sprintf("/v1/text-to-speech/%s?output_format=%s", url.PathEscape(voiceID), url.QueryEscape(outputFormat))

	payload := map[string]any{
		"text":     request.Input,
		"model_id": request.Model,
	}

	var voiceSettings map[string]any
	if c != nil {
		if storage, err := common.GetBodyStorage(c); err == nil {
			if rawBody, err := storage.Bytes(); err == nil && len(rawBody) > 0 {
				var raw map[string]any
				if err := common.Unmarshal(rawBody, &raw); err == nil {
					if vs, ok := raw["voice_settings"].(map[string]any); ok && len(vs) > 0 {
						voiceSettings = make(map[string]any, len(vs)+1)
						maps.Copy(voiceSettings, vs)
					}
					if lang, ok := raw["language_code"].(string); ok && strings.TrimSpace(lang) != "" {
						payload["language_code"] = strings.TrimSpace(lang)
					}
				}
			}
		}
	}
	if request.Speed != nil {
		if voiceSettings == nil {
			voiceSettings = make(map[string]any, 1)
		}
		if _, exists := voiceSettings["speed"]; !exists {
			voiceSettings["speed"] = *request.Speed
		}
	}
	if len(voiceSettings) > 0 {
		payload["voice_settings"] = voiceSettings
	}

	jsonData, err := common.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("error marshalling elevenlabs tts request: %w", err)
	}
	return bytes.NewReader(jsonData), nil
}

func (a *Adaptor) convertSTTRequest(c *gin.Context, request dto.AudioRequest) (io.Reader, error) {
	a.requestURLPath = "/v1/speech-to-text"

	formData, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return nil, fmt.Errorf("error parsing multipart form: %w", err)
	}
	fileHeaders := formData.File["file"]
	if len(fileHeaders) == 0 {
		return nil, errors.New("file is required")
	}

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)

	if err := writer.WriteField("model_id", request.Model); err != nil {
		return nil, err
	}

	for _, field := range []string{"timestamps_granularity", "tag_audio_events", "diarize", "num_speakers", "language_code"} {
		for _, value := range formData.Value[field] {
			if err := writer.WriteField(field, value); err != nil {
				return nil, err
			}
		}
	}
	if len(formData.Value["language_code"]) == 0 {
		for _, value := range formData.Value["language"] {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				if err := writer.WriteField("language_code", trimmed); err != nil {
					return nil, err
				}
				break
			}
		}
	}
	if len(formData.Value["timestamps_granularity"]) == 0 {
		for _, key := range []string{"timestamp_granularities[]", "timestamp_granularities"} {
			wrote := false
			for _, value := range formData.Value[key] {
				if value == "word" || value == "character" {
					if err := writer.WriteField("timestamps_granularity", value); err != nil {
						return nil, err
					}
					wrote = true
					break
				}
			}
			if wrote {
				break
			}
		}
	}

	fileHeader := fileHeaders[0]
	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("error opening audio file: %w", err)
	}
	defer file.Close()

	var part io.Writer
	if ct := strings.TrimSpace(fileHeader.Header.Get("Content-Type")); ct != "" {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escapeQuotes(fileHeader.Filename)))
		h.Set("Content-Type", ct)
		part, err = writer.CreatePart(h)
	} else {
		part, err = writer.CreateFormFile("file", fileHeader.Filename)
	}
	if err != nil {
		return nil, errors.New("create form file failed")
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, errors.New("copy file failed")
	}

	if err := writer.Close(); err != nil {
		return nil, err
	}
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	return &requestBody, nil
}

func escapeQuotes(s string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, `\"`).Replace(s)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	if info.RelayMode == relayconstant.RelayModeAudioTranscription {
		return channel.DoFormRequest(a, c, info, requestBody)
	}
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	switch info.RelayMode {
	case relayconstant.RelayModeAudioSpeech:
		return a.doTTSResponse(c, resp, info)
	case relayconstant.RelayModeAudioTranscription:
		return a.doSTTResponse(c, resp, info)
	default:
		return nil, types.NewError(fmt.Errorf("unsupported elevenlabs relay mode: %d", info.RelayMode), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
}

func (a *Adaptor) doTTSResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway)
	}

	for k, v := range resp.Header {
		if !service.ShouldCopyUpstreamHeader(c, k, v) {
			continue
		}
		c.Writer.Header().Set(k, v[0])
	}
	if c.Writer.Header().Get("Content-Type") == "" {
		c.Writer.Header().Set("Content-Type", "audio/mpeg")
	}
	c.Writer.WriteHeader(resp.StatusCode)
	_, _ = c.Writer.Write(bodyBytes)

	tokens := info.GetEstimatePromptTokens()
	if tokens <= 0 {
		if audioReq, ok := info.Request.(*dto.AudioRequest); ok {
			tokens = utf8.RuneCountInString(audioReq.Input)
		}
	}
	return &dto.Usage{
		PromptTokens: tokens,
		TotalTokens:  tokens,
	}, nil
}

func (a *Adaptor) doSTTResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	normalizedBody, durationSecs, err := normalizeSTTResponse(responseBody)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	resp.Header.Set("Content-Type", "application/json")
	service.IOCopyBytesGracefully(c, resp, normalizedBody)

	promptTokens := info.GetEstimatePromptTokens()
	if promptTokens <= 0 && durationSecs > 0 {
		tokens, clamp := common.QuotaRoundChecked(math.Ceil(durationSecs) / 60.0 * 1000)
		if clamp != nil {
			info.QuotaClamp = clamp
		}
		promptTokens = tokens
	}
	return &dto.Usage{
		PromptTokens:     promptTokens,
		CompletionTokens: 0,
		TotalTokens:      promptTokens,
	}, nil
}

func normalizeSTTResponse(rawBytes []byte) ([]byte, float64, error) {
	var parsed map[string]any
	if err := common.Unmarshal(rawBytes, &parsed); err != nil || parsed == nil {
		return nil, 0, errors.New("invalid elevenlabs speech-to-text response")
	}

	if _, ok := parsed["text"].(string); !ok {
		parsed["text"] = ""
	}
	words, ok := parsed["words"].([]any)
	if !ok || words == nil {
		words = []any{}
		parsed["words"] = words
	}

	durationSecs := extractPositiveFloat(parsed["audio_duration_secs"])
	if durationSecs == 0 {
		durationSecs = extractPositiveFloat(parsed["duration"])
	}
	if durationSecs == 0 {
		for _, item := range words {
			word, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if end := extractPositiveFloat(word["end"]); end > durationSecs {
				durationSecs = end
			}
		}
	}
	if durationSecs > 0 {
		parsed["audio_duration_secs"] = durationSecs
	}

	normalized, err := common.Marshal(parsed)
	if err != nil {
		return nil, 0, err
	}
	return normalized, durationSecs, nil
}

func extractPositiveFloat(v any) float64 {
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) || f <= 0 {
		return 0
	}
	return f
}

func (a *Adaptor) GetModelList() []string {
	return modelList
}

func (a *Adaptor) GetChannelName() string {
	return "ElevenLabs"
}

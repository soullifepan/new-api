package tapcomfy

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"strconv"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
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

// ElevenLabsOperation is an ElevenLabs endpoint the OpenAI audio relay has no
// route for. Both are synchronous and return their deliverable in the response.
type ElevenLabsOperation int

const (
	// ElevenLabsSpeechWithTimestamps returns JSON with Base64 audio and
	// per-character timings, billed per input character like speech.
	ElevenLabsSpeechWithTimestamps ElevenLabsOperation = iota + 1
	// ElevenLabsMusic returns the generated audio file, billed per requested second.
	ElevenLabsMusic
)

const (
	// DefaultElevenLabsMusicModel serves a music request that names no model.
	DefaultElevenLabsMusicModel = "music_v2_5"
	// Flash v2.5 accepts the most text per request of the ElevenLabs speech models.
	maxElevenLabsSpeechCharacters  = 40000
	maxElevenLabsMusicPrompt       = 4100
	minElevenLabsMusicMilliseconds = 3000
	maxElevenLabsMusicMilliseconds = 600000
	elevenLabsMusicOutputFormat    = "mp3_44100_128"
	defaultElevenLabsSpeechFormat  = "mp3"
	// The upstream "wav" is raw PCM without a RIFF header, so a wav request asks
	// for that PCM by its exact name and the client adds the header.
	elevenLabsSpeechPCMFormat = "pcm_24000"
)

var (
	// The upstream answers these with a 500 and no charge.
	elevenLabsTimestampUnsupported = []string{"eleven_v4_turbo"}
	// Song and fine-tune references would resolve against the shared upstream
	// account, so music requests carry only the fields that generate new audio.
	elevenLabsMusicFields = []string{"model", "prompt", "music_length_ms", "force_instrumental"}
)

// ElevenLabsRequest is a validated extension request. The client body is
// forwarded unchanged apart from the model, which becomes the channel's
// upstream name.
type ElevenLabsRequest struct {
	Operation ElevenLabsOperation
	Model     string
	// BillableTokens is the quantity billed at the model ratio: input
	// characters for speech, requested seconds rounded up for music.
	BillableTokens int
	body           []byte
	upstreamModel  string
	speechFormat   string
}

func (r *ElevenLabsRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
}

func (r *ElevenLabsRequest) IsStream(*http.Request) bool { return false }

func (r *ElevenLabsRequest) SetModelName(modelName string) { r.upstreamModel = modelName }

// ElevenLabsMusicModel routes a music request that names no model to the
// default one; Distribute reads the routing name before any handler runs.
func ElevenLabsMusicModel(c *gin.Context) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		c.Next()
		return
	}
	body, err := storage.Bytes()
	if err == nil && !gjson.GetBytes(body, "model").Exists() {
		c.Set("resolved_task_model", DefaultElevenLabsMusicModel)
	}
	c.Next()
}

// ParseElevenLabsRequest validates a client body and the billed quantity
// before anything is reserved.
func ParseElevenLabsRequest(operation ElevenLabsOperation, body []byte) (*ElevenLabsRequest, *types.NewAPIError) {
	invalid := func(message string) *types.NewAPIError {
		return types.NewError(errors.New(message), types.ErrorCodeInvalidRequest, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
	}
	if !gjson.ValidBytes(body) || !gjson.ParseBytes(body).IsObject() {
		return nil, invalid("request body must be a JSON object")
	}
	request := &ElevenLabsRequest{Operation: operation, body: body}
	model := gjson.GetBytes(body, "model")
	if model.Exists() && (model.Type != gjson.String || model.String() == "") {
		return nil, invalid("model must be a non-empty string")
	}
	request.Model = model.String()

	switch operation {
	case ElevenLabsSpeechWithTimestamps:
		if request.Model == "" {
			return nil, invalid("model is required")
		}
		if slices.Contains(elevenLabsTimestampUnsupported, request.Model) {
			return nil, types.NewError(fmt.Errorf("model %s does not support timestamps", request.Model), types.ErrorCode("model_not_supported_with_timestamps"), types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
		}
		if gjson.GetBytes(body, "stream").Bool() {
			return nil, invalid("stream is not supported with timestamps")
		}
		input := gjson.GetBytes(body, "input")
		if input.Type != gjson.String || input.String() == "" {
			return nil, invalid("input is required")
		}
		characters := utf8.RuneCountInString(input.String())
		if characters > maxElevenLabsSpeechCharacters {
			return nil, invalid(fmt.Sprintf("input exceeds %d characters", maxElevenLabsSpeechCharacters))
		}
		request.BillableTokens = characters
		request.speechFormat = defaultElevenLabsSpeechFormat
		if format := gjson.GetBytes(body, "response_format"); format.Exists() {
			if format.Type != gjson.String || format.String() == "" {
				return nil, invalid("response_format must be a non-empty string")
			}
			request.speechFormat = format.String()
			if request.speechFormat == "wav" {
				request.speechFormat = elevenLabsSpeechPCMFormat
			}
		}
	case ElevenLabsMusic:
		if request.Model == "" {
			request.Model = DefaultElevenLabsMusicModel
		}
		var unsupported string
		gjson.ParseBytes(body).ForEach(func(key, _ gjson.Result) bool {
			if !slices.Contains(elevenLabsMusicFields, key.String()) {
				unsupported = key.String()
				return false
			}
			return true
		})
		if unsupported != "" {
			return nil, invalid("unsupported field for music: " + unsupported)
		}
		prompt := gjson.GetBytes(body, "prompt")
		if prompt.Type != gjson.String || prompt.String() == "" {
			return nil, invalid("prompt is required")
		}
		if utf8.RuneCountInString(prompt.String()) > maxElevenLabsMusicPrompt {
			return nil, invalid(fmt.Sprintf("prompt exceeds %d characters", maxElevenLabsMusicPrompt))
		}
		if instrumental := gjson.GetBytes(body, "force_instrumental"); instrumental.Exists() && !instrumental.IsBool() {
			return nil, invalid("force_instrumental must be a boolean")
		}
		length := gjson.GetBytes(body, "music_length_ms")
		milliseconds, err := strconv.ParseInt(length.Raw, 10, 64)
		if length.Type != gjson.Number || err != nil || milliseconds < minElevenLabsMusicMilliseconds || milliseconds > maxElevenLabsMusicMilliseconds {
			return nil, invalid(fmt.Sprintf("music_length_ms must be an integer between %d and %d", minElevenLabsMusicMilliseconds, maxElevenLabsMusicMilliseconds))
		}
		// The upstream bills the requested length rounded up to the second.
		request.BillableTokens = int(math.Ceil(float64(milliseconds) / 1000))
	default:
		return nil, invalid("unsupported ElevenLabs operation")
	}
	request.upstreamModel = request.Model
	return request, nil
}

// RelayElevenLabs sends the request through the selected OpenAI-type channel
// and copies the response to the client as it arrives. A response with
// content settles the reserved quantity: the upstream has generated and billed
// it even if the client stops reading. Anything else is returned as an error
// for the caller to refund.
func RelayElevenLabs(c *gin.Context, info *relaycommon.RelayInfo, request *ElevenLabsRequest) *types.NewAPIError {
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
	info.RequestURLPath = "/v1/audio/speech/with-timestamps"
	if request.Operation == ElevenLabsMusic {
		info.RequestURLPath = "/v1/music?output_format=" + elevenLabsMusicOutputFormat
	}

	adaptor := relay.GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	resp, err := adaptor.DoRequest(c, info, bytes.NewReader(body))
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	httpResp, ok := resp.(*http.Response)
	if !ok || httpResp == nil {
		return types.NewOpenAIError(errors.New("invalid http response"), types.ErrorCodeDoRequestFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		apiErr := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
		service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
		return apiErr
	}

	reader := bufio.NewReaderSize(httpResp.Body, 32<<10)
	if request.Operation == ElevenLabsSpeechWithTimestamps {
		err = writeElevenLabsTimestampHead(c, reader, request.speechFormat)
	} else {
		err = writeElevenLabsMusicHead(c, reader, httpResp)
	}
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	if _, err = io.Copy(flushWriter{c.Writer}, reader); err != nil {
		logger.LogWarn(c, fmt.Sprintf("copying the ElevenLabs response stopped: %v", err))
	}
	service.PostTextConsumeQuota(c, info, &dto.Usage{PromptTokens: request.BillableTokens, TotalTokens: request.BillableTokens}, nil)
	return nil
}

func (r *ElevenLabsRequest) upstreamBody() ([]byte, error) {
	if r.Operation == ElevenLabsSpeechWithTimestamps {
		body := r.body
		var err error
		if r.upstreamModel != r.Model {
			body, err = sjson.SetBytes(body, "model", r.upstreamModel)
		}
		if err == nil && r.speechFormat == elevenLabsSpeechPCMFormat && gjson.GetBytes(body, "response_format").String() == "wav" {
			body, err = sjson.SetBytes(body, "response_format", elevenLabsSpeechPCMFormat)
		}
		return body, err
	}
	// The music API names the model model_id.
	body, err := sjson.DeleteBytes(r.body, "model")
	if err != nil {
		return nil, err
	}
	return sjson.SetBytes(body, "model_id", r.upstreamModel)
}

// writeElevenLabsTimestampHead starts the client response with the upstream
// JSON object's opening brace followed by the requested audio format, so the
// rest of the object streams through unchanged.
func writeElevenLabsTimestampHead(c *gin.Context, reader *bufio.Reader, format string) error {
	if err := skipJSONSpace(reader); err != nil {
		return fmt.Errorf("upstream returned no content: %w", err)
	}
	if opening, _ := reader.ReadByte(); opening != '{' {
		return errors.New("upstream did not return a JSON object")
	}
	if err := skipJSONSpace(reader); err != nil {
		return fmt.Errorf("upstream returned an incomplete JSON object: %w", err)
	}
	head, err := common.Marshal(format)
	if err != nil {
		return err
	}
	head = append([]byte(`{"format":`), head...)
	if next, _ := reader.Peek(1); next[0] != '}' {
		head = append(head, ',')
	}
	c.Header("Content-Type", "application/json")
	c.Status(http.StatusOK)
	_, err = c.Writer.Write(head)
	return err
}

// writeElevenLabsMusicHead forwards the audio headers once the upstream has
// sent at least one byte; it refunds a generation that returned nothing.
func writeElevenLabsMusicHead(c *gin.Context, reader *bufio.Reader, httpResp *http.Response) error {
	if _, err := reader.Peek(1); err != nil {
		return fmt.Errorf("upstream returned no audio: %w", err)
	}
	for _, name := range []string{"Content-Type", "Song-Id"} {
		if value := httpResp.Header.Get(name); value != "" {
			c.Header(name, value)
		}
	}
	if httpResp.ContentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(httpResp.ContentLength, 10))
	}
	c.Status(httpResp.StatusCode)
	return nil
}

func skipJSONSpace(reader *bufio.Reader) error {
	for {
		next, err := reader.Peek(1)
		if err != nil {
			return err
		}
		switch next[0] {
		case ' ', '\t', '\r', '\n':
			_, _ = reader.ReadByte()
		default:
			return nil
		}
	}
}

// flushWriter sends each chunk on as it arrives, so a long body does not wait
// in the response buffer.
type flushWriter struct{ gin.ResponseWriter }

func (w flushWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.ResponseWriter.Flush()
	return n, err
}

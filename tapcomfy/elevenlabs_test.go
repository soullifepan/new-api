package tapcomfy

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseElevenLabsRequestBoundsTheBilledQuantity(t *testing.T) {
	tests := []struct {
		name      string
		operation ElevenLabsOperation
		body      string
		model     string
		tokens    int
		errCode   types.ErrorCode
	}{
		{name: "speech bills Unicode characters", operation: ElevenLabsSpeechWithTimestamps,
			body: `{"model":"eleven_v4","input":"这是测试🙂","voice":"v"}`, model: "eleven_v4", tokens: 5},
		{name: "speech without timestamps support", operation: ElevenLabsSpeechWithTimestamps,
			body: `{"model":"eleven_v4_turbo","input":"hi","voice":"v"}`, errCode: "model_not_supported_with_timestamps"},
		{name: "speech stream", operation: ElevenLabsSpeechWithTimestamps,
			body: `{"model":"eleven_v4","input":"hi","stream":true}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "speech without input", operation: ElevenLabsSpeechWithTimestamps,
			body: `{"model":"eleven_v4","voice":"v"}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "music defaults the model and rounds seconds up", operation: ElevenLabsMusic,
			body: `{"prompt":"piano","music_length_ms":10001,"force_instrumental":true}`, model: DefaultElevenLabsMusicModel, tokens: 11},
		{name: "music at the longest length", operation: ElevenLabsMusic,
			body: `{"model":"music_v2_5","prompt":"piano","music_length_ms":600000}`, model: "music_v2_5", tokens: 600},
		{name: "music too long", operation: ElevenLabsMusic,
			body: `{"prompt":"piano","music_length_ms":600001}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "music too short", operation: ElevenLabsMusic,
			body: `{"prompt":"piano","music_length_ms":2999}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "music fractional length", operation: ElevenLabsMusic,
			body: `{"prompt":"piano","music_length_ms":30000.5}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "music without a length", operation: ElevenLabsMusic,
			body: `{"prompt":"piano"}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "music referencing stored audio", operation: ElevenLabsMusic,
			body: `{"prompt":"piano","music_length_ms":30000,"finetune_id":"ft"}`, errCode: types.ErrorCodeInvalidRequest},
		{name: "music prompt too long", operation: ElevenLabsMusic,
			body: `{"prompt":"` + strings.Repeat("音", maxElevenLabsMusicPrompt+1) + `","music_length_ms":30000}`, errCode: types.ErrorCodeInvalidRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request, apiErr := ParseElevenLabsRequest(tc.operation, []byte(tc.body))
			if tc.errCode != "" {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.errCode, apiErr.GetErrorCode())
				assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, tc.model, request.Model)
			assert.Equal(t, tc.tokens, request.BillableTokens)
		})
	}
}

type recordedSettlement struct {
	err      error
	reserved []int
	settled  []int
	refunded bool
}

func (s *recordedSettlement) Settle(quota int) error {
	s.settled = append(s.settled, quota)
	return s.err
}
func (s *recordedSettlement) Refund(*gin.Context)    { s.refunded = true }
func (*recordedSettlement) NeedsRefund() bool        { return false }
func (*recordedSettlement) GetPreConsumedQuota() int { return 0 }
func (*recordedSettlement) Reserve(int) error        { return nil }
func (s *recordedSettlement) ReserveBeforeSubmit(quota int) error {
	s.reserved = append(s.reserved, quota)
	return s.err
}

// A successful response streams to the client and settles the reserved
// quantity at the model ratio: timestamp speech gains the audio format as the
// first JSON member, music keeps its audio bytes and Song-Id. An upstream
// error or an empty body settles nothing, for the caller to refund.
func TestRelayElevenLabs(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	previousRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"eleven_v4":44,"music_v2_5":1375}`))
	t.Cleanup(func() {
		common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
	})

	const timestamps = `{"audio_base64":"QUJD","alignment":null,"normalized_alignment":null}`
	tests := []struct {
		name, body, mapping              string
		operation                        ElevenLabsOperation
		status                           int
		response, contentType, songID    string
		wantPath, wantBody, wantResponse string
		settled                          []int
	}{
		{name: "timestamp speech", operation: ElevenLabsSpeechWithTimestamps,
			body:   `{"model":"eleven_v4","input":"这是一条测试","voice":"v","speed":1.1}`,
			status: http.StatusOK, response: "\n " + timestamps, contentType: "application/json",
			wantPath: "/v1/audio/speech/with-timestamps", wantBody: `{"model":"eleven_v4","input":"这是一条测试","voice":"v","speed":1.1}`,
			wantResponse: `{"format":"mp3","audio_base64":"QUJD","alignment":null,"normalized_alignment":null}`, settled: []int{264}},
		{name: "timestamp speech in wav asks for raw PCM", operation: ElevenLabsSpeechWithTimestamps, mapping: `{"eleven_v4":"eleven_v4_upstream"}`,
			body:   `{"model":"eleven_v4","input":"hi","voice":"v","response_format":"wav"}`,
			status: http.StatusOK, response: `{}`, contentType: "application/json",
			wantPath: "/v1/audio/speech/with-timestamps", wantBody: `{"model":"eleven_v4_upstream","input":"hi","voice":"v","response_format":"pcm_24000"}`,
			wantResponse: `{"format":"pcm_24000"}`, settled: []int{88}},
		{name: "music", operation: ElevenLabsMusic,
			body:   `{"model":"music_v2_5","prompt":"piano","music_length_ms":10001}`,
			status: http.StatusOK, response: "ID3-audio", contentType: "audio/mpeg", songID: "elm_1",
			wantPath: "/v1/music?output_format=mp3_44100_128", wantBody: `{"prompt":"piano","music_length_ms":10001,"model_id":"music_v2_5"}`,
			wantResponse: "ID3-audio", settled: []int{15125}},
		{name: "rejected music prompt keeps its status", operation: ElevenLabsMusic,
			body:   `{"prompt":"in the style of a real singer","music_length_ms":10000}`,
			status: http.StatusBadRequest, response: `{"detail":{"status":"media_request_failed","upstream_status":"bad_prompt"}}`, contentType: "application/json",
			wantPath: "/v1/music?output_format=mp3_44100_128", wantBody: `{"prompt":"in the style of a real singer","music_length_ms":10000,"model_id":"music_v2_5"}`},
		{name: "music without audio", operation: ElevenLabsMusic,
			body:   `{"prompt":"piano","music_length_ms":10000}`,
			status: http.StatusOK, contentType: "audio/mpeg",
			wantPath: "/v1/music?output_format=mp3_44100_128", wantBody: `{"prompt":"piano","music_length_ms":10000,"model_id":"music_v2_5"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var gotPath, gotBody string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.RequestURI()
				body, _ := io.ReadAll(r.Body)
				gotBody = string(body)
				w.Header().Set("Content-Type", tc.contentType)
				if tc.songID != "" {
					w.Header().Set("Song-Id", tc.songID)
				}
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.response)
			}))
			t.Cleanup(upstream.Close)

			request, apiErr := ParseElevenLabsRequest(tc.operation, []byte(tc.body))
			require.Nil(t, apiErr)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/test", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyOriginalModel, request.Model)
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
			common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			common.SetContextKey(c, constant.ContextKeyChannelKey, "sk-test")
			if tc.mapping != "" {
				c.Set("model_mapping", tc.mapping)
			}
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIAudio, request, nil)
			require.NoError(t, err)
			_, err = helper.ModelPriceHelper(c, info, request.BillableTokens, request.GetTokenCountMeta())
			require.NoError(t, err)
			settlement := &recordedSettlement{}
			info.Billing = settlement

			apiErr = RelayElevenLabs(c, info, request)
			assert.Equal(t, tc.wantPath, gotPath)
			assert.Equal(t, tc.wantBody, gotBody)
			assert.Equal(t, tc.settled, settlement.settled)
			if tc.settled == nil {
				require.NotNil(t, apiErr)
				if tc.status != http.StatusOK {
					assert.Equal(t, tc.status, apiErr.StatusCode)
				}
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, http.StatusOK, recorder.Code)
			assert.Equal(t, tc.wantResponse, recorder.Body.String())
			assert.Equal(t, tc.songID, recorder.Header().Get("Song-Id"))
		})
	}
}

func TestElevenLabsSoundRequestContract(t *testing.T) {
	for _, tc := range []struct {
		name, body, query, model, wantBody, wantPath string
		limit                                        float64
	}{
		{name: "default v3 omits optional fields", body: `{"text":"wind"}`, model: DefaultElevenLabsSoundVersion,
			wantBody: `{"text":"wind","model_id":"eleven_text_to_sound_v3"}`, wantPath: "/v1/sound-generation?output_format=mp3_44100_128", limit: 30},
		{name: "v3 preserves explicit zero and false", body: `{"text":"风","model_id":"eleven_text_to_sound_v3","duration_seconds":0.5,"prompt_influence":0,"loop":false}`,
			query: "enable_logging=false&output_format=mp3_44100_128", model: "eleven_text_to_sound_v3",
			wantBody: `{"text":"风","model_id":"eleven_text_to_sound_v3","duration_seconds":0.5,"prompt_influence":0,"loop":false}`,
			wantPath: "/v1/sound-generation?enable_logging=false&output_format=mp3_44100_128", limit: 0.5},
		{name: "upper bounds", body: `{"text":"rain","duration_seconds":30,"prompt_influence":1,"loop":true}`, query: "enable_logging=true", model: DefaultElevenLabsSoundVersion,
			wantBody: `{"text":"rain","model_id":"eleven_text_to_sound_v3","duration_seconds":30,"prompt_influence":1,"loop":true}`,
			wantPath: "/v1/sound-generation?enable_logging=true&output_format=mp3_44100_128", limit: 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request, apiErr := ParseElevenLabsSoundRequest([]byte(tc.body), tc.query)
			require.Nil(t, apiErr)
			assert.Equal(t, ElevenLabsSoundModel, request.Model)
			assert.Equal(t, tc.model, request.VersionModel)
			assert.Equal(t, tc.limit, request.DurationLimitSeconds())
			body, err := request.UpstreamBody()
			require.NoError(t, err)
			assert.JSONEq(t, tc.wantBody, string(body))
			assert.Equal(t, tc.wantPath, request.UpstreamPath())

			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Set("model_mapping", `{"`+tc.model+`":"supplier_sound"}`)
			info := &relaycommon.RelayInfo{OriginModelName: request.VersionModel, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: request.VersionModel}}
			require.NoError(t, helper.ModelMappedHelper(c, info, request))
			body, err = request.UpstreamBody()
			require.NoError(t, err)
			assert.Equal(t, ElevenLabsSoundModel, request.Model, "mapping must preserve the public permission/pricing identity")
			var mapped map[string]any
			require.NoError(t, common.Unmarshal(body, &mapped))
			assert.Equal(t, "supplier_sound", mapped["model_id"])
			assert.NotContains(t, mapped, "model")
		})
	}

	invalidBodies := []string{
		`{"text":"x","model_id":"eleven_text_to_sound_v2"}`,
		`null`, `[]`, `1`, `{}`, `{"text":null}`, `{"text":false}`, `{"text":""}`,
		`{"text":"x","model":"eleven_text_to_sound_v3"}`, `{"text":"x","model_id":""}`,
		`{"text":"x","model_id":null}`, `{"text":"x","model_id":3}`, `{"text":"x","model_id":"unknown"}`,
		`{"text":"x","text":"y"}`, `{"text":"x","model_id":"eleven_text_to_sound_v3","model_id":"eleven_text_to_sound_v3"}`,
		`{"text":"x","model\u005fid":"eleven_text_to_sound_v3","model_id":"eleven_text_to_sound_v3"}`,
		`{"text":"x","":1}`, `{"text":"x","seed":2}`, `{"text":"x","loop":null}`,
		`{"text":"x","loop":0}`, `{"text":"x","loop":"false"}`, `{"text":"x","duration_seconds":null}`,
		`{"text":"x","duration_seconds":"1"}`, `{"text":"x","duration_seconds":true}`,
		`{"text":"x","duration_seconds":0.499}`, `{"text":"x","duration_seconds":30.001}`,
		`{"text":"x","duration_seconds":-1}`, `{"text":"x","duration_seconds":1e999}`,
		`{"text":"x","duration_seconds":NaN}`, `{"text":"x","prompt_influence":null}`,
		`{"text":"x","prompt_influence":"0"}`, `{"text":"x","prompt_influence":-0.001}`,
		`{"text":"x","prompt_influence":1.001}`, `{"text":"x","prompt_influence":1e999}`,
		`{"text":"x"} {}`, `{"text":"` + strings.Repeat("音", 4101) + `"}`,
		"{\"text\":\"\xff\"}",
	}
	for _, body := range invalidBodies {
		t.Run(body, func(t *testing.T) {
			request, apiErr := ParseElevenLabsSoundRequest([]byte(body), "")
			assert.Nil(t, request)
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
			assert.Equal(t, types.ErrorCodeInvalidRequest, apiErr.GetErrorCode())
		})
	}
	for _, query := range []string{
		"output_format=wav", "output_format=", "output_format=mp3_44100_128&output_format=mp3_44100_128",
		"enable_logging=1", "enable_logging=TRUE", "enable_logging=", "enable_logging=false&enable_logging=true",
		"unknown=x", "output_format=%zz", "enable_logging=false;other=x",
	} {
		t.Run(query, func(t *testing.T) {
			request, apiErr := ParseElevenLabsSoundRequest([]byte(`{"text":"wind"}`), query)
			assert.Nil(t, request)
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
		})
	}
	request, apiErr := ParseElevenLabsSoundRequest([]byte(`{"text":"`+strings.Repeat("音", 4100)+`","duration_seconds":1.25}`), "")
	require.Nil(t, apiErr)
	assert.Equal(t, 1.25, request.DurationLimitSeconds())
}

// These fixtures were encoded from exactly 44100 and 44101 zero-valued mono
// samples at 44100 Hz using LAME 3.100's C API, 128 kbps with its real Info/LAME
// tag. Encoder reports: 40 audio frames, delay 576, padding 1404 / 1403.
// They exercise the integer-second boundary after gapless trimming.
// The Lavf fixture is the previously generated v3 bell chime: macOS afconvert
// independently decodes 21168 samples (0.48 seconds), delay 576, padding 1296.
func TestSoundMP3MeasurementAndQuota(t *testing.T) {
	for _, tc := range []struct {
		file           string
		seconds        float64
		billable       int
		corruptOffsets []int
	}{
		{"testdata/sound-lame-1s.mp3", 1, 1, []int{21, 33, 162, 500}},
		{"testdata/sound-lame-44101-samples.mp3", 44101.0 / 44100, 2, []int{21, 33, 162, 500}},
		{"testdata/sound-v3-lavf-0.48s.mp3", 0.48, 1, []int{80, 92, 221, 500}},
	} {
		audio, err := os.ReadFile(tc.file)
		require.NoError(t, err)
		seconds, err := soundMP3Duration(audio)
		require.NoError(t, err)
		assert.Equal(t, tc.seconds, seconds)
		info := &relaycommon.RelayInfo{}
		info.PriceData.ModelRatio = 0.6 * common.QuotaPerUnit / 60
		info.PriceData.GroupRatioInfo.GroupRatio = 0.5
		quota, err := SoundQuota(info, seconds)
		require.NoError(t, err)
		assert.Equal(t, common.QuotaFromFloat(float64(tc.billable)*0.6/60*0.5*common.QuotaPerUnit), quota)
		quota, err = SoundQuota(info, min(seconds, 0.5))
		require.NoError(t, err)
		assert.Equal(t, common.QuotaFromFloat(0.6/60*0.5*common.QuotaPerUnit), quota, "cap precedes second rounding")
		for _, broken := range [][]byte{nil, []byte(`{"error":"failed"}`), audio[:len(audio)-1], audio[:len(audio)-418], append(append([]byte{}, audio...), 0)} {
			_, err := soundMP3Duration(broken)
			require.Error(t, err)
		}
		for _, offset := range tc.corruptOffsets {
			broken := append([]byte{}, audio...)
			broken[offset] ^= 1
			_, err := soundMP3Duration(broken)
			require.Error(t, err, "corrupt metadata or audio must fail checksum/count validation")
		}
	}
	info := &relaycommon.RelayInfo{}
	info.PriceData.ModelRatio = math.MaxFloat64
	info.PriceData.GroupRatioInfo.GroupRatio = 1
	_, err := SoundQuota(info, 30)
	require.Error(t, err)
	require.NotNil(t, info.QuotaClamp)
	for _, seconds := range []float64{-1, 0, 30.001, math.NaN(), math.Inf(1)} {
		_, err := SoundQuota(info, seconds)
		require.Error(t, err)
	}
	for _, tc := range []struct {
		seconds, ratio, group float64
		quota                 int
	}{
		{5.2, 1250, 0.85, 6375},
		{0.5, 1000, 1, 1000},   // 0.12 USD/min: requested-duration reservation
		{0.48, 1000, 1, 1000},  // upstream Sound policy rounds gapless duration up
		{0.48, 1000, 0.5, 500}, // preserve configured group discounts
		{1.001, 1.25, 0.5, 1},  // truncate quota after rounding seconds up
		{0.5, 0.1, 0.5, 1},     // existing minimum positive charge
		{30, 0, 1, 0},
		{30, 1250, 0, 0},
	} {
		info.PriceData.ModelRatio = tc.ratio
		info.PriceData.GroupRatioInfo.GroupRatio = tc.group
		quota, err := SoundQuota(info, tc.seconds)
		require.NoError(t, err)
		assert.Equal(t, tc.quota, quota)
	}
}

type disconnectedSoundWriter struct{ gin.ResponseWriter }

func (disconnectedSoundWriter) Write([]byte) (int, error) {
	return 0, errors.New("client disconnected during audio delivery")
}

func TestRelaySoundBinaryAndFailureContract(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	t.Cleanup(func() { common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume })
	audio, err := os.ReadFile("testdata/sound-lame-44101-samples.mp3")
	require.NoError(t, err)
	lavfAudio, err := os.ReadFile("testdata/sound-v3-lavf-0.48s.mp3")
	require.NoError(t, err)
	for _, tc := range []struct {
		name                         string
		status                       int
		audio                        []byte
		contentLength                int
		cancel, deadline, settleFail bool
		deliveryFail                 bool
		wantStatus                   int
	}{
		{name: "complete binary", status: 200, audio: audio},
		{name: "real v3 Lavf binary", status: 200, audio: lavfAudio},
		{name: "upstream JSON error", status: 422, audio: []byte(`{"error":{"message":"bad prompt","type":"invalid_request_error"}}`), wantStatus: 422},
		{name: "JSON masquerading as success", status: 200, audio: []byte(`{"error":"failed"}`), wantStatus: 502},
		{name: "empty", status: 200, wantStatus: 502},
		{name: "truncated frame", status: 200, audio: audio[:len(audio)-1], wantStatus: 502},
		{name: "truncated declared length", status: 200, audio: audio, contentLength: len(audio) + 1, wantStatus: 502},
		{name: "declared over limit", status: 200, audio: audio, contentLength: soundMaxResponseBytes + 1, wantStatus: 502},
		{name: "chunked over limit", status: 200, audio: bytes.Repeat([]byte{'x'}, soundMaxResponseBytes+1), wantStatus: 502},
		{name: "client cancellation", status: 200, audio: audio, cancel: true, wantStatus: 502},
		{name: "expired deadline", status: 200, audio: audio, deadline: true, wantStatus: 504},
		{name: "local settlement failure", status: 200, audio: audio, settleFail: true, wantStatus: 500},
		{name: "disconnect after completed generation", status: 200, audio: audio, deliveryFail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
				assert.Equal(t, "/v1/sound-generation?enable_logging=false&output_format=mp3_44100_128", r.URL.RequestURI())
				body, readErr := io.ReadAll(r.Body)
				require.NoError(t, readErr)
				assert.JSONEq(t, `{"text":"wind","model_id":"supplier_v3","duration_seconds":0.5,"prompt_influence":0,"loop":false}`, string(body))
				if tc.contentLength > 0 {
					w.Header().Set("Content-Length", strconv.Itoa(tc.contentLength))
				}
				w.WriteHeader(tc.status)
				if len(tc.audio) > soundMaxResponseBytes {
					w.(http.Flusher).Flush()
				}
				_, _ = w.Write(tc.audio)
			}))
			defer upstream.Close()
			request, apiErr := ParseElevenLabsSoundRequest([]byte(`{"text":"wind","model_id":"eleven_text_to_sound_v3","duration_seconds":0.5,"prompt_influence":0,"loop":false}`), "enable_logging=false")
			require.Nil(t, apiErr)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			if tc.deliveryFail {
				c.Writer = disconnectedSoundWriter{c.Writer}
			}
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/sound-generation", nil)
			c.Request.Header.Set("Content-Type", "application/json")
			if tc.cancel {
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				c.Request = c.Request.WithContext(ctx)
			}
			if tc.deadline {
				ctx, cancel := context.WithDeadline(c.Request.Context(), time.Unix(1, 0))
				defer cancel()
				c.Request = c.Request.WithContext(ctx)
			}
			common.SetContextKey(c, constant.ContextKeyOriginalModel, ElevenLabsSoundModel)
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
			common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			common.SetContextKey(c, constant.ContextKeyChannelKey, "sk-test")
			c.Set("model_mapping", `{"eleven_text_to_sound_v3":"supplier_v3"}`)
			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIAudio, request, nil)
			require.NoError(t, err)
			info.PriceData.ModelRatio = 0.6 * common.QuotaPerUnit / 60
			info.PriceData.GroupRatioInfo.GroupRatio = 0.5
			settlement := &recordedSettlement{}
			if tc.settleFail {
				settlement.err = errors.New("offline settlement failure")
			}
			info.Billing = settlement
			apiErr = RelayElevenLabsSound(c, info, request)
			if tc.wantStatus != 0 {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.wantStatus, apiErr.StatusCode)
				assert.Empty(t, recorder.Body.Bytes())
				if !tc.settleFail {
					assert.Empty(t, settlement.settled)
				}
			} else {
				require.Nil(t, apiErr)
				if tc.deliveryFail {
					assert.Empty(t, recorder.Body.Bytes())
				} else {
					assert.Equal(t, tc.audio, recorder.Body.Bytes())
				}
				assert.Equal(t, "audio/mpeg", recorder.Header().Get("Content-Type"))
				assert.Equal(t, "1", recorder.Header().Get("X-Sound-Billable-Seconds"))
				assert.Equal(t, []int{common.QuotaFromFloat(0.6 / 60 * 0.5 * common.QuotaPerUnit)}, settlement.settled)
			}
			if tc.cancel || tc.deadline {
				assert.Zero(t, calls)
			} else {
				assert.Equal(t, 1, calls, "never retry generation")
			}
			assert.Equal(t, ElevenLabsSoundModel, info.OriginModelName)
		})
	}
}

func TestSoundPriceConfigurationAndReservation(t *testing.T) {
	ratios, prices := ratio_setting.ModelRatio2JSONString(), ratio_setting.ModelPrice2JSONString()
	groups, special := ratio_setting.GroupRatio2JSONString(), ratio_setting.GroupGroupRatio2JSONString()
	settings := config.GlobalConfig.Get("billing_setting").(*billing_setting.BillingSetting)
	previousModes := settings.BillingMode
	previousMultiplier := operation_setting.GetQuotaSetting().PreConsumeMultiplier
	previousSelfUse := operation_setting.SelfUseModeEnabled
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(ratios))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groups))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(special))
		settings.BillingMode = previousModes
		operation_setting.GetQuotaSetting().PreConsumeMultiplier = previousMultiplier
		operation_setting.SelfUseModeEnabled = previousSelfUse
	})
	settings.BillingMode = map[string]string{}
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	operation_setting.SelfUseModeEnabled = true
	request, apiErr := ParseElevenLabsSoundRequest([]byte(`{"text":"wind"}`), "")
	require.Nil(t, apiErr)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: ElevenLabsSoundModel, UsingGroup: "sound-test", UserGroup: "sound-user"}
	info.UserSetting.AcceptUnsetRatioModel = true
	apiErr = PrepareSoundPrice(c, info, request)
	require.NotNil(t, apiErr)
	assert.Equal(t, 503, apiErr.StatusCode, "self-use fallback must not invent a Sound price")
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-sound":1250}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"sound-test":0.8}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"sound-user":{"sound-test":0.5}}`))
	for _, multiplier := range []float64{0.5, 1, 2} {
		operation_setting.GetQuotaSetting().PreConsumeMultiplier = multiplier
		settlement := &recordedSettlement{}
		info.Billing = settlement
		apiErr = PrepareSoundPrice(c, info, request)
		require.Nil(t, apiErr)
		assert.Equal(t, 0.5, info.PriceData.GroupRatioInfo.GroupRatio)
		assert.Equal(t, []int{common.QuotaFromFloat(30 * 1250 * 0.5 * max(1, multiplier))}, settlement.reserved)
		assert.True(t, info.ForcePreConsume)
		assert.True(t, helper.HasModelBillingConfig(ElevenLabsSoundModel))
	}
	// The quote remains frozen even if an administrator changes the ratio mid-flight.
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-sound":2500}`))
	quota, err := SoundQuota(info, 5.2)
	require.NoError(t, err)
	assert.Equal(t, 3750, quota)
	// A per-request price or unsupported expression must never override duration charging.
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"elevenlabs-sound":0.15}`))
	apiErr = PrepareSoundPrice(c, info, request)
	require.NotNil(t, apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
	settings.BillingMode = map[string]string{ElevenLabsSoundModel: "tiered_expr"}
	apiErr = PrepareSoundPrice(c, info, request)
	require.NotNil(t, apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
	settings.BillingMode = map[string]string{}
	// Saving an explicit zero ratio is an administrator's free-price choice.
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-sound":0}`))
	apiErr = PrepareSoundPrice(c, info, request)
	require.Nil(t, apiErr)
	assert.True(t, info.PriceData.FreeModel)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-sound":-1}`))
	apiErr = PrepareSoundPrice(c, info, request)
	require.NotNil(t, apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-sound":1250}`))
	settlement := &recordedSettlement{err: errors.New("insufficient reserved quota")}
	info.Billing = settlement
	apiErr = PrepareSoundPrice(c, info, request)
	require.NotNil(t, apiErr)
	assert.Empty(t, settlement.settled)
}

func TestSoundPublicModelAuthorization(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	for _, body := range []string{`{"text":"wind"}`, `{"text":"wind","model_id":"eleven_text_to_sound_v3"}`} {
		t.Run(body, func(t *testing.T) {
			router := gin.New()
			router.POST("/v1/sound-generation", func(c *gin.Context) {
				common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, true)
				// Having access to an internal version never grants the public model.
				common.SetContextKey(c, constant.ContextKeyTokenModelLimit, map[string]bool{"eleven_text_to_sound_v3": true})
			}, PrepareElevenLabsSound, middleware.Distribute(), func(c *gin.Context) { t.Error("forbidden request reached the relay") })
			recorder := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/v1/sound-generation", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, req)
			assert.Equal(t, 403, recorder.Code)
			assert.True(t, middleware.TokenModelLimitAllows(map[string]bool{ElevenLabsSoundModel: true}, ElevenLabsSoundModel))
		})
	}
	router := gin.New()
	router.POST("/v1/sound-generation", middleware.TokenAuth(), PrepareElevenLabsSound, func(c *gin.Context) { t.Error("unauthenticated request reached the relay") })
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/sound-generation", strings.NewReader(`{"text":"wind"}`)))
	assert.Equal(t, 401, recorder.Code)
}

package tapcomfy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
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
	settled  []int
	refunded bool
}

func (s *recordedSettlement) Settle(quota int) error {
	s.settled = append(s.settled, quota)
	return nil
}
func (s *recordedSettlement) Refund(*gin.Context)         { s.refunded = true }
func (*recordedSettlement) NeedsRefund() bool             { return false }
func (*recordedSettlement) GetPreConsumedQuota() int      { return 0 }
func (*recordedSettlement) Reserve(int) error             { return nil }
func (*recordedSettlement) ReserveBeforeSubmit(int) error { return nil }

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

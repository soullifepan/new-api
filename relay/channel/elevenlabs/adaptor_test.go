package elevenlabs

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelTypeElevenLabsRegistration(t *testing.T) {
	apiType, ok := common.ChannelType2APIType(constant.ChannelTypeElevenLabs)
	require.True(t, ok)
	assert.Equal(t, constant.APITypeElevenLabs, apiType)
	assert.Equal(t, "ElevenLabs", constant.GetChannelTypeName(constant.ChannelTypeElevenLabs))
	assert.Equal(t, "https://api.elevenlabs.io", constant.GetChannelBaseURL(constant.ChannelTypeElevenLabs))
}

func TestAdaptorTTS(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)

	var gotPath, gotAPIKey, gotAuth, gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		gotAPIKey = r.Header.Get("xi-api-key")
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "audio/mpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("MP3-BYTES"))
	}))
	defer upstream.Close()

	rawBody := `{"model":"eleven_v4","input":"hello world","voice":"voice_abc","response_format":"mp3","speed":1.15,"voice_settings":{"stability":0.4}}`
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/audio/speech", strings.NewReader(rawBody))
	c.Request.Header.Set("Content-Type", "application/json")

	speed := 1.15
	req := dto.AudioRequest{
		Model:          "eleven_v4",
		Input:          "hello world",
		Voice:          "voice_abc",
		ResponseFormat: "mp3",
		Speed:          &speed,
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:    constant.ChannelTypeElevenLabs,
			ChannelBaseUrl: upstream.URL,
			ApiKey:         "el-secret-key",
		},
		RelayMode: relayconstant.RelayModeAudioSpeech,
		Request:   &req,
	}
	info.SetEstimatePromptTokens(11)

	adaptor := &Adaptor{}
	adaptor.Init(info)

	bodyReader, err := adaptor.ConvertAudioRequest(c, info, req)
	require.NoError(t, err)

	resp, err := adaptor.DoRequest(c, info, bodyReader)
	require.NoError(t, err)
	httpResp, ok := resp.(*http.Response)
	require.True(t, ok)

	usageAny, apiErr := adaptor.DoResponse(c, httpResp, info)
	require.Nil(t, apiErr)

	assert.Equal(t, "/v1/text-to-speech/voice_abc?output_format=mp3_44100_128", gotPath)
	assert.Equal(t, "el-secret-key", gotAPIKey)
	assert.Empty(t, gotAuth)
	assert.JSONEq(t, `{"text":"hello world","model_id":"eleven_v4","voice_settings":{"stability":0.4,"speed":1.15}}`, gotBody)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "audio/mpeg", rec.Header().Get("Content-Type"))
	assert.Equal(t, "MP3-BYTES", rec.Body.String())

	usage, ok := usageAny.(*dto.Usage)
	require.True(t, ok)
	assert.Equal(t, 11, usage.PromptTokens)
	assert.Equal(t, 11, usage.TotalTokens)
}

func TestAdaptorSTT(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)

	var gotPath, gotAPIKey, gotAuth string
	var gotFields map[string]string
	var gotFilename string
	var gotFileContent []byte

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		gotAPIKey = r.Header.Get("xi-api-key")
		gotAuth = r.Header.Get("Authorization")
		require.NoError(t, r.ParseMultipartForm(10<<20))
		gotFields = make(map[string]string, len(r.MultipartForm.Value))
		for k, v := range r.MultipartForm.Value {
			if len(v) > 0 {
				gotFields[k] = v[0]
			}
		}
		f, fh, err := r.FormFile("file")
		require.NoError(t, err)
		defer f.Close()
		gotFilename = fh.Filename
		gotFileContent, _ = io.ReadAll(f)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"language_code":"eng","text":"Hello world","words":[{"text":"Hello","start":0.0,"end":0.4,"type":"word"},{"text":"world","start":0.5,"end":1.8,"type":"word"}]}`))
	}))
	defer upstream.Close()

	var formBuf bytes.Buffer
	writer := multipart.NewWriter(&formBuf)
	require.NoError(t, writer.WriteField("model", "scribe_v2"))
	require.NoError(t, writer.WriteField("language", "en"))
	require.NoError(t, writer.WriteField("timestamps_granularity", "word"))
	require.NoError(t, writer.WriteField("tag_audio_events", "true"))
	require.NoError(t, writer.WriteField("diarize", "true"))
	require.NoError(t, writer.WriteField("num_speakers", "2"))
	part, err := writer.CreateFormFile("file", "clip.wav")
	require.NoError(t, err)
	_, err = part.Write([]byte("WAV-DATA"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", bytes.NewReader(formBuf.Bytes()))
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())

	req := dto.AudioRequest{Model: "scribe_v2"}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:    constant.ChannelTypeElevenLabs,
			ChannelBaseUrl: upstream.URL,
			ApiKey:         "el-secret-key",
		},
		RelayMode: relayconstant.RelayModeAudioTranscription,
		Request:   &req,
	}

	adaptor := &Adaptor{}
	adaptor.Init(info)

	bodyReader, err := adaptor.ConvertAudioRequest(c, info, req)
	require.NoError(t, err)

	resp, err := adaptor.DoRequest(c, info, bodyReader)
	require.NoError(t, err)
	httpResp, ok := resp.(*http.Response)
	require.True(t, ok)

	usageAny, apiErr := adaptor.DoResponse(c, httpResp, info)
	require.Nil(t, apiErr)

	assert.Equal(t, "/v1/speech-to-text", gotPath)
	assert.Equal(t, "el-secret-key", gotAPIKey)
	assert.Empty(t, gotAuth)
	assert.Equal(t, "scribe_v2", gotFields["model_id"])
	assert.Equal(t, "en", gotFields["language_code"])
	assert.Equal(t, "word", gotFields["timestamps_granularity"])
	assert.Equal(t, "true", gotFields["tag_audio_events"])
	assert.Equal(t, "true", gotFields["diarize"])
	assert.Equal(t, "2", gotFields["num_speakers"])
	assert.Equal(t, "clip.wav", gotFilename)
	assert.Equal(t, []byte("WAV-DATA"), gotFileContent)

	var out map[string]any
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &out))
	assert.Equal(t, "Hello world", out["text"])
	assert.Equal(t, 1.8, out["audio_duration_secs"])
	words, ok := out["words"].([]any)
	require.True(t, ok)
	assert.Len(t, words, 2)

	// No pre-estimated tokens -> derived from audio_duration_secs (ceil(1.8)/60*1000 = 33).
	usage, ok := usageAny.(*dto.Usage)
	require.True(t, ok)
	assert.Equal(t, 33, usage.PromptTokens)
	assert.Equal(t, 33, usage.TotalTokens)
}

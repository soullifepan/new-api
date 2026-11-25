package studio

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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

func voiceCloneForm(t *testing.T, fields map[string]string, files map[string]string) (string, []byte) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		require.NoError(t, writer.WriteField(key, value))
	}
	for name, content := range files {
		part, err := writer.CreateFormFile("files", name)
		require.NoError(t, err)
		_, err = part.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	return writer.FormDataContentType(), body.Bytes()
}

func TestParseElevenLabsVoiceRequest(t *testing.T) {
	tests := []struct {
		name      string
		operation ElevenLabsVoiceOperation
		fields    map[string]string
		files     map[string]string
		errCode   types.ErrorCode
	}{
		{name: "clone accepts documented multipart fields", operation: ElevenLabsVoiceClone, fields: map[string]string{"name": "Narrator", "description": "Warm", "labels": `{"accent":"british"}`, "remove_background_noise": "true"}, files: map[string]string{"sample.mp3": "audio"}},
		{name: "clone requires file", operation: ElevenLabsVoiceClone, fields: map[string]string{"name": "Narrator"}, errCode: types.ErrorCodeInvalidRequest},
		{name: "edit requires name", operation: ElevenLabsVoiceEdit, fields: map[string]string{}, errCode: types.ErrorCodeInvalidRequest},
		{name: "rejects non string labels", operation: ElevenLabsVoiceClone, fields: map[string]string{"name": "Narrator", "labels": `{"rank":1}`}, files: map[string]string{"sample.mp3": "audio"}, errCode: types.ErrorCodeInvalidRequest},
		{name: "rejects invalid noise flag", operation: ElevenLabsVoiceClone, fields: map[string]string{"name": "Narrator", "remove_background_noise": "yes"}, files: map[string]string{"sample.mp3": "audio"}, errCode: types.ErrorCodeInvalidRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			contentType, body := voiceCloneForm(t, tc.fields, tc.files)
			request, apiErr := ParseElevenLabsVoiceRequest(tc.operation, contentType, body, "voice-1")
			if tc.errCode != "" {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.errCode, apiErr.GetErrorCode())
				assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
				return
			}
			require.Nil(t, apiErr)
			assert.Equal(t, ElevenLabsVoiceCloneModel, request.Model)
			assert.Equal(t, 1, request.BillableTokens)
			assert.Equal(t, body, request.body)
		})
	}
}

func TestParseElevenLabsVoiceManagementRequestIsFree(t *testing.T) {
	request, apiErr := ParseElevenLabsVoiceRequest(ElevenLabsVoiceList, "", nil, "")
	require.Nil(t, apiErr)
	assert.Equal(t, ElevenLabsVoiceCloneModel, request.Model)
	assert.Zero(t, request.BillableTokens)
}

func TestRelayElevenLabsVoiceDirectChannelPaths(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	batch, logConsume := common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.BatchUpdateEnabled, common.LogConsumeEnabled = true, false
	previousRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"elevenlabs-voice-clone":10}`))
	t.Cleanup(func() {
		common.BatchUpdateEnabled, common.LogConsumeEnabled = batch, logConsume
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
	})

	cloneCT, cloneBody := voiceCloneForm(t, map[string]string{"name": "Narrator"}, map[string]string{"sample.mp3": "audio"})
	editCT, editBody := voiceCloneForm(t, map[string]string{"name": "Renamed"}, nil)

	tests := []struct {
		name        string
		channelType int
		operation   ElevenLabsVoiceOperation
		method      string
		voiceID     string
		query       string
		contentType string
		body        []byte
		response    string
		wantPath    string
		wantAuth    string
		wantXIKey   string
		wantBill    bool
	}{
		{name: "clone direct elevenlabs", channelType: constant.ChannelTypeElevenLabs, operation: ElevenLabsVoiceClone, method: http.MethodPost, contentType: cloneCT, body: cloneBody, response: `{"voice_id":"v_1","requires_verification":false}`, wantPath: "/v1/voices/add", wantXIKey: "el-key", wantBill: true},
		{name: "list direct elevenlabs", channelType: constant.ChannelTypeElevenLabs, operation: ElevenLabsVoiceList, method: http.MethodGet, query: "show_legacy=true", response: `{"voices":[]}`, wantPath: "/v1/voices?show_legacy=true", wantXIKey: "el-key"},
		{name: "get direct elevenlabs", channelType: constant.ChannelTypeElevenLabs, operation: ElevenLabsVoiceGet, method: http.MethodGet, voiceID: "v_1", response: `{"voice_id":"v_1"}`, wantPath: "/v1/voices/v_1", wantXIKey: "el-key"},
		{name: "edit direct elevenlabs", channelType: constant.ChannelTypeElevenLabs, operation: ElevenLabsVoiceEdit, method: http.MethodPost, voiceID: "v_1", contentType: editCT, body: editBody, response: `{"voice_id":"v_1","requires_verification":false}`, wantPath: "/v1/voices/v_1/edit", wantXIKey: "el-key", wantBill: true},
		{name: "delete direct elevenlabs", channelType: constant.ChannelTypeElevenLabs, operation: ElevenLabsVoiceDelete, method: http.MethodDelete, voiceID: "v_1", response: `{"status":"ok"}`, wantPath: "/v1/voices/v_1", wantXIKey: "el-key"},
		{name: "clone legacy openai preserved", channelType: constant.ChannelTypeOpenAI, operation: ElevenLabsVoiceClone, method: http.MethodPost, contentType: cloneCT, body: cloneBody, response: `{"voice_id":"v_2","requires_verification":false}`, wantPath: "/v1/elevenlabs/voices", wantAuth: "Bearer el-key", wantBill: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var gotMethod, gotPath, gotAuth, gotXIKey string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				gotPath = r.URL.RequestURI()
				gotAuth = r.Header.Get("Authorization")
				gotXIKey = r.Header.Get("xi-api-key")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(tc.response))
			}))
			defer upstream.Close()

			request, apiErr := ParseElevenLabsVoiceRequest(tc.operation, tc.contentType, tc.body, tc.voiceID)
			require.Nil(t, apiErr)

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			reqURL := "/v1/elevenlabs/voices"
			if tc.query != "" {
				reqURL += "?" + tc.query
			}
			c.Request = httptest.NewRequest(tc.method, reqURL, bytes.NewReader(tc.body))
			if tc.contentType != "" {
				c.Request.Header.Set("Content-Type", tc.contentType)
			}
			common.SetContextKey(c, constant.ContextKeyOriginalModel, ElevenLabsVoiceCloneModel)
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
			common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(c, constant.ContextKeyChannelType, tc.channelType)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			common.SetContextKey(c, constant.ContextKeyChannelKey, "el-key")

			info, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIAudio, request, nil)
			require.NoError(t, err)
			settlement := &recordedSettlement{}
			info.Billing = settlement
			if tc.wantBill {
				_, err = helper.ModelPriceHelper(c, info, request.BillableTokens, request.GetTokenCountMeta())
				require.NoError(t, err)
			}

			apiErr = RelayElevenLabsVoice(c, info, request)
			require.Nil(t, apiErr)
			assert.Equal(t, tc.method, gotMethod)
			assert.Equal(t, tc.wantPath, gotPath)
			assert.Equal(t, tc.wantAuth, gotAuth)
			assert.Equal(t, tc.wantXIKey, gotXIKey)
			assert.JSONEq(t, tc.response, recorder.Body.String())
			if tc.wantBill {
				assert.NotEmpty(t, settlement.settled)
			} else {
				assert.Empty(t, settlement.settled)
			}
		})
	}
}

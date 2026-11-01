package tapcomfy

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
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

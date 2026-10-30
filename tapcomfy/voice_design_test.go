package tapcomfy

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseElevenLabsVoiceRequest(t *testing.T) {
	tests := []struct {
		name      string
		operation ElevenLabsVoiceOperation
		body      string
		wantBody  string
		errCode   types.ErrorCode
	}{
		{
			name: "design maps documented fields", operation: ElevenLabsVoiceDesign,
			body:     `{"model":"elevenlabs-voice-design","description":"A warm and calm narrator with a measured pace.","preview_text":"This preview text is deliberately more than one hundred characters long so that it meets the documented ElevenLabs voice design minimum.","loudness":0,"guidance_scale":5}`,
			wantBody: `{"voice_description":"A warm and calm narrator with a measured pace.","text":"This preview text is deliberately more than one hundred characters long so that it meets the documented ElevenLabs voice design minimum.","loudness":0,"guidance_scale":5,"model_id":"eleven_multilingual_ttv_v2"}`,
		},
		{
			name: "save maps documented fields", operation: ElevenLabsVoiceSave,
			body:     `{"model":"elevenlabs-voice-design","design_id":"generated-1","name":"Narrator","description":"A warm and calm narrator with a measured pace."}`,
			wantBody: `{"voice_name":"Narrator","voice_description":"A warm and calm narrator with a measured pace.","generated_voice_id":"generated-1"}`,
		},
		{
			name: "design rejects absent preview without automatic text", operation: ElevenLabsVoiceDesign,
			body:    `{"model":"elevenlabs-voice-design","description":"A warm and calm narrator with a measured pace.","auto_generate_text":false}`,
			errCode: types.ErrorCodeInvalidRequest,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request, apiErr := ParseElevenLabsVoiceRequest(tc.operation, []byte(tc.body))
			if tc.errCode != "" {
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.errCode, apiErr.GetErrorCode())
				assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
				return
			}
			require.Nil(t, apiErr)
			body, err := request.upstreamBody()
			require.NoError(t, err)
			assert.JSONEq(t, tc.wantBody, string(body))
		})
	}
}

func TestNormalizeElevenLabsVoiceResponse(t *testing.T) {
	body, apiErr := normalizeElevenLabsVoiceResponse(ElevenLabsVoiceDesign, []byte(`{"text":"preview text","previews":[{"generated_voice_id":"design-1","audio_base_64":"QUJD","duration_secs":4.2}]}`))
	require.Nil(t, apiErr)
	assert.JSONEq(t, `{"text":"preview text","previews":[{"design_id":"design-1","audio_base64":"QUJD","media_type":"audio/mpeg","duration_secs":4.2}]}`, string(body))

	body, apiErr = normalizeElevenLabsVoiceResponse(ElevenLabsVoiceSave, []byte(`{"voice_id":"voice-1","name":"Narrator"}`))
	require.Nil(t, apiErr)
	assert.JSONEq(t, `{"voice_id":"voice-1","name":"Narrator"}`, string(body))
}

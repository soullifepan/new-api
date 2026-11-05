package plugins_test

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/png"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAPIMartLocalPluginFixturesAndBillingHooks(t *testing.T) {
	for _, testCase := range []struct {
		key, reservationModel string
		reservationRequest    map[string]any
		completion            map[string]any
		wantReservation       map[string]any
		wantCompletion        map[string]any
	}{
		{
			key:              "apimart",
			reservationModel: "gpt-image-2-official-am",
			reservationRequest: map[string]any{"model": "gpt-image-2-official-am", "resolution": "2k", "quality": "medium", "n": 2,
				"image_urls": []any{"https://example.test/a.png", "https://example.test/b.png"}},
			completion:      map[string]any{"code": 200, "data": map[string]any{"status": "completed", "credits_cost": 0.04792}},
			wantReservation: map[string]any{"upstream_credits": 2.448},
			wantCompletion:  map[string]any{"upstream_credits": 0.04792},
		},
		{
			key:              "apimart-video",
			reservationModel: "minimax-h3-context-ir-am",
			reservationRequest: map[string]any{"model": "minimax-h3-context-ir-am", "prompt": "ocean sunrise", "duration": 5,
				"aspect_ratio": "16:9"},
			completion:      map[string]any{"code": 200, "data": map[string]any{"status": "completed", "cost": 0.1265, "credits_cost": 1.265}},
			wantReservation: map[string]any{"upstream_credits": 0.8},
			wantCompletion:  map[string]any{"upstream_credits": 1.265},
		},
	} {
		t.Run(testCase.key, func(t *testing.T) {
			source, err := os.ReadFile("local/" + testCase.key + "/plugin.js")
			require.NoError(t, err)
			fixture, err := os.ReadFile("local/" + testCase.key + "/" + testCase.key + ".fixture.json")
			require.NoError(t, err)
			report, err := jsplugin.ReplayFixture(t.Context(), string(source), fixture)
			require.NoError(t, err)
			assert.Equal(t, report.Total, report.Passed)

			plugin, err := jsplugin.NewRegistry().Register(string(source), jsplugin.Options{})
			require.NoError(t, err)
			reservation, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{"model": testCase.reservationModel, "requestBody": testCase.reservationRequest})
			require.NoError(t, err)
			completion, err := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{"model": testCase.reservationModel}, map[string]any{"status": "SUCCESS"}, testCase.completion)
			require.NoError(t, err)

			var gotReservation, gotCompletion map[string]any
			encoded, err := common.Marshal(reservation)
			require.NoError(t, err)
			require.NoError(t, common.Unmarshal(encoded, &gotReservation))
			encoded, err = common.Marshal(completion)
			require.NoError(t, err)
			require.NoError(t, common.Unmarshal(encoded, &gotCompletion))
			assert.Equal(t, testCase.wantReservation, gotReservation)
			assert.Equal(t, testCase.wantCompletion, gotCompletion)
		})
	}
}

// Large boundary strings belong here instead of making the shared JSON fixture unreadable.
func TestAPIMartGPT26CharacterAndLayerBoundaries(t *testing.T) {
	source, err := os.ReadFile("local/apimart/plugin.js")
	require.NoError(t, err)
	var pngBytes bytes.Buffer
	require.NoError(t, png.Encode(&pngBytes, image.NewNRGBA(image.Rect(0, 0, 1, 1))))
	pngURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes.Bytes())
	oversized := bytes.Clone(pngBytes.Bytes())
	binary.BigEndian.PutUint32(oversized[16:20], 4097)
	binary.BigEndian.PutUint32(oversized[20:24], 4096)
	references := make([]string, 16)
	for i := range references {
		references[i] = "https://example.test/ref.png"
	}
	for _, model := range []string{"gpt-image-2.6-flare-am", "gpt-image-2.6-sunburst-am"} {
		t.Run(model, func(t *testing.T) {
			cases := []any{}
			for _, tc := range []struct {
				name      string
				fields    map[string]any
				wantError string
			}{
				{"unicode prompt at limit", map[string]any{"prompt": strings.Repeat("😀", 32000)}, ""},
				{"unicode prompt over limit", map[string]any{"prompt": strings.Repeat("😀", 32001)}, "prompt must contain 1 to 32000 characters"},
				{"unicode safety at limit", map[string]any{"safety_identifier": strings.Repeat("界", 128)}, ""},
				{"unicode safety over limit", map[string]any{"safety_identifier": strings.Repeat("界", 129)}, "safety_identifier must be a string of at most 128 characters"},
				{"sixteen references", map[string]any{"image_urls": references}, ""},
				{"seventeen references", map[string]any{"image_urls": append(append([]string{}, references...), "https://example.test/extra.png")}, "image_urls must contain at most 16"},
				{"PNG markup", map[string]any{"image_urls": references[:1], "markup_url": pngURL}, ""},
				{"PNG mask", map[string]any{"image_urls": references[:1], "mask_url": pngURL}, ""},
				{"truncated PNG markup", map[string]any{"image_urls": references[:1], "markup_url": "data:image/png;base64,iVBORw0KGgo="}, "must contain a PNG IHDR"},
				// Mutated IHDR is deliberately invalid; the local size guard must reject it before upload.
				{"oversized markup IHDR", map[string]any{"image_urls": references[:1], "markup_url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(oversized)}, "markup PNG must not exceed 16777216 pixels"},
			} {
				request := map[string]any{"model": model, "prompt": "test"}
				for key, value := range tc.fields {
					request[key] = value
				}
				fixtureCase := map[string]any{"name": tc.name, "hook": "native", "member": "decodeImageGeneration", "args": []any{map[string]any{"body": map[string]any{"kind": "json", "value": request}}}}
				if tc.wantError != "" {
					fixtureCase["expectedError"] = tc.wantError
				} else {
					normalized := map[string]any{"model": model, "prompt": "test", "n": 1, "resolution": "1k", "quality": "auto", "output_format": "png", "moderation": "low"}
					for key, value := range tc.fields {
						normalized[key] = value
					}
					fixtureCase["expected"] = map[string]any{"kind": "submit", "model": model, "action": "image_generation", "requestBody": normalized}
				}
				cases = append(cases, fixtureCase)
			}
			fixture, err := common.Marshal(map[string]any{"cases": cases})
			require.NoError(t, err)
			report, err := jsplugin.ReplayFixture(t.Context(), string(source), fixture)
			require.NoError(t, err)
			assert.Equal(t, report.Total, report.Passed)
		})
	}
}

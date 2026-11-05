package plugins_test

import (
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
func TestAPIMartGPT26CharacterBoundaries(t *testing.T) {
	source, err := os.ReadFile("local/apimart/plugin.js")
	require.NoError(t, err)
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
			} {
				request := map[string]any{"model": model, "prompt": "test", "size": "1:1", "quality": "low"}
				for key, value := range tc.fields {
					request[key] = value
				}
				fixtureCase := map[string]any{"name": tc.name, "hook": "native", "member": "decodeImageGeneration", "args": []any{map[string]any{"body": map[string]any{"kind": "json", "value": request}}}}
				if tc.wantError != "" {
					fixtureCase["expectedError"] = tc.wantError
				} else {
					normalized := map[string]any{"model": model, "prompt": "test", "n": 1, "resolution": "1k", "quality": "low", "output_format": "png", "moderation": "low", "size": "1:1"}
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

func TestAPIMartMuseReferenceByteBoundaries(t *testing.T) {
	source, err := os.ReadFile("local/apimart-video/plugin.js")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().Register(string(source), jsplugin.Options{})
	require.NoError(t, err)
	const maxBytes = 11 * 1024 * 1024
	for _, tc := range []struct {
		name   string
		sizes  []int
		reject bool
	}{
		{"single reference at total limit", []int{maxBytes}, false},
		{"single reference over total limit", []int{maxBytes + 1}, true},
		{"two references at total limit", []int{maxBytes / 2, maxBytes / 2}, false},
		{"two individually valid references exceed total", []int{maxBytes / 2, maxBytes/2 + 1}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			images := make([]any, 0, len(tc.sizes))
			for i, size := range tc.sizes {
				encoded := strings.Repeat("YWFh", size/3)
				switch size % 3 {
				case 1:
					encoded += "YQ=="
				case 2:
					encoded += "YWE="
				}
				if i == 0 {
					encoded = "data:image/png;base64," + encoded
				}
				images = append(images, encoded)
			}
			value, callErr := plugin.Engine.CallMember(t.Context(), "native", "decodeVideoGeneration", map[string]any{
				"body": map[string]any{"kind": "json", "value": map[string]any{"model": "muse-video-ext-am", "prompt": "waves", "image_urls": images}},
			})
			if tc.reject {
				require.ErrorContains(t, callErr, "total raw bytes exceeds 11 MiB")
				return
			}
			require.NoError(t, callErr)
			intent, ok := value.(map[string]any)
			require.True(t, ok)
			body, ok := intent["requestBody"].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, images, body["image_urls"])
		})
	}
}

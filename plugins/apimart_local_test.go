package plugins_test

import (
	"os"
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

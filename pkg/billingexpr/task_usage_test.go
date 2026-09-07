package billingexpr

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskUsageExpressionUsesFactsAndTaskQuotaConversion(t *testing.T) {
	expression := `tier("1080p", u("seconds") * (u("resolution") == "1080p" ? 0.4 : 0.2))`
	cost, trace, err := RunExprWithRequest(expression, TokenParams{}, RequestInput{Usage: map[string]any{"seconds": 10.0, "resolution": "1080p"}})
	require.NoError(t, err)
	assert.Equal(t, 4.0, cost)
	assert.Equal(t, "1080p", trace.MatchedTier)
	result, err := ComputeTieredQuotaWithRequest(&BillingSnapshot{ExprString: expression, ExprHash: ExprHashString(expression), GroupRatio: 2, QuotaPerUnit: 500000, ExprVersion: 1, TaskUsageBilling: true}, TokenParams{}, RequestInput{Usage: map[string]any{"seconds": 10.0, "resolution": "1080p"}})
	require.NoError(t, err)
	assert.Equal(t, 4_000_000, result.ActualQuotaAfterGroup)
}

func TestTaskUsageExpressionSeparatesOutputModesAndChargesReferenceImages(t *testing.T) {
	expression := `u("resolution") == "1k"
  ? tier("1k", u("standard_images") * 0.02925 + u("layer_images") * 0.014625 + u("reference_images") * 0.00195)
  : u("resolution") == "1.5k"
    ? tier("1.5k", u("standard_images") * 0.02925 + u("layer_images") * 0.014625 + u("reference_images") * 0.00195)
    : tier("2k", u("standard_images") * 0.0585 + u("layer_images") * 0.02925 + u("reference_images") * 0.00195)`

	testCases := []struct {
		name        string
		usage       map[string]any
		expected    float64
		matchedTier string
	}{
		{
			name:        "one reference image is charged",
			usage:       map[string]any{"resolution": "1k", "standard_images": 1.0, "layer_images": 0.0, "reference_images": 1.0},
			expected:    0.0312,
			matchedTier: "1k",
		},
		{
			name:        "two reference images are charged twice",
			usage:       map[string]any{"resolution": "1k", "standard_images": 1.0, "layer_images": 0.0, "reference_images": 2.0},
			expected:    0.03315,
			matchedTier: "1k",
		},
		{
			name:        "standard 1.5K charges all references",
			usage:       map[string]any{"resolution": "1.5k", "standard_images": 1.0, "layer_images": 0.0, "reference_images": 3.0},
			expected:    0.0351,
			matchedTier: "1.5k",
		},
		{
			name:        "layer 1.5K preauthorization charges fixed reference",
			usage:       map[string]any{"resolution": "1.5k", "standard_images": 0.0, "layer_images": 17.0, "reference_images": 1.0},
			expected:    0.250575,
			matchedTier: "1.5k",
		},
		{
			name:        "layer 1.5K settlement charges fixed reference",
			usage:       map[string]any{"resolution": "1.5k", "standard_images": 0.0, "layer_images": 3.0, "reference_images": 1.0},
			expected:    0.045825,
			matchedTier: "1.5k",
		},
		{
			name:        "layer 2K preauthorization charges fixed reference",
			usage:       map[string]any{"resolution": "2k", "standard_images": 0.0, "layer_images": 17.0, "reference_images": 1.0},
			expected:    0.4992,
			matchedTier: "2k",
		},
		{
			name:        "layer 2K settlement charges fixed reference",
			usage:       map[string]any{"resolution": "2k", "standard_images": 0.0, "layer_images": 3.0, "reference_images": 1.0},
			expected:    0.0897,
			matchedTier: "2k",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			cost, trace, err := RunExprWithRequest(expression, TokenParams{}, RequestInput{Usage: testCase.usage})
			require.NoError(t, err)
			assert.InDelta(t, testCase.expected, cost, 0.0000001)
			assert.Equal(t, testCase.matchedTier, trace.MatchedTier)
		})
	}
}

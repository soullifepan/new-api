package plugins_test

import (
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	taskplugin "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Both uploads are standalone modules. Exercise them in the actual Sobek host,
// including their native route bindings and the task-usage dollar conversion.
func TestSeedanceLocalVideoContract(t *testing.T) {
	for _, provider := range []string{"hx", "hub"} {
		t.Run(provider, func(t *testing.T) {
			key := "seedance-" + provider
			source, err := os.ReadFile("local/" + key + "/plugin.js")
			require.NoError(t, err)
			registry := jsplugin.NewRegistry()
			plugin, err := registry.Register(string(source), jsplugin.Options{})
			require.NoError(t, err)
			fixture, err := os.ReadFile("local/" + key + "/" + key + ".fixture.json")
			require.NoError(t, err)
			report, err := jsplugin.ReplayFixture(t.Context(), string(source), fixture)
			require.NoError(t, err)
			assert.Equal(t, report.Total, report.Passed)
			_, err = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, map[string]any{"status": "succeeded", "usage": map[string]any{"completion_tokens": 42}})
			require.ErrorContains(t, err, "missing generated video URL")

			for _, route := range []struct{ method, suffix, member string }{
				{"POST", "", "taskCreated"},
				{"GET", "/:task_id", "taskStatus"},
			} {
				binding, found := registry.Generation().LookupDeclaredRoute(route.method, "/"+key+"/api/v3/contents/generations/tasks"+route.suffix)
				require.True(t, found)
				assert.Same(t, plugin, binding.Plugin)
				assert.Equal(t, route.member, binding.Route.Render)
			}

			for _, tc := range []struct{ name, version, body, failure string }{
				{"edit defaults", "2-5", `{"omni_reference_task_type":"edit"}`, ""},
				{"extend defaults", "2-5", `{"omni_reference_task_type":"extend"}`, ""},
				{"auto may fail asynchronously", "2-5", `{"omni_reference_task_type":"auto","duration":5,"ratio":"16:9"}`, ""},
				{"reference fixed ratio", "2-5", `{"omni_reference_task_type":"reference","duration":30,"ratio":"21:9","output_format":"mp4"}`, ""},
				{"minimum duration", "2-5", `{"duration":4,"resolution":"480p","return_last_frame":false,"generate_audio":false,"watermark":false}`, ""},
				{"text only", "2-5", `{"content":[{"type":"text","text":"cat"}]}`, ""},
				{"audio only", "2-5", `{"content":[{"type":"audio_url","audio_url":{"url":"asset://sa_audio"}}]}`, ""},
				{"first frame no prompt", "2-5", `{"content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,YQ=="}}]}`, ""},
				{"first last frames", "2-5", `{"content":[{"type":"image_url","role":"first_frame","image_url":{"url":"asset://sa_first"}},{"type":"image_url","role":"last_frame","image_url":{"url":"asset://sa_last"}}]}`, ""},
				{"audio base64", "2-5", `{"content":[{"type":"audio_url","audio_url":{"url":"data:audio/wav;base64,YQ=="}}]}`, ""},
				{"legacy default", "2-0", `{}`, ""},
				{"legacy auto and last frame", "2-0", `{"duration":-1,"return_last_frame":true,"resolution":"4k"}`, ""},
				{"fast automatic", "2-0-fast", `{"duration":-1}`, ""},
				{"mini automatic", "2-0-mini", `{"duration":-1}`, ""},
				{"invalid task enum", "2-5", `{"omni_reference_task_type":"remix"}`, "unsupported omni_reference_task_type"},
				{"null task enum", "2-5", `{"omni_reference_task_type":null}`, "unsupported omni_reference_task_type"},
				{"edit fixed duration", "2-5", `{"omni_reference_task_type":"edit","duration":5}`, "edit requires automatic duration"},
				{"edit fixed ratio", "2-5", `{"omni_reference_task_type":"edit","ratio":"16:9"}`, "edit requires adaptive ratio"},
				{"extend fixed ratio", "2-5", `{"omni_reference_task_type":"extend","ratio":"16:9"}`, "extend requires adaptive ratio"},
				{"edit image only", "2-5", `{"omni_reference_task_type":"edit","content":[{"type":"image_url","role":"reference_image","image_url":{"url":"asset://sa_image"}}]}`, "requires reference video"},
				{"extend audio only", "2-5", `{"omni_reference_task_type":"extend","content":[{"type":"audio_url","audio_url":{"url":"asset://sa_audio"}}]}`, "requires reference video"},
				{"omni text only", "2-5", `{"omni_reference_task_type":"reference","content":[{"type":"text","text":"cat"}]}`, "requires reference media"},
				{"legacy task enum", "2-0", `{"omni_reference_task_type":"auto"}`, "unsupported video field"},
				{"legacy output format", "2-0", `{"output_format":"mov"}`, "unsupported video field"},
				{"legacy audio only", "2-0", `{"content":[{"type":"audio_url","audio_url":{"url":"asset://sa_audio"}}]}`, "audio requires a reference image or video"},
				{"fast resolution", "2-0-fast", `{"resolution":"1080p"}`, "unsupported resolution"},
				{"mini resolution", "2-0-mini", `{"resolution":"4k"}`, "unsupported resolution"},
				{"2.5 resolution", "2-5", `{"resolution":"4k"}`, "unsupported resolution"},
				{"unknown field", "2-5", `{"n":2}`, "unsupported video field"},
				{"private normalization flag is not public", "2-5", `{"automaticDuration":true}`, "unsupported video field"},
				{"nested billing bypass", "2-5", `{"metadata":{"duration":1000000}}`, "unsupported video field"},
				{"legacy frame multiplier", "2-5", `{"frames":1000000}`, "unsupported video field"},
				{"unsupported format", "2-5", `{"output_format":"webm"}`, "unsupported output_format"},
				{"string flag", "2-5", `{"return_last_frame":"true"}`, "must be boolean"},
				{"null flag", "2-5", `{"generate_audio":null}`, "must be boolean"},
				{"invalid ratio", "2-5", `{"ratio":"3:2"}`, "unsupported ratio"},
				{"null duration", "2-5", `{"duration":null}`, "duration is outside"},
				{"string duration", "2-5", `{"duration":"-1"}`, "duration is outside"},
				{"zero duration", "2-5", `{"duration":0}`, "duration is outside"},
				{"negative duration", "2-5", `{"duration":-2}`, "duration is outside"},
				{"fractional duration", "2-5", `{"duration":4.5}`, "duration is outside"},
				{"oversized duration", "2-5", `{"duration":1000000000}`, "duration is outside"},
				{"2.5 upper duration", "2-5", `{"duration":31}`, "duration is outside"},
				{"legacy upper duration", "2-0", `{"duration":16}`, "duration is outside"},
				{"empty content", "2-5", `{"content":[]}`, "non-empty array"},
				{"null media", "2-5", `{"content":[null]}`, "must be objects"},
				{"empty text", "2-5", `{"content":[{"type":"text","text":" "}]}`, "must be non-empty"},
				{"prompt billing bypass", "2-5", `{"content":[{"type":"text","text":"cat --dur 99999"}]}`, "top-level video parameters"},
				{"unknown media", "2-5", `{"content":[{"type":"file","url":"https://media.example/file"}]}`, "unsupported content type"},
				{"missing URL", "2-5", `{"content":[{"type":"video_url","video_url":{}}]}`, "invalid native asset reference or media URL"},
				{"malformed asset", "2-5", `{"content":[{"type":"video_url","video_url":{"url":"asset://bad/id"}}]}`, "invalid native asset reference"},
				{"local path", "2-5", `{"content":[{"type":"video_url","video_url":{"url":"file:///tmp/a.mp4"}}]}`, "invalid native asset reference or media URL"},
				{"video base64", "2-5", `{"content":[{"type":"video_url","video_url":{"url":"data:video/mp4;base64,YQ=="}}]}`, "invalid native asset reference or media URL"},
				{"wrong role", "2-5", `{"content":[{"type":"video_url","role":"first_frame","video_url":{"url":"asset://sa_video"}}]}`, "invalid role"},
				{"unknown nested field", "2-5", `{"content":[{"type":"video_url","video_url":{"url":"asset://sa_video","duration":1000}}]}`, "unsupported media URL field"},
				{"last frame without first", "2-5", `{"content":[{"type":"image_url","role":"last_frame","image_url":{"url":"asset://sa_image"}}]}`, "one first frame"},
				{"implicit duplicate first frames", "2-5", `{"content":[{"type":"image_url","image_url":{"url":"asset://sa_one"}},{"type":"image_url","image_url":{"url":"asset://sa_two"}}]}`, "one first frame"},
				{"frame reference conflict", "2-5", `{"content":[{"type":"image_url","role":"first_frame","image_url":{"url":"asset://sa_image"}},{"type":"video_url","video_url":{"url":"asset://sa_video"}}]}`, "cannot be mixed"},
				{"2.5 first frame fixed ratio", "2-5", `{"ratio":"16:9","content":[{"type":"image_url","image_url":{"url":"asset://sa_image"}}]}`, "require adaptive ratio"},
				{"legacy first frame fixed ratio", "2-0", `{"ratio":"16:9","content":[{"type":"image_url","image_url":{"url":"asset://sa_image"}}]}`, ""},
			} {
				t.Run(tc.name, func(t *testing.T) {
					body := map[string]any{"model": "doubao-seedance-" + tc.version + "-" + provider, "content": []any{map[string]any{"type": "video_url", "role": "reference_video", "video_url": map[string]any{"url": "asset://sa_source"}}}}
					var fields map[string]any
					require.NoError(t, common.UnmarshalJsonStr(tc.body, &fields))
					maps.Copy(body, fields)
					value, err := plugin.Engine.CallMember(t.Context(), "native", "createTask", map[string]any{"body": map[string]any{"kind": "json", "value": body}})
					if tc.failure != "" {
						require.ErrorContains(t, err, tc.failure)
						// The host can apply channel overrides after native decoding.
						// Both billing and transport must reject the same invalid body.
						ctx := map[string]any{"model": body["model"], "requestBody": map[string]any{"metadata": body}, "baseUrl": "https://provider.example", "apiKey": "fixture-key"}
						for _, hook := range []string{"extractUsage", "buildSubmitRequest"} {
							_, err = plugin.Engine.Call(t.Context(), hook, ctx)
							require.ErrorContains(t, err, tc.failure, hook)
						}
						return
					}
					require.NoError(t, err)
					intent := seedanceResult(t, value)
					assert.Equal(t, body["model"], intent["model"])
					if _, explicit := body["duration"]; !explicit {
						wantDuration := 5.0
						if tc.version == "2-5" {
							wantDuration = -1
						}
						normalized := intent["requestBody"].(map[string]any)
						if wantDuration == -1 {
							assert.Equal(t, true, normalized["automaticDuration"])
							assert.NotContains(t, normalized["metadata"], "duration")
						} else {
							assert.Equal(t, wantDuration, normalized["metadata"].(map[string]any)["duration"])
						}
					}
					ctx := map[string]any{"model": body["model"], "requestBody": intent["requestBody"]}
					value, err = plugin.Engine.Call(t.Context(), "extractUsage", ctx)
					require.NoError(t, err)
					facts := seedanceResult(t, value)
					assert.Greater(t, facts["tokens"].(float64), 0.0)
					assert.Less(t, facts["tokens"].(float64), float64(2147483647))
					adaptor := taskplugin.New(plugin)
					info := &relaycommon.RelayInfo{
						OriginModelName: body["model"].(string),
						ChannelMeta:     &relaycommon.ChannelMeta{ChannelBaseUrl: "https://provider.example", ApiKey: "fixture-key"},
						TaskRelayInfo:   &relaycommon.TaskRelayInfo{Action: intent["action"].(string)},
					}
					adaptor.Init(info)
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					c.Request = httptest.NewRequest(http.MethodPost, "/"+key+"/api/v3/contents/generations/tasks", nil)
					c.Set("task_request", intent["requestBody"])
					require.Nil(t, adaptor.ValidateRequestAndSetAction(c, info))
					actualFacts, err := adaptor.ExtractUsageFactsValidated(c, info)
					require.NoError(t, err)
					assert.Equal(t, facts, actualFacts)
					wire, err := adaptor.BuildRequestBody(c, info)
					require.NoError(t, err)
					var upstream map[string]any
					require.NoError(t, common.DecodeJson(wire, &upstream))
					wantDuration := body["duration"]
					if wantDuration == nil {
						wantDuration = 5.0
						if tc.version == "2-5" {
							wantDuration = -1.0
						}
					}
					assert.Equal(t, wantDuration, upstream["duration"])
					assert.NotContains(t, upstream, "automaticDuration")
				})
			}

			for _, version := range []string{"2-0", "2-5"} {
				for _, media := range []struct {
					kind, role     string
					oldMax, newMax int
				}{{"image_url", "reference_image", 9, 30}, {"video_url", "reference_video", 3, 10}, {"audio_url", "reference_audio", 3, 10}} {
					limit := media.oldMax
					if version == "2-5" {
						limit = media.newMax
					}
					for _, count := range []int{limit, limit + 1} {
						content := make([]any, 0, count+1)
						for range count {
							content = append(content, map[string]any{"type": media.kind, "role": media.role, media.kind: map[string]any{"url": "asset://sa_reference"}})
						}
						if media.kind == "audio_url" && version == "2-0" {
							content = append(content, map[string]any{"type": "video_url", "video_url": map[string]any{"url": "asset://sa_video"}})
						}
						_, err := plugin.Engine.CallMember(t.Context(), "native", "createTask", map[string]any{"body": map[string]any{"kind": "json", "value": map[string]any{"model": "doubao-seedance-" + version + "-" + provider, "content": content}}})
						if count == limit {
							require.NoError(t, err, "%s %s", version, media.kind)
						} else {
							require.ErrorContains(t, err, "too many reference media")
						}
					}
				}
			}

			t.Run("automatic reservation settles measured tokens in task dollars", func(t *testing.T) {
				ctx := map[string]any{"model": "doubao-seedance-2-5-" + provider, "requestBody": map[string]any{"metadata": map[string]any{"duration": -1, "content": []any{map[string]any{"type": "text", "text": "cat"}}}}}
				value, err := plugin.Engine.Call(t.Context(), "extractUsage", ctx)
				require.NoError(t, err)
				facts := seedanceResult(t, value)
				assert.Equal(t, 652084.0, facts["tokens"])
				expression := `tier("video", u("tokens") * 2 / 1000000)`
				snapshot := &billingexpr.BillingSnapshot{ExprString: expression, ExprHash: billingexpr.ExprHashString(expression), GroupRatio: 1, QuotaPerUnit: 500000, ExprVersion: 1, TaskUsageBilling: true}
				reserved, err := billingexpr.ComputeTieredQuotaWithRequest(snapshot, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: facts})
				require.NoError(t, err)
				assert.Equal(t, 652084, reserved.ActualQuotaAfterGroup)
				value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{}, map[string]any{"status": "SUCCESS"}, map[string]any{"duration": 7, "usage": map[string]any{"completion_tokens": 151200}})
				require.NoError(t, err)
				maps.Copy(facts, seedanceResult(t, value))
				cost, _, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: facts})
				require.NoError(t, err)
				assert.InDelta(t, 0.3024, cost, 1e-10)
				settled, err := billingexpr.ComputeTieredQuotaWithRequest(snapshot, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: facts})
				require.NoError(t, err)
				assert.Equal(t, 151200, settled.ActualQuotaAfterGroup)
				assert.Equal(t, 500884, reserved.ActualQuotaAfterGroup-settled.ActualQuotaAfterGroup)
			})
		})
	}
}

func seedanceResult(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, common.Unmarshal(encoded, &result))
	return result
}

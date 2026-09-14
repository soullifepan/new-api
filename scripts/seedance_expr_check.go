//go:build ignore

package main

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"math"
	"os"
)

func main() {
	var expressions map[string]string
	if err := common.DecodeJson(os.Stdin, &expressions); err != nil {
		panic(err)
	}
	for model, expression := range expressions {
		for _, check := range []struct {
			phase, action string
			want          float64
		}{
			{"actual", "generation", 0.3104}, {"actual", "asset", 0},
		} {
			cost, _, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: map[string]any{
				"billing_phase": check.phase, "action": check.action, "upstream_credits": 3.104,
				"seconds": 30.0, "input_seconds": 30.0, "resolution": "720p", "video_input": "video",
			}})
			if err != nil || math.Abs(cost-check.want) > 1e-9 {
				panic(fmt.Sprintf("%s: cost=%v err=%v", model, cost, err))
			}
		}
	}
	fmt.Printf("Host billing engine: %d models actual-cost replacement and free assets passed\n", len(expressions))
}

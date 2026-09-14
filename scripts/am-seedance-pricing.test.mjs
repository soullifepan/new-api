import { strict as assert } from "node:assert";
import { test } from "node:test";
import { seedanceBilling, seedancePrices } from "./am-seedance-pricing.mjs";

test("Seedance estimates use seconds, actual settlement replaces rather than adds", () => {
  for (const [model, prices] of Object.entries(seedancePrices)) {
    const evaluate = new Function("u", "tier", `return (${seedanceBilling[model]})`);
    for (const [resolution, [plain, input]] of Object.entries(prices)) {
      const facts = { action: "generation", billing_phase: "estimate", resolution, video_input: "none", seconds: 5, input_seconds: 0, upstream_credits: 0 };
      const run = () => evaluate(key => facts[key], (_name, value) => value);
      assert.equal(run(), 5 * plain);
      Object.assign(facts, { video_input: "video", input_seconds: 10 });
      assert.ok(Math.abs(run() - 15 * input) < 1e-10);
      Object.assign(facts, { billing_phase: "actual", upstream_credits: 3.104 });
      assert.ok(Math.abs(run() - 0.3104) < 1e-10);
      facts.upstream_credits = 0;
      assert.equal(run(), 0);
      Object.assign(facts, { action: "asset", upstream_credits: 100 });
      assert.equal(run(), 0);
    }
  }
});

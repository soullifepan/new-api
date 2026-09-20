import { strict as assert } from "node:assert";
import { test } from "node:test";
import { seedanceBilling, seedancePrices } from "./am-seedance-pricing.mjs";

test("Seedance pricing converts the plugin-provided upstream credits once", () => {
  for (const model of Object.keys(seedancePrices)) {
    const evaluate = new Function("u", "tier", `return (${seedanceBilling[model]})`);
    const facts = { upstream_credits: 3.104 };
    assert.ok(Math.abs(evaluate(key => facts[key], (_name, value) => value) - 0.3104) < 1e-10);
    facts.upstream_credits = 0;
    assert.equal(evaluate(key => facts[key], (_name, value) => value), 0);
  }
});

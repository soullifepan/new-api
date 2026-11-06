// Configuration draft only: never connects to a database or activates a model.
// EXT temporarily uses standard 1.2 reference reservation by user decision.
export const omni12Models = {
  "gemini-omni-1.2-flash-am": "gemini-omni-1.2-flash",
  "gemini-omni-1.2-flash-ext-am": "gemini-omni-1.2-flash-ext",
};
export const omni12PriceEvidence = {
  verifiedAt: "2026-11-06",
  source: "https://apimart.ai/model/gemini-omni-1-2-flash",
  tier: "Gold",
  usdPerCredit: 0.1,
  standardTokenUsdPerMillion: { input: 1.2, output: 9.6 },
  standardReservationCreditsPerSecond: { "360p": 0.2, "720p": 0.6, "1080p": 0.904, "4k": 1.808 },
  extReservationReference: {
    sourceModel: "gemini-omni-1.2-flash",
    temporary: true,
    officialExtPrice: false,
    creditsPerSecond: { "360p": 0.2, "720p": 0.6, "1080p": 0.904, "4k": 1.808 },
    secondsRule: "video_urls or extend_from_task_id: 15; otherwise max(10, duration)",
    settlement: "validated actual EXT data.cost in USD converted to upstream_credits",
  },
};
// Matches the existing Omni 1.1 effective expression; final data.cost in USD
// is validated and converted to credits exactly once by the plugin.
export const omni12Billing = Object.fromEntries(Object.keys(omni12Models).map(model => [model, 'tier("upstream_actual", u("upstream_credits") * 0.1)']));
export const omni12Configuration = {
  pluginKey: "am-video",
  pluginVersion: "0.5.17",
  releaseReady: true,
  blockers: [],
  pricingNote: "EXT temporarily reserves using standard 1.2 reference rates and rules by user decision; these are not official EXT prices; replace when EXT rates are published",
  priceEvidence: omni12PriceEvidence,
  modelMapping: omni12Models,
  modelTags: Object.fromEntries(Object.keys(omni12Models).map(model => [model, ["video"]])),
  billingMode: Object.fromEntries(Object.keys(omni12Models).map(model => [model, "tiered_expr"])),
  billingExpr: omni12Billing,
  // Do not overwrite existing overrides. This is the matching candidate value
  // if the deployment review finds that a provider override is needed.
  pluginBillingExpr: Object.fromEntries(Object.entries(omni12Billing).map(([model, expr]) => ["am-video::" + model, expr])),
};
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(omni12Configuration, null, 2));

// User-approved USD prices. Emit configuration only; never connects to a DB.
export const seedancePrices = {
  "seedance-2.0-am": { "480p": [0.066, 0.04], "720p": [0.142, 0.08584], "1080p": [0.3544, 0.21568], "4k": [0.722, 0.44432] },
  "seedance-2.0-fast-am": { "480p": [0.03984, 0.02368], "720p": [0.0856, 0.05128] },
  "seedance-2.0-mini-am": { "480p": [0.01056, 0.0064], "720p": [0.02288, 0.01384] },
  "seedance-2.5-am": { "480p": [0.09608, 0.0576], "720p": [0.216, 0.1296], "1080p": [0.38488, 0.22992] },
};

// Reconciliation reference only: final cost already includes this token charge.
export const seedance25TokenPrices = { "480p": [10, 6], "720p": [10, 6], "1080p": [7.92, 4.73144] };

export function seedanceExpression(prices) {
  const branches = [];
  for (const [resolution, [plain, input]] of Object.entries(prices)) {
    branches.push(`u("resolution") == "${resolution}" && u("video_input") == "video" ? tier("estimate_${resolution}_input", u("seconds") * ${input} + u("input_seconds") * ${input})`);
    branches.push(`u("resolution") == "${resolution}" ? tier("estimate_${resolution}", u("seconds") * ${plain})`);
  }
  return `u("action") == "asset" ? tier("asset", 0) : u("billing_phase") == "actual" ? tier("actual", u("upstream_credits") * 0.1) : ${branches.join(" : ")} : tier("invalid", 0)`;
}

export const seedanceBilling = Object.fromEntries(Object.entries(seedancePrices).map(([model, prices]) => [model, seedanceExpression(prices)]));
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(seedanceBilling, null, 2));

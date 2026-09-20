// User-approved USD prices. Emit configuration only; never connects to a DB.
export const seedancePrices = {
  "seedance-2.0-am": { "480p": [0.066, 0.04], "720p": [0.142, 0.08584], "1080p": [0.3544, 0.21568], "4k": [0.722, 0.44432] },
  "seedance-2.0-fast-am": { "480p": [0.03984, 0.02368], "720p": [0.0856, 0.05128] },
  "seedance-2.0-mini-am": { "480p": [0.01056, 0.0064], "720p": [0.02288, 0.01384] },
  "seedance-2.5-am": { "480p": [0.09608, 0.0576], "720p": [0.216, 0.1296], "1080p": [0.38488, 0.22992] },
};

// Reconciliation reference only: final cost already includes this token charge.
export const seedance25TokenPrices = { "480p": [10, 6], "720p": [10, 6], "1080p": [7.92, 4.73144] };

export function seedanceExpression() {
  return 'tier("upstream_credits", u("upstream_credits") * 0.1)';
}

export const seedanceBilling = Object.fromEntries(Object.keys(seedancePrices).map(model => [model, seedanceExpression()]));
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(seedanceBilling, null, 2));

// User-approved USD prices; reference token rates are not a second charge.
export const gpt25TokenPrices = { text: 4, cached_text: 1, image: 6.4, cached_image: 1.6, output: 24 };
export const gpt25ExtPrices = { "1k": 0.0085, "2k": 0.014, "4k": 0.021 };
const branches = [];
for (const version of ["flare", "sunburst"]) {
  for (const [resolution, price] of Object.entries(gpt25ExtPrices)) {
    branches.push({ condition: `u("version") == "${version}" && u("resolution") == "${resolution}"`, leaf: `tier("${version}_${resolution}", u("images") * ${price})` });
  }
}
export const gpt25Billing = {
  "gpt-image-2.5-ext-am": branches.map((branch, index) => index === branches.length - 1 ? branch.leaf : `${branch.condition} ? ${branch.leaf}`).join(" : "),
  "gpt-image-2.5-flare-am": 'tier("actual_cost", u("upstream_credits") * 0.1)',
  "gpt-image-2.5-sunburst-am": 'tier("actual_cost", u("upstream_credits") * 0.1)',
};

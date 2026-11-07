// APIMart image-task integration. Keep this outside plugins/tasks: it is a
// local, uploadable extension rather than an embedded upstream plugin.
const nanoBananaModels = new Map([
  ["nano-banana-am", { upstream: "gemini-2.5-flash-image-preview-official", resolutions: ["1k"], maxImages: 1, credits: { "1k": 0.312 } }],
  ["nano-banana-2-am", { upstream: "gemini-3.1-flash-image-preview-official", resolutions: ["0.5k", "1k", "2k", "4k"], maxImages: 1, credits: { "0.5k": 0.536, "1k": 0.536, "2k": 0.808, "4k": 1.208 } }],
  ["nano-banana-pro-am", { upstream: "gemini-3-pro-image-preview-official", resolutions: ["1k", "2k", "4k"], maxImages: 1, credits: { "1k": 1.072, "2k": 1.072, "4k": 1.92 } }],
  ["nano-banana-2-lite-am", { upstream: "gemini-3.1-flash-lite-image", resolutions: ["1k"], maxImages: 4, credits: { "1k": 0.32 } }],
  ["nano-banana-2-1-am", { upstream: "gemini-nano-banana-2.1", resolutions: ["1k", "2k", "4k"], maxImages: 4, credits: { "1k": 0.2688, "2k": 0.4032, "4k": 0.9072 } }],
  ["nano-banana-2-1-ext-am", { upstream: "gemini-nano-banana-2.1-ext", resolutions: ["1k", "2k", "4k"], maxImages: 1 }],
  ["nano-banana-ext-am", { upstream: "gemini-2.5-flash-image-preview", resolutions: ["1k"], maxImages: 1 }],
  ["nano-banana-2-ext-am", { upstream: "gemini-3.1-flash-image-preview", resolutions: ["0.5k", "1k", "2k", "4k"], maxImages: 1 }],
  ["nano-banana-pro-ext-am", { upstream: "gemini-3-pro-image-preview", resolutions: ["1k", "2k", "4k"], maxImages: 1 }],
  ["nano-banana-2-lite-ext-am", { upstream: "gemini-3.1-flash-lite-image-ext", resolutions: ["1k"], maxImages: 4 }],
]);
const nanoBananaRatios = new Set(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
const nanoBanana2Ratios = new Set([...nanoBananaRatios, "1:4", "4:1", "1:8", "8:1"]);
const nanoBananaFields = new Set(["model", "prompt", "size", "resolution", "n", "image_urls", "nsfw_check", "official_fallback", "google_search", "google_image_search"]);
const gpt25Models = new Map([
  ["gpt-image-2.5-ext-am", "gpt-image-2.5-ext"],
  ["gpt-image-2.5-flare-am", "gpt-image-2.5-flare"],
  ["gpt-image-2.5-sunburst-am", "gpt-image-2.5-sunburst"],
]);
const gpt25Ext = "gpt-image-2.5-ext-am";
// APIMart's per-image output token reference, ordered low/medium/high/xhigh/max:
// https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation
// Portrait sizes share the landscape budget. Keep pixels for exact-size requests,
// where the provider ignores resolution; do not extrapolate from image area.
const gpt25OutputSpecs = {
  "1k": {
    "1:1": { pixels: "1024x1024", tokens: [196, 439, 1756, 3122, 7024] },
    "3:2": { pixels: "1536x1024", tokens: [158, 343, 1372, 2459, 5488] },
    "4:3": { pixels: "1024x768", tokens: [134, 301, 1204, 2140, 4815] },
    "5:4": { pixels: "1280x1024", tokens: [173, 378, 1510, 2702, 6119] },
    "16:9": { pixels: "1536x864", tokens: [120, 280, 1078, 1917, 4312] },
    "2:1": { pixels: "2048x1024", tokens: [132, 295, 1180, 2098, 4720] },
    "21:9": { pixels: "2016x864", tokens: [105, 225, 943, 1617, 3682] },
    "3:1": { pixels: "1536x512", tokens: [56, 134, 535, 937, 2140] },
  },
  "2k": {
    "1:1": { pixels: "2048x2048", tokens: [397, 892, 3568, 6343, 14272] },
    "3:2": { pixels: "2048x1360", tokens: [211, 460, 1838, 3216, 7351] },
    "4:3": { pixels: "2048x1536", tokens: [247, 556, 2223, 3952, 8892] },
    "5:4": { pixels: "2560x2048", tokens: [377, 826, 3303, 5911, 13385] },
    "16:9": { pixels: "2048x1152", tokens: [157, 367, 1413, 2511, 5650] },
    "2:1": { pixels: "2688x1344", tokens: [180, 405, 1617, 2874, 6466] },
    "21:9": { pixels: "2688x1152", tokens: [143, 306, 1285, 2202, 5016] },
    "3:1": { pixels: "3072x1024", tokens: [103, 247, 988, 1729, 3952] },
  },
  "4k": {
    "1:1": { pixels: "2880x2880", tokens: [659, 1483, 5930, 10542, 23719] },
    "3:2": { pixels: "3520x2336", tokens: [450, 982, 3926, 6870, 15703] },
    "4:3": { pixels: "3312x2480", tokens: [491, 1104, 4413, 7845, 17650] },
    "5:4": { pixels: "3216x2576", tokens: [535, 1173, 4690, 8393, 19006] },
    "16:9": { pixels: "3840x2160", tokens: [371, 865, 3336, 5930, 13342] },
    "2:1": { pixels: "3840x1920", tokens: [300, 675, 2700, 4799, 10798] },
    "21:9": { pixels: "3840x1648", tokens: [234, 500, 2099, 3598, 8196] },
    "3:1": { pixels: "3840x1280", tokens: [139, 332, 1328, 2324, 5311] },
  },
};
// Documented 1:1 output tokens. These display examples exclude all input costs;
// they are not the reservation calculation or a fixed per-image billing contract.
const gpt25OutputExamples = Object.entries(gpt25OutputSpecs).flatMap(([resolution, specs]) => specs["1:1"].tokens.map((count, index) => ({
  label: "1:1 · " + resolution.toUpperCase() + " · " + ["low", "medium", "high", "xhigh", "max"][index] + " · 1张仅输出预估",
  facts: { upstream_credits: count * 24 / 100000 },
})));

// GPT Image 2.6 is an APIMart preview, not a live-service guarantee.
// Separate 2026-11-04 vendor snapshot: both official Flare/Sunburst model pages
// https://apimart.ai/model/gpt-image-2-6-{flare,sunburst}
// publish these tokens and the same effective credit rates. Never use 2.5's
// low/medium budgets. Protocol validation supports the complete documented
// request; estimates are replaced by validated actual task cost at completion.
const gpt26Models = new Map([
  ["gpt-image-2.6-flare-am", "gpt-image-2.6-flare"],
  ["gpt-image-2.6-sunburst-am", "gpt-image-2.6-sunburst"],
]);
// Ext is a per-image contract, independent of the ordinary GPT26 token tables.
// 2026-11-07 https://apimart.ai/zh/model/gpt-image-2-6 RSC pricing snapshot:
// version_resolution_paid_prices, Gold (8000 bps). The user approved Gold
// reservation estimates and settlement to actual USD cost; do not discount twice.
const gpt26Ext = "gpt-image-2.6-ext-am";
const gpt26ExtPrices = {
  flare: { "1k": 0.0085, "2k": 0.03, "4k": 0.04 },
  sunburst: { "1k": 0.0085, "2k": 0.03, "4k": 0.04 },
};
const gpt26ExtExamples = Object.entries(gpt26ExtPrices).flatMap(([version, prices]) => Object.entries(prices).map(([resolution, price]) => ({
  label: version + " · " + resolution.toUpperCase() + " · Gold estimate / 预扣估算",
  facts: { upstream_credits: price * 10, version, resolution },
})));
const gpt26TokenLimit = 1000000;
const gpt26OutputTokens = {
  "16:9": [504, 924, 1078, 1917, 4312],
  "16:9@2k": [660, 1212, 1413, 2511, 5650],
  "16:9@4k": [1559, 2855, 3336, 5930, 13342],
  "1:1": [824, 1449, 1756, 3122, 7024],
  "1:1@2k": [1668, 2944, 3568, 6343, 14272],
  "1:1@4k": [2768, 4894, 5930, 10542, 23719],
  "1:2": [555, 974, 1180, 2098, 4720],
  "1:2@2k": [756, 1337, 1617, 2874, 6466],
  "1:2@4k": [1260, 2228, 2700, 4799, 10798],
  "1:3": [236, 443, 535, 937, 2140],
  "1:3@2k": [433, 816, 988, 1729, 3952],
  "1:3@4k": [584, 1096, 1328, 2324, 5311],
  "21:9": [441, 743, 943, 1617, 3682],
  "21:9@2k": [601, 1010, 1285, 2202, 5016],
  "21:9@4k": [983, 1650, 2099, 3598, 8196],
  "2:1": [555, 974, 1180, 2098, 4720],
  "2:1@2k": [756, 1337, 1617, 2874, 6466],
  "2:1@4k": [1260, 2228, 2700, 4799, 10798],
  "2:3": [664, 1132, 1372, 2459, 5488],
  "2:3@2k": [887, 1518, 1838, 3216, 7351],
  "2:3@4k": [1890, 3241, 3926, 6870, 15703],
  "3:1": [236, 443, 535, 937, 2140],
  "3:1@2k": [433, 816, 988, 1729, 3952],
  "3:1@4k": [584, 1096, 1328, 2324, 5311],
  "3:2": [664, 1132, 1372, 2459, 5488],
  "3:2@2k": [887, 1518, 1838, 3216, 7351],
  "3:2@4k": [1890, 3241, 3926, 6870, 15703],
  "3:4": [563, 994, 1204, 2140, 4815],
  "3:4@2k": [1038, 1835, 2223, 3952, 8892],
  "3:4@4k": [2063, 3644, 4413, 7845, 17650],
  "4:3": [563, 994, 1204, 2140, 4815],
  "4:3@2k": [1038, 1835, 2223, 3952, 8892],
  "4:3@4k": [2063, 3644, 4413, 7845, 17650],
  "4:5": [727, 1248, 1510, 2702, 6119],
  "4:5@2k": [1584, 2726, 3303, 5911, 13385],
  "4:5@4k": [2247, 3871, 4690, 8393, 19006],
  "5:4": [727, 1248, 1510, 2702, 6119],
  "5:4@2k": [1584, 2726, 3303, 5911, 13385],
  "5:4@4k": [2247, 3871, 4690, 8393, 19006],
  "9:16": [504, 924, 1078, 1917, 4312],
  "9:16@2k": [660, 1212, 1413, 2511, 5650],
  "9:16@4k": [1559, 2855, 3336, 5930, 13342],
  "9:21": [441, 743, 943, 1617, 3682],
  "9:21@2k": [601, 1010, 1285, 2202, 5016],
  "9:21@4k": [983, 1650, 2099, 3598, 8196]
};
const gpt26OutputExamples = ["1k", "2k", "4k"].flatMap(resolution => ["low", "medium", "high", "xhigh", "max"].map((quality, index) => ({
  label: "1:1 " + resolution.toUpperCase() + " " + quality + " · ref output estimate / 仅参考图输出预估",
  facts: { upstream_credits: gpt26OutputTokens["1:1" + (resolution === "1k" ? "" : "@" + resolution)][index] * 240 / 1000000 },
})));
// The host accepts at most 16 examples per profile. Keep all 15 static/SVG
// reference quality/resolution entries and one representative GIF output sample.
// SVG authoring text and all inputs are excluded from these display-only prices.
gpt26OutputExamples.push({
  label: "GIF 9×512² low · output estimate / 仅输出预估",
  facts: { upstream_credits: 1172 * 240 / 1000000 },
});

export const meta = {
  apiVersion: 1,
  key: "am-image",
  name: "AM Image",
  icon: "text:AP",
  description: {
    en: "AM asynchronous image generation tasks",
    zh: "AM 异步图片生成任务",
  },
  version: "0.13.0",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  usageProfiles: (function () {
    const schemas = {
    "gpt-image-2.6-ext-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Image generation credit unit price", zh: "图片生成积分单价" } },
      resolution: { enum: ["1k", "2k", "4k"], description: { en: "Output resolution", zh: "输出分辨率" } },
      version: { enum: ["flare", "sunburst"], description: { en: "Model version", zh: "模型版本" } },
    },
    "gpt-image-2.6-flare-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Image generation credit unit price", zh: "图片生成积分单价" } },
    },
    "gpt-image-2.6-sunburst-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Image generation credit unit price", zh: "图片生成积分单价" } },
    },
    "gpt-image-2.5-ext-am": {
      images: { type: "number", unit: "count", unitLabel: { en: "image", zh: "张" }, description: { en: "Image generation unit price", zh: "图片生成单价" } },
      resolution: { enum: ["1k", "2k", "4k"], description: { en: "Output resolution", zh: "输出分辨率" } },
      version: { enum: ["flare", "sunburst"], description: { en: "Model version", zh: "模型版本" } },
    },
    "gpt-image-2.5-flare-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Image generation credit unit price", zh: "图片生成积分单价" } },
    },
    "gpt-image-2.5-sunburst-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Image generation credit unit price", zh: "图片生成积分单价" } },
    },
    "nano-banana-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Estimated credits at submission, replaced by validated actual task deduction at completion.", zh: "提交时预扣估算积分，完成后按已校验的任务实际扣费多退少补。" } },
    },
    "nano-banana-2-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Estimated credits at submission, replaced by validated actual task deduction at completion.", zh: "提交时预扣估算积分，完成后按已校验的任务实际扣费多退少补。" } },
    },
    "nano-banana-pro-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Estimated credits at submission, replaced by validated actual task deduction at completion.", zh: "提交时预扣估算积分，完成后按已校验的任务实际扣费多退少补。" } },
    },
    "nano-banana-2-lite-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Estimated credits at submission, replaced by validated actual task deduction at completion.", zh: "提交时预扣估算积分，完成后按已校验的任务实际扣费多退少补。" } },
    },
    "nano-banana-2-1-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Image generation credit unit price", zh: "图片生成积分单价" } },
    },
    "nano-banana-2-1-ext-am": {
      images: { type: "number", unit: "count", unitLabel: { en: "image", zh: "张" }, description: { en: "Image generation unit price", zh: "图片生成单价" } },
      resolution: { enum: ["1k", "2k", "4k"], description: { en: "Output resolution", zh: "输出分辨率" } },
    },
    "nano-banana-ext-am": {
      images: { type: "number", unit: "count", description: { en: "Requested images, replaced by successful output count at completion.", zh: "提交时请求张数，完成后按实际成功张数结算。" } },
      resolution: { enum: ["1k"], description: { en: "Validated output resolution tier.", zh: "已校验的输出分辨率档位。" } },
    },
    "nano-banana-2-ext-am": {
      images: { type: "number", unit: "count", description: { en: "Requested images, replaced by successful output count at completion.", zh: "提交时请求张数，完成后按实际成功张数结算。" } },
      resolution: { enum: ["0.5k", "1k", "2k", "4k"], description: { en: "Validated output resolution tier.", zh: "已校验的输出分辨率档位。" } },
    },
    "nano-banana-pro-ext-am": {
      images: { type: "number", unit: "count", description: { en: "Requested images, replaced by successful output count at completion.", zh: "提交时请求张数，完成后按实际成功张数结算。" } },
      resolution: { enum: ["1k", "2k", "4k"], description: { en: "Validated output resolution tier.", zh: "已校验的输出分辨率档位。" } },
    },
    "nano-banana-2-lite-ext-am": {
      images: { type: "number", unit: "count", description: { en: "Requested images, replaced by successful output count at completion.", zh: "提交时请求张数，完成后按实际成功张数结算。" } },
      resolution: { enum: ["1k"], description: { en: "Lite always outputs and bills at 1K.", zh: "Lite 始终按 1K 输出和计费。" } },
    },
    "gpt-image-2-am": {
      images: { type: "number", unit: "count", description: { en: "Number of successfully generated images.", zh: "成功生成图片的数量。" } },
      resolution: { enum: ["default", "1k", "2k", "4k"], description: { en: "Requested output resolution tier.", zh: "请求的输出分辨率档位。" } },
      input_images: { type: "number", unit: "count", description: { en: "Number of input reference and mask images.", zh: "输入参考图和遮罩图数量。" } },
    },
    "gpt-image-2-official-am": {
      upstream_credits: { type: "number", unit: "credit", description: { en: "Estimated at submission and replaced by AM's completed task deduction.", zh: "提交时预估，任务完成后由 AM 实际扣减积分覆盖。" } },
    },
    "seedream-5-0-lite-am": {
      images: { type: "number", unit: "count", description: { en: "Validated requested output count.", zh: "已校验的请求输出数量。" } },
      resolution: { enum: ["2k", "3k", "4k"], description: { en: "Requested output resolution tier.", zh: "请求的输出分辨率档位。" } },
      input_images: { type: "number", unit: "count", description: { en: "Validated reference image count.", zh: "已校验的参考图数量。" } },
    },
    "seedream-5-0-pro-am": {
      resolution: { enum: ["1k", "1.5k", "2k"], description: { en: "Validated output billing tier; layer 1.5K is billed at the 1K rate.", zh: "已校验的输出计费档位；图层 1.5K 按 1K 费率计费。" } },
      standard_images: { type: "number", unit: "count", description: { en: "Standard-mode output image count.", zh: "标准模式输出图片数量。" } },
      layer_images: { type: "number", unit: "count", description: { en: "Layer-decomposition output image count.", zh: "图层拆分输出图片数量。" } },
      reference_images: { type: "number", unit: "count", description: { en: "Total validated input reference image count.", zh: "已校验的输入参考图总数。" } },
    },
    "z-image-turbo-am": {
      images: { type: "number", unit: "count", description: { en: "Fixed requested output count.", zh: "固定的请求输出数量。" } },
      resolution: { enum: ["1k", "2k"], description: { en: "Requested output resolution tier.", zh: "请求的输出分辨率档位。" } },
      prompt_extend: { type: "boolean", description: { en: "Whether paid prompt rewriting was requested.", zh: "是否请求付费提示词改写。" } },
    },
    };
    const examples = {
    "gpt-image-2.6-ext-am": gpt26ExtExamples,
    "gpt-image-2.6-flare-am": gpt26OutputExamples,
    "gpt-image-2.6-sunburst-am": gpt26OutputExamples,
    "gpt-image-2.5-ext-am": ["flare", "sunburst"].flatMap(version => ["1k", "2k", "4k"].map(resolution => ({ label: version + " · " + resolution.toUpperCase(), facts: { images: 1, version, resolution } }))),
    "gpt-image-2.5-flare-am": gpt25OutputExamples,
    "gpt-image-2.5-sunburst-am": gpt25OutputExamples,
    "nano-banana-am": [{ label: "1K · 1 image (estimate)", facts: { upstream_credits: 0.312 } }],
    "nano-banana-2-am": [
      { label: "0.5K · 1 image (estimate)", facts: { upstream_credits: 0.536 } },
      { label: "1K · 1 image (estimate)", facts: { upstream_credits: 0.536 } },
      { label: "2K · 1 image (estimate)", facts: { upstream_credits: 0.808 } },
      { label: "4K · 1 image (estimate)", facts: { upstream_credits: 1.208 } },
    ],
    "nano-banana-pro-am": [
      { label: "1K · 1 image (estimate)", facts: { upstream_credits: 1.072 } },
      { label: "2K · 1 image (estimate)", facts: { upstream_credits: 1.072 } },
      { label: "4K · 1 image (estimate)", facts: { upstream_credits: 1.92 } },
    ],
    "nano-banana-2-lite-am": [{ label: "1K · 1 image (estimate)", facts: { upstream_credits: 0.32 } }, { label: "1K · 4 images (estimate)", facts: { upstream_credits: 1.28 } }],
    "nano-banana-2-1-am": [
      { label: "1K · 1 image (estimate)", facts: { upstream_credits: 0.2688 } },
      { label: "2K · 1 image (estimate)", facts: { upstream_credits: 0.4032 } },
      { label: "4K · 1 image (estimate)", facts: { upstream_credits: 0.9072 } },
      { label: "4K · 4 images (estimate)", facts: { upstream_credits: 3.6288 } },
    ],
    "nano-banana-2-1-ext-am": [
      { label: "1K · 1 image", facts: { images: 1, resolution: "1k" } },
      { label: "2K · 1 image", facts: { images: 1, resolution: "2k" } },
      { label: "4K · 1 image", facts: { images: 1, resolution: "4k" } },
    ],
    "nano-banana-ext-am": [{ label: "1K · 1 image", facts: { images: 1, resolution: "1k" } }],
    "nano-banana-2-ext-am": [
      { label: "0.5K · 1 image", facts: { images: 1, resolution: "0.5k" } },
      { label: "1K · 1 image", facts: { images: 1, resolution: "1k" } },
      { label: "2K · 1 image", facts: { images: 1, resolution: "2k" } },
      { label: "4K · 1 image", facts: { images: 1, resolution: "4k" } },
    ],
    "nano-banana-pro-ext-am": [
      { label: "1K · 1 image", facts: { images: 1, resolution: "1k" } },
      { label: "2K · 1 image", facts: { images: 1, resolution: "2k" } },
      { label: "4K · 1 image", facts: { images: 1, resolution: "4k" } },
    ],
    "nano-banana-2-lite-ext-am": [{ label: "1K · 1 image", facts: { images: 1, resolution: "1k" } }, { label: "1K · 4 images", facts: { images: 4, resolution: "1k" } }],
    "seedream-5-0-lite-am": [{ label: "2K · 1 image", facts: { images: 1, resolution: "2k", input_images: 0 } }],
    "seedream-5-0-pro-am": [{ label: "Standard · 1K", facts: { resolution: "1k", standard_images: 1, layer_images: 0, reference_images: 0 } }, { label: "Standard · 1.5K", facts: { resolution: "1.5k", standard_images: 1, layer_images: 0, reference_images: 0 } }, { label: "Standard · 2K", facts: { resolution: "2k", standard_images: 1, layer_images: 0, reference_images: 0 } }, { label: "Layer · 1K", facts: { resolution: "1k", standard_images: 0, layer_images: 17, reference_images: 1 } }, { label: "Layer · 1.5K", facts: { resolution: "1.5k", standard_images: 0, layer_images: 17, reference_images: 1 } }, { label: "Layer · 2K", facts: { resolution: "2k", standard_images: 0, layer_images: 17, reference_images: 1 } }],
    "z-image-turbo-am": [{ label: "1K · 1 image", facts: { images: 1, resolution: "1k", prompt_extend: false } }],
    };
    return Object.keys(schemas).map(function (model) {
      return { models: [model], schema: schemas[model], examples: examples[model] || [] };
    });
  }()),
  // api.apib.ai is the configured API entrypoint. APIMart-compatible image
  // results may still be served from the legacy upload/CDN hosts.
  allowedHosts: ["api.apib.ai", "upload.apimart.ai", "cdn.apimart.ai"],
  // Keep only explicit APIMart aliases here. Standard model names must remain
  // available to ordinary channels without being classified as task models.
  models: [
    ...gpt25Models.keys(),
    ...gpt26Models.keys(),
    gpt26Ext,
    "nano-banana-am",
    "nano-banana-2-am",
    "nano-banana-pro-am",
    "nano-banana-2-lite-am",
    "nano-banana-2-1-am",
    "nano-banana-2-1-ext-am",
    "nano-banana-ext-am",
    "nano-banana-2-ext-am",
    "nano-banana-pro-ext-am",
    "nano-banana-2-lite-ext-am",
    "gpt-image-2-am",
    "gpt-image-2-official-am",
    "seedream-5-0-lite-am",
    "seedream-5-0-pro-am",
    "z-image-turbo-am",
  ],
  routes: [
    { method: "POST", path: "/am/image/v1/images/generations", type: "submit", decode: "decodeImageGeneration", render: "renderSubmitted" },
    { method: "GET", path: "/am/image/v1/tasks/:task_id", type: "query", render: "renderTask" },
  ],
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value, errorMessage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorMessage);
  return value;
}

function isDeclaredModel(model) {
  return meta.models.includes(model);
}

function billingResolution(value) {
  const resolution = trimmed(value).toLowerCase();
  return ["1k", "2k", "4k"].includes(resolution) ? resolution : "default";
}

const gptImage2Sizes = new Set([
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
]);

function isSupportedGPTImage2Size(value) {
  const size = trimmed(value).toLowerCase();
  if (gptImage2Sizes.has(size)) return true;
  const match = /^(\d{1,4})x(\d{1,4})$/i.exec(size);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= 1 && width <= 3840 && height >= 1 && height <= 3840;
}

function isOfficialGPTImage2(model) {
  return ["gpt-image-2-official", "gpt-image-2-official-am"].includes(trimmed(model));
}

function officialQuality(value) {
  const quality = trimmed(value).toLowerCase();
  return quality === "medium" || quality === "high" ? quality : "low";
}

function inputImageCount(request) {
  const references = Array.isArray(request.image_urls) ? request.image_urls.length : 0;
  return references + (trimmed(request.mask_url) ? 1 : 0);
}

function estimateOfficialCredits(request) {
  const resolution = billingResolution(request.resolution) === "default" ? "1k" : billingResolution(request.resolution);
  const perImage = {
    low: { "1k": 0.06, "2k": 0.12, "4k": 0.2 },
    medium: { "1k": 0.53, "2k": 1.07, "4k": 1.78 },
    high: { "1k": 2.11, "2k": 4.28, "4k": 7.12 },
  };
  const images = request.n === undefined ? 1 : request.n;
  return images * perImage[officialQuality(request.quality)][resolution] + inputImageCount(request) * 0.154;
}

const seedreamRatios = new Set(["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "2:1", "1:2", "21:9"]);
const zImageRatios = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]);

function boolean(value, name) {
  if (typeof value !== "boolean") throw new Error(name + " must be a boolean");
  return value;
}

function imageURLs(value, maximum) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum || value.some(function (url) { return !trimmed(url); })) {
    throw new Error("image_urls must contain at most " + maximum + " non-empty URLs");
  }
  return value.slice();
}

function normalizedRatio(value, ratios, errorMessage) {
  const size = trimmed(value).toLowerCase();
  const normalized = /^(\d{1,2})x(\d{1,2})$/.test(size) ? size.replace("x", ":") : size;
  if (!ratios.has(normalized)) throw new Error(errorMessage);
  return normalized;
}

function normalizedNanoBananaRatio(value, model, resolution) {
  const ratio = normalizedRatio(value, nanoBanana2Ratios, "unsupported Nano Banana ratio");
  const extremeRatio = ["1:4", "4:1", "1:8", "8:1"].includes(ratio);
  if (model === "nano-banana-2-1-ext-am" && extremeRatio && resolution !== "1k") {
    throw new Error("unsupported Nano Banana ratio for resolution");
  }
  if (!["nano-banana-2-ext-am", "nano-banana-2-am", "nano-banana-2-1-am", "nano-banana-2-1-ext-am"].includes(model) && extremeRatio) {
    throw new Error("unsupported Nano Banana ratio");
  }
  return ratio;
}

function normalizedProSize(value) {
  const size = trimmed(value).toLowerCase().replace("×", "x");
  if (seedreamRatios.has(size) || ["1k", "1.5k", "2k"].includes(size)) return { value: size, pixels: 0 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error("size must be auto, a supported ratio or tier, or valid pixel dimensions");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 921600 || pixels > 4624220 || width / height < 1 / 16 || width / height > 16) {
    throw new Error("pixel size must contain 921600 to 4624220 pixels with an aspect ratio from 1:16 to 16:1");
  }
  return { value: width + "x" + height, pixels: pixels };
}

function normalizeAPIMartModelRequest(model, request) {
  if (model === gpt26Ext) return normalizeGPT26Ext(request);
  if (gpt26Models.has(model)) return normalizeGPT26(model, request);
  if (gpt25Models.has(model)) return normalizeGPT25(model, request);
  const banana = nanoBananaModels.get(model);
  if (banana) {
    for (const key of Object.keys(request)) {
      if (!nanoBananaFields.has(key) || (banana.credits && key === "official_fallback")) throw new Error("unsupported field for " + model + ": " + key);
    }
    const prompt = trimmed(request.prompt);
    if (!prompt) throw new Error("prompt is required");
    if ((model === "nano-banana-ext-am" || model === "nano-banana-am") && Array.from(prompt).length > 1000) throw new Error("prompt must not exceed 1000 characters");
    const count = request.n === undefined ? 1 : request.n;
    if (!Number.isInteger(count) || count < 1 || count > banana.maxImages) {
      throw new Error(banana.maxImages === 1 ? "n must be 1" : "n must be an integer between 1 and 4");
    }
    const resolution = request.resolution === undefined ? "1k" : trimmed(request.resolution).toLowerCase();
    const acceptedResolutions = banana.maxImages === 4 ? ["0.5k", "1k", "2k", "4k"] : banana.resolutions;
    if (!acceptedResolutions.includes(resolution)) throw new Error("unsupported Nano Banana resolution");
    const defaultSize = ["nano-banana-2-1-am", "nano-banana-2-1-ext-am"].includes(model) ? "auto" : "1:1";
    const output = {
      model: model,
      prompt: prompt,
      n: count,
      size: request.size === undefined ? defaultSize : normalizedNanoBananaRatio(request.size, model, resolution),
      resolution: banana.maxImages === 4 && model !== "nano-banana-2-1-am" ? "1k" : resolution,
    };
    const images = imageURLs(request.image_urls, 14);
    if (images) output.image_urls = images;
    // Keep optional moderation/search disabled; official fallback must never
    // change the selected model's billing contract.
    for (const key of ["nsfw_check", "official_fallback", "google_search", "google_image_search"]) {
      if (request[key] === undefined) continue;
      if (boolean(request[key], key)) throw new Error(key + (banana.credits ? " must be false for Nano Banana credit billing" : " must be false for per-image Nano Banana billing"));
      output[key] = false;
    }
    return output;
  }
  if (!["seedream-5-0-lite-am", "seedream-5-0-pro-am", "z-image-turbo-am"].includes(model)) return request;
  const allowed = model === "seedream-5-0-lite-am"
    ? new Set(["model", "prompt", "size", "resolution", "n", "image_urls", "output_format", "watermark"])
    : model === "seedream-5-0-pro-am"
      ? new Set(["model", "prompt", "size", "resolution", "n", "image_urls", "output_format", "background", "layer_decomposition", "watermark"])
      : new Set(["model", "prompt", "size", "resolution", "n", "prompt_extend"]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) throw new Error("unsupported field for " + model + ": " + key);
  }
  const layerDecomposition = request.layer_decomposition === undefined ? false : boolean(request.layer_decomposition, "layer_decomposition");
  const prompt = trimmed(request.prompt);
  const output = { model: model };
  if (!prompt && !(model === "seedream-5-0-pro-am" && layerDecomposition)) throw new Error("prompt is required");
  if (prompt) output.prompt = prompt;
  if (model === "seedream-5-0-lite-am") {
    const images = imageURLs(request.image_urls, 14);
    const count = request.n === undefined ? 1 : request.n;
    if (!Number.isInteger(count) || count < 1 || count > 15) throw new Error("n must be an integer between 1 and 15");
    if ((images ? images.length : 0) + count > 15) throw new Error("image_urls plus n must not exceed 15");
    output.n = count;
    if (images) output.image_urls = images;
    output.size = request.size === undefined ? "1:1" : normalizedRatio(request.size, seedreamRatios, "size must be auto or a supported Seedream ratio");
    output.resolution = request.resolution === undefined ? "2k" : trimmed(request.resolution).toLowerCase();
    if (!["2k", "3k", "4k"].includes(output.resolution)) throw new Error("resolution must be one of 2k, 3k, or 4k");
    if (request.output_format !== undefined) {
      output.output_format = trimmed(request.output_format).toLowerCase();
      if (!["jpeg", "png"].includes(output.output_format)) throw new Error("output_format must be jpeg or png");
    }
    if (request.watermark !== undefined) output.watermark = boolean(request.watermark, "watermark");
    return output;
  }
  if (model === "seedream-5-0-pro-am") {
    if (request.n !== undefined && request.n !== 1) throw new Error("n must be 1");
    const images = imageURLs(request.image_urls, 10);
    if (images) output.image_urls = images;
    const size = request.size === undefined ? { value: "auto", pixels: 0 } : normalizedProSize(request.size);
    output.size = size.value;
    output.resolution = request.resolution === undefined ? "1k" : trimmed(request.resolution).toLowerCase();
    if (!["1k", "1.5k", "2k"].includes(output.resolution)) throw new Error("resolution must be one of 1k, 1.5k, or 2k");
    if (request.output_format !== undefined) {
      output.output_format = trimmed(request.output_format).toLowerCase();
      if (!["jpeg", "png"].includes(output.output_format)) throw new Error("output_format must be jpeg or png");
    }
    if (request.background !== undefined) {
      output.background = trimmed(request.background).toLowerCase();
      if (!["opaque", "transparent"].includes(output.background)) throw new Error("background must be opaque or transparent");
      if (output.background === "transparent" && (!images || images.length !== 1 || output.output_format !== "png")) throw new Error("transparent background requires one input image and output_format png");
    }
    if (layerDecomposition) {
      if (!images || images.length !== 1 || !["auto", "1k", "1.5k", "2k"].includes(output.size)) throw new Error("layer_decomposition requires one image and size auto, 1k, 1.5k, or 2k");
      output.layer_decomposition = true;
    }
    if (request.watermark !== undefined) output.watermark = boolean(request.watermark, "watermark");
    return output;
  }
  if (request.n !== undefined && request.n !== 1) throw new Error("n must be 1");
  if (prompt.length > 800) throw new Error("prompt must not exceed 800 characters");
  output.size = request.size === undefined ? "1:1" : normalizedRatio(request.size, zImageRatios, "size must be a supported Z-Image-Turbo ratio");
  output.resolution = request.resolution === undefined ? "1k" : trimmed(request.resolution).toLowerCase();
  if (!["1k", "2k"].includes(output.resolution)) throw new Error("resolution must be 1k or 2k");
  if (request.prompt_extend !== undefined) output.prompt_extend = boolean(request.prompt_extend, "prompt_extend");
  return output;
}

// Remote file MIME, alpha, dimensions and matching overlay/source dimensions
// remain vendor validations; do not fetch arbitrary client URLs with credentials.
function gpt26LayerURL(value, name, markup) {
  if (typeof value !== "string") throw new Error(name + " must be a PNG data URL or an image URL");
  const http = markup ? /^https:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/i : /^https?:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/i;
  if (http.test(value)) return value;
  const data = /^data:image\/png;base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  if (!data || data[1].length % 4 !== 0 || !data[1].startsWith("iVBORw0KGgo")) throw new Error(name + " must be a PNG data URL or " + (markup ? "HTTPS" : "HTTP(S)") + " URL");
  const padding = data[1].endsWith("==") ? 2 : data[1].endsWith("=") ? 1 : 0;
  if (markup && data[1].length / 4 * 3 - padding > 50 * 1024 * 1024) throw new Error("markup PNG must not exceed 50 MB");
  // Read only the PNG IHDR prefix; no generic binary or image framework.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = [];
  for (let index = 0; index + 3 < Math.min(data[1].length, 36); index += 4) {
    const bits = alphabet.indexOf(data[1][index]) * 262144 + alphabet.indexOf(data[1][index + 1]) * 4096 + alphabet.indexOf(data[1][index + 2]) * 64 + alphabet.indexOf(data[1][index + 3]);
    bytes.push((bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
  }
  if (bytes.length < 24 || bytes.slice(8, 12).join(",") !== "0,0,0,13" || bytes.slice(12, 16).join(",") !== "73,72,68,82") throw new Error(name + " must contain a PNG IHDR");
  const width = bytes[16] * 16777216 + bytes[17] * 65536 + bytes[18] * 256 + bytes[19];
  const height = bytes[20] * 16777216 + bytes[21] * 65536 + bytes[22] * 256 + bytes[23];
  if (!width || !height) throw new Error(name + " PNG dimensions must be positive");
  if (markup && width * height > 16777216) throw new Error("markup PNG must not exceed 16777216 pixels");
  return value;
}

function normalizeGPT26Ext(request) {
  const aliases = ["image_urls", "image_url", "image", "images", "input_image", "input_images"];
  const ignored = ["background", "moderation", "output_compression", "seed", "negative_prompt", "style", "response_format"];
  const allowed = new Set(["model", "prompt", "version", "resolution", "size", "aspect_ratio", "n", "quality", "output_format", "complexity", "svg", ...aliases, ...ignored]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) throw new Error("unsupported GPT Image 2.6 Ext field: " + key);
  }
  if (!trimmed(request.prompt)) throw new Error("prompt is required");
  if (request.n !== undefined && request.n !== 1) throw new Error("n must be the integer 1");
  const output = { model: gpt26Ext, prompt: request.prompt, n: 1 };
  for (const [field, values, fallback] of [
    ["version", ["flare", "sunburst"], "flare"],
    ["resolution", ["1k", "2k", "4k"], "1k"],
    ["output_format", ["png", "jpeg", "webp", "svg", "gif"], "png"],
    ["quality", ["auto", "low", "medium", "high", "xhigh", "max"], undefined],
    ["complexity", ["low", "medium", "high"], undefined],
  ]) {
    if (request[field] === undefined && fallback === undefined) continue;
    let value = request[field] === undefined ? fallback : trimmed(request[field]).toLowerCase();
    if (field === "output_format" && value === "jpg") value = "jpeg";
    if (!values.includes(value)) throw new Error("unsupported " + field);
    output[field] = value;
  }
  const size = request.size === undefined ? undefined : trimmed(request.size).toLowerCase();
  const aspect = request.aspect_ratio === undefined ? undefined : trimmed(request.aspect_ratio).toLowerCase();
  if (size !== undefined && aspect !== undefined && size !== aspect) throw new Error("size and aspect_ratio must match");
  output.size = size === undefined ? aspect === undefined ? "auto" : aspect : size;
  if (!nanoBananaRatios.has(output.size)) throw new Error("size must be auto or a supported GPT Image 2.6 Ext ratio");
  if (output.output_format === "gif" && output.size !== "auto") throw new Error("GIF size must be auto or omitted");
  const referenceFields = aliases.filter(field => request[field] !== undefined);
  // Avoid silently choosing between competing reference lists.
  if (referenceFields.length > 1) throw new Error("use only one reference image field");
  if (referenceFields.length) {
    const value = request[referenceFields[0]];
    const images = imageURLs(typeof value === "string" && referenceFields[0] !== "image_urls" ? [value] : value, 16);
    if (images.length && ["svg", "gif"].includes(output.output_format)) throw new Error("GIF and SVG only support text-to-image generation");
    for (const image of images) {
      const url = image.trim();
      let restricted = /\.(gif|bmp)(?:[?#]|$)/i.test(url);
      if (/^data:/i.test(url)) {
        const comma = url.indexOf(",");
        const mime = /^data:image\/(png|jpeg|webp|gif|bmp|x-ms-bmp);base64$/i.exec(url.slice(0, comma));
        if (!mime || comma < 0) throw new Error("reference images must be HTTP(S) URLs or supported image Base64 Data URLs");
        const encoded = url.slice(comma + 1);
        const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
        if (encoded.length / 4 * 3 - padding > 20 * 1024 * 1024) throw new Error("each reference image must not exceed 20 MB");
        if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("invalid reference image Base64");
        restricted = ["gif", "bmp", "x-ms-bmp"].includes(mime[1].toLowerCase()) || /^R0lGOD|^Qk/.test(encoded);
      } else if (!/^https?:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/i.test(url)) {
        throw new Error("reference images must be HTTP(S) URLs or supported image Base64 Data URLs");
      }
      if (output.resolution !== "1k" && restricted) throw new Error("2k and 4k reference images cannot be GIF or BMP");
    }
    // Remote download byte size and actual media type are checked by APIMart;
    // the plugin cannot fetch 16 arbitrary external hosts through utils.fetch.
    output.image_urls = images.map(image => image.trim());
  }
  if (request.svg !== undefined) {
    if (output.output_format !== "svg") throw new Error("svg configuration is only supported with SVG");
    const config = object(request.svg, "svg must be an object");
    if (Object.keys(config).some(key => !["model", "reasoning"].includes(key))) throw new Error("unsupported svg field");
    if (!trimmed(config.model)) throw new Error("svg.model is required when svg is provided");
    output.svg = { model: config.model.trim() };
    if (config.reasoning !== undefined) {
      const reasoning = object(config.reasoning, "svg.reasoning must be an object");
      if (Object.keys(reasoning).some(key => key !== "effort")) throw new Error("unsupported svg.reasoning field");
      output.svg.reasoning = {};
      if (reasoning.effort !== undefined) {
        const effort = trimmed(reasoning.effort).toLowerCase();
        if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("unsupported svg.reasoning.effort");
        output.svg.reasoning.effort = effort;
      }
    }
  }
  return output;
}

function gpt26ExtUsage(request) {
  return { upstream_credits: gpt26ExtPrices[request.version][request.resolution] * 10, version: request.version, resolution: request.resolution };
}

function gpt26ExtActualCredits(data) {
  // Reuse APIMart's existing 64-credit safety ceiling, not token estimates.
  const ceiling = 64;
  const cost = data.cost;
  const credits = data.credits_cost;
  if (cost === undefined && credits === undefined) return null;
  if (cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > ceiling / 10)) return null;
  if (credits !== undefined && (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0 || credits > ceiling)) return null;
  if (cost !== undefined && credits !== undefined && Math.abs(cost * 10 - credits) > 0.00001) return null;
  return cost === undefined ? credits : cost * 10;
}

function normalizeGPT26(model, request) {
  const allowed = new Set(["model", "prompt", "size", "resolution", "n", "image_urls", "quality", "output_format", "output_compression", "background", "moderation", "mask_url", "markup_url", "markup", "complexity", "safety_identifier", "frame_count", "frame_duration_ms", "svg"]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) throw new Error("unsupported GPT Image 2.6 field: " + key);
  }
  if (typeof request.prompt !== "string" || !request.prompt.trim() || Array.from(request.prompt).length > 32000) throw new Error("prompt must contain 1 to 32000 characters");
  const n = request.n === undefined ? 1 : request.n;
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("n must be an integer between 1 and 4");
  const output = { model, prompt: request.prompt, n };
  for (const [field, values, fallback] of [
    ["resolution", ["1k", "2k", "4k"], "1k"],
    ["quality", ["auto", "low", "medium", "high", "xhigh", "max"], "auto"],
    ["output_format", ["png", "jpeg", "webp", "gif", "svg"], "png"],
    ["moderation", ["auto", "low"], "low"],
    ["background", ["transparent", "opaque", "auto"], undefined],
    ["complexity", ["low", "medium", "high"], undefined],
  ]) {
    const value = request[field] === undefined ? fallback : request[field];
    if (value === undefined) continue;
    if (!values.includes(value)) throw new Error("unsupported " + field);
    output[field] = value;
  }
  const gif = output.output_format === "gif";
  const svg = output.output_format === "svg";
  if (gif || svg) {
    if (["image_urls", "mask_url", "markup_url", "markup"].some(field => request[field] !== undefined)) throw new Error("GIF and SVG only support text-to-image generation");
  }
  if (!gif && (request.frame_count !== undefined || request.frame_duration_ms !== undefined)) throw new Error("frame_count and frame_duration_ms are only supported with GIF");
  if (!svg && request.svg !== undefined) throw new Error("svg configuration is only supported with SVG");
  if (svg) {
    if (n !== 1) throw new Error("SVG requires n=1");
    const config = object(request.svg, "SVG requires svg.model");
    if (Object.keys(config).some(key => !["model", "reasoning"].includes(key))) throw new Error("unsupported svg field");
    if (typeof config.model !== "string" || !config.model.trim()) throw new Error("SVG requires svg.model");
    output.svg = { model: config.model };
    if (config.reasoning !== undefined) {
      const reasoning = object(config.reasoning, "svg.reasoning must be an object");
      if (Object.keys(reasoning).some(key => key !== "effort")) throw new Error("unsupported svg.reasoning field");
      output.svg.reasoning = {};
      if (reasoning.effort !== undefined) {
        if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoning.effort)) throw new Error("unsupported svg.reasoning.effort");
        output.svg.reasoning.effort = reasoning.effort;
      }
    }
  }
  if (gif) {
    const frames = request.frame_count === undefined ? 9 : request.frame_count;
    if (!Number.isInteger(frames) || frames < 2 || frames > 16) throw new Error("frame_count must be an integer from 2 to 16");
    const duration = request.frame_duration_ms === undefined ? 200 : request.frame_duration_ms;
    if (!Number.isSafeInteger(duration) || duration < 20) throw new Error("frame_duration_ms must be a safe integer of at least 20 milliseconds");
    output.frame_count = frames;
    // The provider rounds to 10ms. Keep the supplied integer so wire semantics
    // do not depend on an undocumented local rounding direction.
    output.frame_duration_ms = duration;
    const size = request.size === undefined ? "auto" : request.size;
    const match = typeof size === "string" && /^(\d{1,4})x(\d{1,4})$/.exec(size);
    if (size !== "auto" && !match) throw new Error("GIF size must be auto or frame pixel dimensions");
    const width = match ? Number(match[1]) : 512;
    const height = match ? Number(match[2]) : 512;
    if (!width || !height || width % 16 || height % 16) throw new Error("GIF frame dimensions must be positive multiples of 16");
    gpt26GIFSheet(width, height, frames);
    if (request.size !== undefined) output.size = size;
  } else if (request.size !== undefined) {
    const size = request.size;
    if (typeof size !== "string") throw new Error("unsupported GPT Image 2.6 size");
    if (!gptImage2Sizes.has(size)) {
      const match = /^(\d{1,4})x(\d{1,4})$/.exec(size);
      if (!match) throw new Error("unsupported GPT Image 2.6 size");
      const width = Number(match[1]), height = Number(match[2]), pixels = width * height;
      if (width % 16 || height % 16 || Math.max(width, height) > 3840 || pixels < 655360 || pixels > 8294400 || Math.max(width, height) > Math.min(width, height) * 3) throw new Error("pixel dimensions must be multiples of 16, at most 3840 per edge, 655360 to 8294400 pixels, and at most 3:1");
    }
    output.size = size;
  }
  if (output.background === "transparent" && !["png", "webp"].includes(output.output_format)) throw new Error("transparent background requires png or webp");
  if (request.output_compression !== undefined) {
    if (!Number.isInteger(request.output_compression) || request.output_compression < 0 || request.output_compression > 100) throw new Error("output_compression must be an integer from 0 to 100");
    if (!["jpeg", "webp"].includes(output.output_format)) throw new Error("output_compression is only supported with jpeg or webp");
    output.output_compression = request.output_compression;
  }
  const images = imageURLs(request.image_urls, 16);
  if (images) {
    if (images.some(url => !/^https?:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/i.test(url))) throw new Error("reference images must be public HTTP(S) URLs");
    output.image_urls = images;
  }
  if (request.mask_url !== undefined) {
    if (!images || !images.length) throw new Error("mask_url requires image_urls");
    output.mask_url = gpt26LayerURL(request.mask_url, "mask_url", false);
  }
  if (request.markup_url !== undefined || request.markup !== undefined) {
    if (!images || !images.length) throw new Error("markup requires image_urls");
    if (request.mask_url !== undefined) throw new Error("markup cannot be combined with mask_url");
    if (request.markup_url !== undefined && request.markup !== undefined) throw new Error("use only one of markup_url or markup");
    let markup = request.markup_url === undefined ? request.markup : request.markup_url;
    if (request.markup !== undefined && typeof markup !== "string") {
      object(markup, "markup must be a string or an image_url object");
      if (Object.keys(markup).length !== 1 || typeof markup.image_url !== "string") throw new Error("markup must contain only image_url; file_id is unsupported");
      markup = markup.image_url;
    }
    output.markup_url = gpt26LayerURL(markup, "markup", true);
  }
  if (request.safety_identifier !== undefined) {
    if (typeof request.safety_identifier !== "string" || Array.from(request.safety_identifier).length > 128) throw new Error("safety_identifier must be a string of at most 128 characters");
    output.safety_identifier = request.safety_identifier;
  }
  return output;
}

// APIMart arranges each GIF into one billable sheet, rotating the layout to
// approach a square. Reuse this for validation and the output-token estimate.
function gpt26GIFSheet(frameWidth, frameHeight, frames) {
  let columns = frames <= 8 ? 4 : frames === 9 ? 3 : 4;
  let rows = frames <= 8 ? 2 : frames === 9 ? 3 : frames <= 12 ? 3 : 4;
  const normalAspect = frameWidth * columns / (frameHeight * rows);
  const transposedAspect = frameWidth * rows / (frameHeight * columns);
  if (Math.abs(Math.log(transposedAspect)) < Math.abs(Math.log(normalAspect))) [columns, rows] = [rows, columns];
  const width = frameWidth * columns, height = frameHeight * rows;
  if (Math.max(width, height) > 3840 || width * height > 8294400 || Math.max(width, height) > Math.min(width, height) * 3) throw new Error("no supported sheet fits GIF frames at the requested size");
  return { width, height };
}

function gpt26Usage(request) {
  const quality = request.quality === "auto" ? "max" : request.quality;
  let width, height;
  if (request.output_format === "gif") {
    const [frameWidth, frameHeight] = (request.size && request.size !== "auto" ? request.size : "512x512").split("x").map(Number);
    ({ width, height } = gpt26GIFSheet(frameWidth, frameHeight, request.frame_count));
  } else if (request.size && request.size.includes("x")) {
    [width, height] = request.size.split("x").map(Number);
  } else {
    // Follow the vendor playground's 1:1 reference for automatic/unknown first
    // image dimensions, without changing omitted size into explicit auto on wire.
    const ratio = request.size && request.size !== "auto" ? request.size : "1:1";
    const [first, second] = ratio.split(":").map(Number);
    const landscape = Math.max(first, second) + ":" + Math.min(first, second);
    // Only the pixel mapping is shared with 2.5; never use its token counts.
    const pixels = gpt25OutputSpecs[request.resolution][landscape].pixels;
    [width, height] = pixels.split("x").map(Number);
  }
  // OpenAI's GPT Image 2.6 output calculator uses this quality grid and rounds
  // the short grid edge to nearest, ties to even. APIMart rounds the final
  // low/medium factor upward (OpenAI's display rounds to nearest). This version
  // matches all 225 vendor catalog values and its nine extra GIF pixel examples.
  // Source: developers.openai.com/api/docs/guides/image-generation#calculating-costs
  // Snapshot: GptImageTokenCalculator.react.DcSj7WaD.js, 2026-11-05.
  const longGrid = { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 }[quality];
  const shortExact = longGrid / (Math.max(width, height) / Math.min(width, height));
  const shortFloor = Math.floor(shortExact);
  const shortGrid = shortExact - shortFloor === 0.5 ? shortFloor + shortFloor % 2 : Math.round(shortExact);
  const baseOutput = Math.ceil(longGrid * shortGrid * (2000000 + width * height) / 4000000);
  const outputTokens = Math.ceil(baseOutput * (quality === "low" ? 4.2 : quality === "medium" ? 3.3 : 1));
  let textTokens = 0;
  for (const character of request.prompt) {
    const point = character.codePointAt(0);
    textTokens += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  // Keep the existing 2.5 reference-input estimate, not a claimed 2.6 token cap.
  // Markup has no separate image fee; internal extra text is not measured here.
  const imageTokens = (request.image_urls || []).length * 16384;
  // Approved reference reservation: SVG includes the raster reference and prompt
  // only. Authoring text is unestimated, not free; completion replaces the whole
  // fact with the vendor's task cost, without adding svg_usage a second time.
  return { upstream_credits: (request.n * outputTokens * 240 + textTokens * 40 + imageTokens * 64) / 1000000 };
}

function gpt26ActualCredits(data) {
  // Local sanity ceiling from the largest supported reservation envelope:
  // 4M image output + 1M text input + 1M image input at the catalog rates.
  // It is not a price promise; actual costs can exceed a reference estimate.
  const ceiling = (4 * gpt26TokenLimit * 240 + gpt26TokenLimit * 40 + gpt26TokenLimit * 64) / 10000000;
  if (typeof data.cost !== "number" || !Number.isFinite(data.cost) || data.cost < 0 || data.cost > ceiling) return null;
  if (data.credits_cost !== undefined && (typeof data.credits_cost !== "number" || !Number.isFinite(data.credits_cost) || data.credits_cost < 0 || Math.abs(data.credits_cost - data.cost * 10) > 0.00001)) return null;
  return data.cost * 10;
}

function gpt26DeliveredCount(ctx, data) {
  const requested = ctx.model === gpt26Ext ? 1 : ctx.state && ctx.state.gpt26_requested_images;
  if (!Number.isInteger(requested) || requested < 1 || requested > 4) return null;
  const images = data.result && data.result.images;
  if (!Array.isArray(images) || !images.length) return null;
  const urls = new Set();
  for (const image of images) {
    if (!image || !Array.isArray(image.url) || !image.url.length) return null;
    for (const url of image.url) {
      if (typeof url !== "string" || !/^https?:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/i.test(url)) return null;
      urls.add(url);
    }
  }
  return urls.size > 0 && urls.size <= requested ? urls.size : null;
}

function normalizeGPT25(model, request) {
  const ext = model === gpt25Ext;
  const allowed = new Set(["model", "prompt", "size", "resolution", "n", "image_urls", ...(ext ? ["version"] : ["quality", "output_format", "output_compression", "background", "moderation"])]);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) throw new Error("unsupported GPT Image 2.5 field: " + key);
  }
  const prompt = trimmed(request.prompt);
  // Bound estimation and request size independently of upstream validation.
  if (!prompt || prompt.length > 64000) throw new Error("prompt must contain 1 to 64000 characters");
  const n = request.n === undefined ? 1 : request.n;
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("n must be an integer between 1 and 4");
  const resolution = request.resolution === undefined ? "1k" : trimmed(request.resolution).toLowerCase();
  if (!["1k", "2k", "4k"].includes(resolution)) throw new Error("resolution must be 1k, 2k, or 4k");
  const size = request.size === undefined ? "auto" : trimmed(request.size).toLowerCase();
  if (ext ? !nanoBananaRatios.has(size) : !gptImage2Sizes.has(size)) {
    const match = !ext && /^(\d{1,4})x(\d{1,4})$/.exec(size);
    if (!match) throw new Error("unsupported GPT Image 2.5 size");
    const width = Number(match[1]), height = Number(match[2]);
    const pixels = width * height;
    if (width % 16 || height % 16 || Math.max(width, height) > 3840 || pixels < 655360 || pixels > 8294400 || Math.max(width, height) > Math.min(width, height) * 3) {
      throw new Error("pixel dimensions must be multiples of 16, at most 3840 per edge, 655360 to 8294400 pixels, and at most 3:1");
    }
  }
  const output = { model, prompt, size, resolution, n };
  const images = imageURLs(request.image_urls, 16);
  if (images) {
    for (const url of images) {
      const http = /^https?:\/\/[^\s/@]+(?:[/?#][^\s]*)?$/i.test(url);
      const data = ext && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(url);
      if (!http && !data) throw new Error(ext ? "reference images must be HTTP(S) or image data URLs" : "reference images must be public HTTP(S) URLs");
    }
    output.image_urls = images;
  }
  if (ext) {
    output.version = request.version === undefined ? "flare" : trimmed(request.version).toLowerCase();
    if (!["flare", "sunburst"].includes(output.version)) throw new Error("version must be flare or sunburst");
    return output;
  }
  for (const [field, values, fallback] of [
    ["quality", ["auto", "low", "medium", "high", "xhigh", "max"], "auto"],
    ["output_format", ["png", "jpeg", "webp"], "png"],
    ["moderation", ["auto", "low"], "low"],
    ["background", ["transparent", "opaque", "auto"], undefined],
  ]) {
    const value = request[field] === undefined ? fallback : trimmed(request[field]).toLowerCase();
    if (value === undefined) continue;
    if (!values.includes(value)) throw new Error("unsupported " + field);
    output[field] = value;
  }
  if (output.background === "transparent" && output.output_format === "jpeg") throw new Error("transparent background requires png or webp");
  if (request.output_compression !== undefined) {
    if (!Number.isInteger(request.output_compression) || request.output_compression < 0 || request.output_compression > 100) throw new Error("output_compression must be an integer from 0 to 100");
    output.output_compression = request.output_compression;
  }
  return output;
}

function gpt25Usage(model, request) {
  if (model === gpt25Ext) return { images: request.n, resolution: request.resolution.toLowerCase(), version: request.version };
  // Estimate auto at high without changing the upstream quality. This is an
  // expected-use reservation, not a maximum charge: completion replaces it
  // with validated actual cost, including a supplemental charge when higher.
  const quality = request.quality === "auto" ? "high" : request.quality;
  let spec = gpt25OutputSpecs[request.resolution]["1:1"];
  if (request.size.includes(":")) {
    const [width, height] = request.size.split(":").map(Number);
    const ratio = Math.max(width, height) + ":" + Math.min(width, height);
    spec = gpt25OutputSpecs[request.resolution][ratio];
  } else if (request.size !== "auto") {
    const [width, height] = request.size.split("x").map(Number);
    const pixels = Math.max(width, height) + "x" + Math.min(width, height);
    spec = Object.values(gpt25OutputSpecs).flatMap(Object.values).find(value => value.pixels === pixels)
      || gpt25OutputSpecs["4k"]["1:1"];
  }
  const tokens = spec.tokens[["low", "medium", "high", "xhigh", "max"].indexOf(quality)];
  // UTF-8 bytes bound prompt tokens more closely than four tokens per UTF-16
  // code unit. Reference dimensions are unavailable, so keep their reservation.
  let promptTokens = 0;
  for (const character of request.prompt) {
    const point = character.codePointAt(0);
    promptTokens += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  // Credits per million tokens: output 240, text input 40, image input 64.
  const credits = (request.n * tokens * 240 + promptTokens * 40 + (request.image_urls || []).length * 16384 * 64) / 1000000;
  return { upstream_credits: credits };
}

function gpt25ActualCredits(data) {
  // The explicit customer contract is validated upstream USD, without applying
  // the published 20% discount a second time. Never coerce null/strings to zero.
  if (typeof data.cost !== "number" || !Number.isFinite(data.cost) || data.cost < 0 || data.cost > 100) return null;
  if (data.credits_cost !== undefined && (typeof data.credits_cost !== "number" || !Number.isFinite(data.credits_cost) || data.credits_cost < 0 || Math.abs(data.credits_cost - data.cost * 10) > 0.00001)) return null;
  return data.cost * 10;
}

function gpt25DeliveredCount(ctx, data) {
  const requested = ctx.state && ctx.state.billing_usage && ctx.state.billing_usage.images;
  if (!Number.isInteger(requested) || requested < 1 || requested > 4) return null;
  const images = data.result && data.result.images;
  if (!Array.isArray(images)) return null;
  const urls = new Set();
  for (const image of images) {
    if (!image || !Array.isArray(image.url) || image.url.length === 0) return null;
    for (const url of image.url) {
      if (typeof url !== "string" || !/^https?:\/\/[^\s]+$/i.test(url)) return null;
      urls.add(url);
    }
  }
  return urls.size > 0 && urls.size <= requested ? urls.size : null;
}

function proStandardTier(request) {
  const size = normalizedProSize(request.size);
  if (size.pixels) return size.pixels > 2601124 ? "2k" : "1k";
  if (size.value === "2k" || request.resolution === "2k") return "2k";
  if (size.value === "1.5k" || request.resolution === "1.5k") return "1.5k";
  return "1k";
}
function proUsage(resolution, standardImages, layerImages, referenceImages) {
  return {
    resolution: resolution,
    standard_images: standardImages,
    layer_images: layerImages,
    reference_images: referenceImages,
  };
}

function apimartUsage(request, model) {
  const banana = nanoBananaModels.get(model);
  if (banana) {
    if (banana.credits) return { upstream_credits: banana.credits[request.resolution] * request.n };
    return { images: request.n, resolution: request.resolution };
  }
  if (model === "seedream-5-0-lite-am") return { images: request.n, resolution: request.resolution, input_images: inputImageCount(request) };
  if (model === "seedream-5-0-pro-am") {
    if (request.layer_decomposition === true) {
      const size = normalizedProSize(request.size);
      const billingResolution = size.value === "auto" ? "2k" : size.value;
      return proUsage(billingResolution, 0, 17, 1);
    }
    return proUsage(proStandardTier(request), 1, 0, inputImageCount(request));
  }
  if (model === "z-image-turbo-am") return { images: 1, resolution: request.resolution, prompt_extend: request.prompt_extend === true };
  return null;
}

function proCompletionData(body) {
  const value = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return value.data && typeof value.data === "object" && !Array.isArray(value.data) ? value.data : value;
}

function storedProUsage(ctx) {
  const state = ctx && ctx.state && typeof ctx.state === "object" && !Array.isArray(ctx.state) ? ctx.state : {};
  const usage = state.billing_usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  if (!["1k", "1.5k", "2k"].includes(usage.resolution)) return null;
  if (![0, 1].includes(usage.standard_images) || !Number.isInteger(usage.layer_images) || usage.layer_images < 0 || usage.layer_images > 17 || !Number.isInteger(usage.reference_images) || usage.reference_images < 0 || usage.reference_images > 10) return null;
  return usage;
}

function proCompletedUsage(ctx, body) {
  const data = proCompletionData(body);
  const status = trimmed(data.status).toLowerCase();
  let submission = storedProUsage(ctx);
  if (!submission && ctx && ctx.requestBody) {
    const request = normalizeAPIMartModelRequest("seedream-5-0-pro-am", ctx.requestBody);
    submission = apimartUsage(request, "seedream-5-0-pro-am");
  }
  if (!submission) return null;
  if (["failed", "cancelled", "canceled"].includes(status)) return proUsage(submission.resolution, 0, 0, 0);
  if (!["completed", "success"].includes(status)) return null;
  if (submission.standard_images > 0) return submission;
  const result = data.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const urls = new Set();
  for (const collectionName of ["images", "layers"]) {
    const collection = result[collectionName];
    if (collection === undefined) continue;
    if (!Array.isArray(collection)) return null;
    for (const item of collection) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const values = Array.isArray(item.url) ? item.url : Array.isArray(item.urls) ? item.urls : typeof item.url === "string" ? [item.url] : typeof item.urls === "string" ? [item.urls] : null;
      if (!values) return null;
      for (const value of values) {
        const url = trimmed(value);
        if (!url) return null;
        urls.add(url);
        if (urls.size > 17) return null;
      }
    }
  }
  return proUsage(submission.resolution, 0, urls.size, submission.reference_images);
}

function nanoBananaCompletedUsage(ctx, model, body) {
  const config = nanoBananaModels.get(model);
  const data = proCompletionData(body);
  const status = trimmed(data.status).toLowerCase();
  if (config.credits) {
    if (body && body.code !== undefined && body.code !== 200) return null;
    if (["failed", "failure", "cancelled", "canceled"].includes(status)) return { upstream_credits: 0 };
    if (!["completed", "success"].includes(status)) return null;
    // The user-selected contract is actual task cost, not reconstructed tokens.
    // Reuse the existing APIMart official-credit safety ceiling (64 credits).
    // Missing/malformed values must not coerce to zero or refund the reservation.
    if (data.credits_cost !== undefined) {
      const credits = data.credits_cost;
      if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0 || credits > 64) return null;
      return { upstream_credits: credits };
    }
    const cost = data.cost;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > 6.4) return null;
    return { upstream_credits: cost * 10 };
  }
  let submission = ctx.state && ctx.state.billing_usage;
  if (!submission || !Number.isInteger(submission.images) || submission.images < 1 || submission.images > config.maxImages || !config.resolutions.includes(submission.resolution)) {
    submission = ctx.requestBody ? apimartUsage(normalizeAPIMartModelRequest(model, ctx.requestBody), model) : null;
  }
  if (!submission) return null;
  if (["failed", "failure", "cancelled", "canceled"].includes(status)) return { images: 0, resolution: submission.resolution };
  if (!["completed", "success"].includes(status)) return null;
  const images = data.result && data.result.images;
  if (!Array.isArray(images)) return null;
  const urls = new Set();
  for (const image of images) {
    if (!image || typeof image !== "object" || Array.isArray(image)) return null;
    const values = Array.isArray(image.url) ? image.url : typeof image.url === "string" ? [image.url] : null;
    if (!values || values.length === 0) return null;
    for (const value of values) {
      const url = trimmed(value);
      if (!/^https?:\/\/[^/\s]+(?:[/?#][^\s]*)?$/i.test(url)) return null;
      urls.add(url);
      if (urls.size > submission.images) return null;
    }
  }
  return { images: urls.size, resolution: submission.resolution };
}

function imageTaskData(task) {
  const snapshot = task && task.data;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};
  const response = snapshot.response && typeof snapshot.response === "object" && !Array.isArray(snapshot.response) ? snapshot.response : snapshot;
  if (response.data && typeof response.data === "object" && !Array.isArray(response.data)) return response.data;
  // Ext also documents task objects without the code/data envelope.
  return response.status !== undefined && response.result !== undefined ? response : {};
}

function publicStatus(status) {
  const mapped = {
    SUBMITTED: "submitted",
    QUEUED: "submitted",
    IN_PROGRESS: "processing",
    SUCCESS: "completed",
    FAILURE: "failed",
  };
  return mapped[String(status || "").toUpperCase()] || "submitted";
}

function failureReason(data, fallback) {
  const error = data && data.error;
  if (error && typeof error === "object" && trimmed(error.message)) return publicMessage(error.message);
  return publicMessage(fallback);
}

function publicMessage(value) {
  return trimmed(value).replace(/\b(?:APIMart|APIB)\b/gi, "AM");
}

function progressValue(value) {
  const number = Number(String(value === undefined || value === null ? "" : value).replace("%", ""));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

function providerImageURLs(task) {
  const result = imageTaskData(task).result;
  const images = result && Array.isArray(result.images) ? result.images : [];
  const urls = [];
  for (const image of images) {
    if (!image || typeof image !== "object" || !Array.isArray(image.url)) continue;
    for (const url of image.url) {
      if (trimmed(url)) urls.push(trimmed(url));
    }
  }
  return urls;
}

function artifactKey(index, url) {
  return "image-" + index + "-" + utils.hmacSHA256(url, "new-api:apimart:artifact-key");
}

export function buildSubmitRequest(ctx) {
  const request = object(ctx.requestBody, "image generation request is required");
  const publicModel = trimmed(ctx.model || request.model);
  const banana = nanoBananaModels.get(publicModel);
  const upstreamModel = trimmed(ctx.upstreamModel);
  const model = publicModel === gpt26Ext && (!upstreamModel || upstreamModel === publicModel) ? "gpt-image-2.6-ext" : gpt26Models.has(publicModel) && (!upstreamModel || upstreamModel === publicModel) ? gpt26Models.get(publicModel) : gpt25Models.has(publicModel) && (!upstreamModel || upstreamModel === publicModel) ? gpt25Models.get(publicModel) : banana && (!upstreamModel || upstreamModel === publicModel) ? banana.upstream : upstreamModel || publicModel;
  if (publicModel === gpt26Ext && model !== "gpt-image-2.6-ext") throw new Error("upstream model must match the GPT Image 2.6 Ext alias");
  if (gpt26Models.has(publicModel) && model !== gpt26Models.get(publicModel)) throw new Error("upstream model must match the GPT Image 2.6 alias");
  if (gpt25Models.has(publicModel) && model !== gpt25Models.get(publicModel)) throw new Error("upstream model must match the GPT Image 2.5 alias");
  if (banana && ![banana.upstream, publicModel.slice(0, -3)].includes(model)) {
    throw new Error("upstream model must match the Nano Banana " + (banana.credits ? "credit" : "ext") + " alias");
  }
  if (!isDeclaredModel(publicModel)) throw new Error("unsupported AM image model");
  const body = Object.assign({}, normalizeAPIMartModelRequest(publicModel, request), { model: model });
  // Keep canonical request and usage tiers lowercase; only the vendor wire format uses uppercase.
  if (publicModel === gpt25Ext) body.resolution = body.resolution.toUpperCase();
  return {
    url: ctx.baseUrl + "/v1/images/generations",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: body,
    action: "image_generation",
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid AM submit response");
  if ((gpt26Models.has(ctx.model) || ctx.model === gpt26Ext) && (![200, 202].includes(Number(body.code)) || !(Array.isArray(body.data) && body.data[0] && trimmed(body.data[0].task_id)))) {
    return { taskId: "am-" + (ctx.publicTaskId || utils.uuid()), taskData: {}, immediate: { status: "FAILURE", reason: failureReason(body, publicMessage(body.message) || "AM image task submission failed or is missing task_id") } };
  }
  if (![200, 202].includes(Number(body.code))) throw new Error(publicMessage(body.message) || "AM image task submission failed");
  const entries = Array.isArray(body.data) ? body.data : [];
  const submitted = entries[0] && typeof entries[0] === "object" ? entries[0] : body.data && typeof body.data === "object" ? body.data : {};
  const taskId = trimmed(submitted.task_id || submitted.id);
  if (!taskId) throw new Error("AM submit response is missing task_id");
  const request = ctx && ctx.requestBody && typeof ctx.requestBody === "object" ? ctx.requestBody : {};
  const publicModel = trimmed(ctx && ctx.model || request.model);
  const normalized = publicModel === gpt26Ext || gpt26Models.has(publicModel) || publicModel === "seedream-5-0-pro-am" || nanoBananaModels.has(publicModel) || gpt25Models.has(publicModel) ? normalizeAPIMartModelRequest(publicModel, request) : null;
  const billingUsage = normalized ? publicModel === gpt26Ext ? gpt26ExtUsage(normalized) : gpt26Models.has(publicModel) ? gpt26Usage(normalized) : gpt25Models.has(publicModel) ? gpt25Usage(publicModel, normalized) : apimartUsage(normalized, publicModel) : null;
  if (gpt26Models.has(publicModel) || publicModel === gpt26Ext) return { taskId, taskData: body, state: { billing_usage: billingUsage, gpt26_requested_images: normalized.n } };
  return billingUsage
    ? { taskId: taskId, taskData: body, state: { billing_usage: billingUsage } }
    : { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const request = ctx.requestBody || {};
  const publicModel = trimmed(ctx.model || request.model);
  const normalized = normalizeAPIMartModelRequest(publicModel, request);
  if (publicModel === gpt26Ext) return gpt26ExtUsage(normalized);
  if (gpt26Models.has(publicModel)) return gpt26Usage(normalized);
  if (gpt25Models.has(publicModel)) return gpt25Usage(publicModel, normalized);
  const taskUsage = apimartUsage(normalized, publicModel);
  if (taskUsage) return taskUsage;
  if (isOfficialGPTImage2(ctx.upstreamModel || ctx.model || request.model)) {
    return { upstream_credits: estimateOfficialCredits(request) };
  }
  return {
    // APIMart GPT-Image-2 only supports one result per task. Keep the
    // pre-consume fact independent from any bypassed passthrough value.
    images: 1,
    resolution: billingResolution(request.resolution),
    input_images: inputImageCount(request),
  };
}

export function extractUsageOnComplete(ctx, _taskResult, body) {
  const publicModel = trimmed(ctx.model || (ctx.requestBody || {}).model);
  if (gpt26Models.has(publicModel) || publicModel === gpt26Ext) {
    if (body && body.code !== undefined && body.code !== 200) return null;
    const data = publicModel === gpt26Ext && body && body.data === undefined ? body : body && body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const status = trimmed(data.status).toLowerCase();
    if (["failed", "failure", "cancelled", "canceled"].includes(status)) return { upstream_credits: 0 };
    if (!["completed", "success"].includes(status) || gpt26DeliveredCount(ctx, data) === null) return null;
    const credits = publicModel === gpt26Ext ? gpt26ExtActualCredits(data) : gpt26ActualCredits(data);
    return credits === null ? null : { upstream_credits: credits };
  }
  if (gpt25Models.has(publicModel)) {
    const data = body && body.data;
    if (!data || typeof data !== "object") return null;
    if (["failed", "failure", "cancelled", "canceled"].includes(data.status)) return publicModel === gpt25Ext ? { images: 0 } : { upstream_credits: 0 };
    if (!["completed", "success"].includes(data.status)) return null;
    if (publicModel !== gpt25Ext) {
      const credits = gpt25ActualCredits(data);
      return credits === null ? null : { upstream_credits: credits };
    }
    const count = gpt25DeliveredCount(ctx, data);
    return count === null ? null : { images: count };
  }
  if (publicModel === "seedream-5-0-pro-am") return proCompletedUsage(ctx, body);
  if (nanoBananaModels.has(publicModel)) return nanoBananaCompletedUsage(ctx, publicModel, body);
  if (!isOfficialGPTImage2(ctx.upstreamModel || ctx.model)) return null;
  const data = body && body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const status = trimmed(data.status).toLowerCase();
  if (status === "failed") return { upstream_credits: 0 };
  if (status !== "completed") return null;
  const credits = Number(data.credits_cost);
  if (!Number.isFinite(credits) || credits < 0 || credits > 64) return null;
  return { upstream_credits: credits };
}

export function buildQueryRequest(ctx) {
  const taskId = trimmed(ctx.taskId);
  if (!taskId) throw new Error("task_id is required");
  return {
    url: ctx.baseUrl + "/v1/tasks/" + encodeURIComponent(taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(ctx, body) {
  const raw = object(body, "invalid AM task response");
  const response = ctx.model === gpt26Ext && raw.data === undefined && raw.status !== undefined ? { code: raw.code === undefined ? 200 : raw.code, message: raw.message, data: raw } : raw;
  if (Number(response.code) !== 200) {
    return { code: Number(response.code) || 0, status: "FAILURE", progress: "100%", reason: publicMessage(response.message) || "AM task query failed" };
  }
  const data = object(response.data, "AM task response is missing data");
  if ((gpt26Models.has(ctx.model) || ctx.model === gpt26Ext) && ["completed", "success"].includes(trimmed(data.status).toLowerCase())) {
    if (gpt26DeliveredCount(ctx, data) === null) return { status: "UNKNOWN", reason: "invalid delivered image count" };
    if ((ctx.model === gpt26Ext ? gpt26ExtActualCredits(data) : gpt26ActualCredits(data)) === null) return { status: "IN_PROGRESS", progress: "99%", reason: "" };
  }
  if (gpt25Models.has(ctx.model) && ["completed", "success"].includes(trimmed(data.status).toLowerCase())) {
    if (ctx.model !== gpt25Ext && gpt25ActualCredits(data) === null) return { status: "IN_PROGRESS", progress: "99%", reason: "" };
    if (ctx.model === gpt25Ext && gpt25DeliveredCount(ctx, data) === null) return { status: "UNKNOWN", reason: "invalid delivered image count" };
  }
  const statuses = {
    submitted: "SUBMITTED",
    queued: "SUBMITTED",
    pending: "SUBMITTED",
    in_progress: "IN_PROGRESS",
    processing: "IN_PROGRESS",
    running: "IN_PROGRESS",
    completed: "SUCCESS",
    success: "SUCCESS",
    failed: "FAILURE",
    failure: "FAILURE",
    cancelled: "FAILURE",
    canceled: "FAILURE",
  };
  const status = statuses[trimmed(data.status).toLowerCase()];
  if (!status) return { status: "UNKNOWN", reason: "unrecognized AM task status: " + String(data.status || "") };
  const result = {
    status: status,
    progress: status === "SUCCESS" || status === "FAILURE" ? "100%" : progressValue(data.progress) !== undefined ? String(progressValue(data.progress)) + "%" : "",
    reason: status === "FAILURE" ? failureReason(data, "AM image task failed") : "",
  };
  return result;
}

export function listArtifacts(task) {
  if (String(task && task.status || "").toUpperCase() !== "SUCCESS") return [];
  return providerImageURLs(task).map(function (url, index) {
    return { key: artifactKey(index, url), type: "image" };
  });
}

export function buildContentRequest(ctx) {
  const urls = providerImageURLs(ctx);
  for (let index = 0; index < urls.length; index += 1) {
    if (artifactKey(index, urls[index]) === ctx.artifactKey) {
      return { url: urls[index], method: ctx.clientRequest.method, credentialless: true };
    }
  }
  throw new Error("artifact_not_found");
}

export const native = {
  decodeImageGeneration: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const request = object(ctx.body.value, "request body must be an object");
    const model = trimmed(request.model);
    if (!isDeclaredModel(model)) throw new Error("unsupported AM image model");
    if (model === gpt26Ext || gpt26Models.has(model) || gpt25Models.has(model) || nanoBananaModels.has(model) || ["seedream-5-0-lite-am", "seedream-5-0-pro-am", "z-image-turbo-am"].includes(model)) {
      const normalized = normalizeAPIMartModelRequest(model, request);
      return { kind: "submit", model: model, action: "image_generation", requestBody: normalized };
    }
    if (!trimmed(request.prompt)) throw new Error("prompt is required");
    if (request.image_urls !== undefined && (!Array.isArray(request.image_urls) || request.image_urls.length > 15 || request.image_urls.some(function (url) { return !trimmed(url); }))) {
      throw new Error("image_urls must contain at most 15 non-empty URLs");
    }
    if (request.mask_url !== undefined && !trimmed(request.mask_url)) throw new Error("mask_url must be a non-empty URL");
    if (isOfficialGPTImage2(model)) {
      if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 4)) {
        throw new Error("n must be an integer between 1 and 4");
      }
      if (request.resolution !== undefined && !["1k", "2k", "4k"].includes(trimmed(request.resolution).toLowerCase())) {
        throw new Error("resolution must be one of 1k, 2k, or 4k");
      }
      if (request.quality !== undefined && !["auto", "low", "medium", "high"].includes(trimmed(request.quality).toLowerCase())) {
        throw new Error("quality must be one of auto, low, medium, or high");
      }
    } else {
      if (request.n !== undefined && request.n !== 1) throw new Error("n must be 1");
      if (request.resolution !== undefined && !["1k", "2k", "4k"].includes(trimmed(request.resolution).toLowerCase())) {
        throw new Error("resolution must be one of 1k, 2k, or 4k");
      }
      if (request.size !== undefined && !isSupportedGPTImage2Size(request.size)) {
        throw new Error("size must be auto, a supported ratio, or a pixel size up to 3840x3840");
      }
    }
    return { kind: "submit", model: model, action: "image_generation", requestBody: request };
  },
  renderSubmitted: function (ctx, task) {
    return { code: 200, data: [{ status: "submitted", task_id: task.task_id || "" }] };
  },
  renderTask: function (ctx, task) {
    const data = imageTaskData(task);
    const response = {
      id: task.task_id || "",
      status: publicStatus(task.status),
      progress: progressValue(task.progress),
    };
    if (data.actual_time !== undefined) response.actual_time = data.actual_time;
    if (data.created !== undefined) response.created = data.created;
    if (data.completed !== undefined) response.completed = data.completed;
    if (data.result !== undefined) response.result = data.result;
    const reason = failureReason(data, task.fail_reason);
    if (reason) response.error = { message: reason };
    return { code: 200, data: response };
  },
  error: function (ctx, error) {
    return { code: error.code, message: publicMessage(error.message) };
  },
};

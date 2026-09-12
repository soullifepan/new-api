// APIMart image-task integration. Keep this outside plugins/tasks: it is a
// local, uploadable extension rather than an embedded upstream plugin.
const nanoBananaModels = new Map([
  ["nano-banana-am", { upstream: "gemini-2.5-flash-image-preview-official", resolutions: ["1k"], maxImages: 1, credits: { "1k": 0.312 } }],
  ["nano-banana-2-am", { upstream: "gemini-3.1-flash-image-preview-official", resolutions: ["0.5k", "1k", "2k", "4k"], maxImages: 1, credits: { "0.5k": 0.536, "1k": 0.536, "2k": 0.808, "4k": 1.208 } }],
  ["nano-banana-pro-am", { upstream: "gemini-3-pro-image-preview-official", resolutions: ["1k", "2k", "4k"], maxImages: 1, credits: { "1k": 1.072, "2k": 1.072, "4k": 1.92 } }],
  ["nano-banana-2-lite-am", { upstream: "gemini-3.1-flash-lite-image", resolutions: ["1k"], maxImages: 4, credits: { "1k": 0.32 } }],
  ["nano-banana-ext-am", { upstream: "gemini-2.5-flash-image-preview", resolutions: ["1k"], maxImages: 1 }],
  ["nano-banana-2-ext-am", { upstream: "gemini-3.1-flash-image-preview", resolutions: ["0.5k", "1k", "2k", "4k"], maxImages: 1 }],
  ["nano-banana-pro-ext-am", { upstream: "gemini-3-pro-image-preview", resolutions: ["1k", "2k", "4k"], maxImages: 1 }],
  ["nano-banana-2-lite-ext-am", { upstream: "gemini-3.1-flash-lite-image-ext", resolutions: ["1k"], maxImages: 4 }],
]);
const nanoBananaRatios = new Set(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
const nanoBanana2Ratios = new Set([...nanoBananaRatios, "1:4", "4:1", "1:8", "8:1"]);
const nanoBananaFields = new Set(["model", "prompt", "size", "resolution", "n", "image_urls", "nsfw_check", "official_fallback", "google_search", "google_image_search"]);

export const meta = {
  apiVersion: 1,
  key: "am-image",
  name: "AM Image",
  icon: "text:AP",
  description: {
    en: "AM asynchronous image generation tasks",
    zh: "AM 异步图片生成任务",
  },
  version: "0.9.0",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  usageProfiles: (function () {
    const schemas = {
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
    "nano-banana-am",
    "nano-banana-2-am",
    "nano-banana-pro-am",
    "nano-banana-2-lite-am",
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
  const normalized = /^([12])x([12])$/.test(size) ? size.replace("x", ":") : size;
  if (!ratios.has(normalized)) throw new Error(errorMessage);
  return normalized;
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
    const output = {
      model: model,
      prompt: prompt,
      n: count,
      size: request.size === undefined ? "1:1" : normalizedRatio(request.size, model === "nano-banana-2-ext-am" || model === "nano-banana-2-am" ? nanoBanana2Ratios : nanoBananaRatios, "unsupported Nano Banana ratio"),
      resolution: banana.maxImages === 4 ? "1k" : resolution,
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
  return response.data && typeof response.data === "object" && !Array.isArray(response.data) ? response.data : {};
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
  const model = banana && (!upstreamModel || upstreamModel === publicModel) ? banana.upstream : upstreamModel || publicModel;
  if (banana && ![banana.upstream, publicModel.slice(0, -3)].includes(model)) {
    throw new Error("upstream model must match the Nano Banana " + (banana.credits ? "credit" : "ext") + " alias");
  }
  if (!isDeclaredModel(publicModel)) throw new Error("unsupported AM image model");
  const body = Object.assign({}, normalizeAPIMartModelRequest(publicModel, request), { model: model });
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
  if (Number(body.code) !== 200) throw new Error(publicMessage(body.message) || "AM image task submission failed");
  const entries = Array.isArray(body.data) ? body.data : [];
  const submitted = entries[0] && typeof entries[0] === "object" ? entries[0] : {};
  const taskId = trimmed(submitted.task_id);
  if (!taskId) throw new Error("AM submit response is missing task_id");
  const request = ctx && ctx.requestBody && typeof ctx.requestBody === "object" ? ctx.requestBody : {};
  const publicModel = trimmed(ctx && ctx.model || request.model);
  const normalized = publicModel === "seedream-5-0-pro-am" || nanoBananaModels.has(publicModel) ? normalizeAPIMartModelRequest(publicModel, request) : null;
  const billingUsage = normalized ? apimartUsage(normalized, publicModel) : null;
  return billingUsage
    ? { taskId: taskId, taskData: body, state: { billing_usage: billingUsage } }
    : { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const request = ctx.requestBody || {};
  const publicModel = trimmed(ctx.model || request.model);
  const normalized = normalizeAPIMartModelRequest(publicModel, request);
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
  const response = object(body, "invalid AM task response");
  if (Number(response.code) !== 200) {
    return { code: Number(response.code) || 0, status: "FAILURE", progress: "100%", reason: publicMessage(response.message) || "AM task query failed" };
  }
  const data = object(response.data, "AM task response is missing data");
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
    if (nanoBananaModels.has(model) || ["seedream-5-0-lite-am", "seedream-5-0-pro-am", "z-image-turbo-am"].includes(model)) {
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

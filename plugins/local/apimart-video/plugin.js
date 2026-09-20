// APIMart asynchronous video generation tasks.
// Public models use an -am suffix; channel model mappings select the documented
// APIMart model names. Sora and models without complete public pricing are not
// declared here.

const RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const VIDEO_FIELDS = new Set([
  "model", "prompt", "negative_prompt", "nsfw_check", "duration", "resolution",
  "size", "aspect_ratio", "seed", "watermark", "prompt_optimizer",
  "first_frame_image", "last_frame_image", "image_urls", "image_with_roles",
  "video_urls", "audio_url", "audio", "generate_audio", "generation_type",
  "prompt_extend",
]);

const MODELS = new Map([
  ["grok-imagine-1.5-video-am", {
    upstream: "grok-imagine-1.5-video-ext", seconds: [6, 15, 6], resolutions: ["480p", "720p"],
    ratios: new Set(["16:9", "9:16", "1:1", "3:2", "2:3"]), images: 7,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "size", "image_urls"]),
  }],
  ["kling-3.0-turbo-am", {
    upstream: "kling-3.0-turbo", seconds: [3, 15, 5], resolutions: ["720p", "1080p"],
    ratios: new Set(["16:9", "9:16", "1:1"]), firstFrame: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "first_frame_image", "watermark"]),
  }],
  ["minimax-hailuo-2.3-am", {
    upstream: "MiniMax-Hailuo-2.3", durations: [6, 10], defaultDuration: 6, resolutions: ["768p", "1080p"], firstFrame: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "first_frame_image", "prompt_optimizer", "watermark"]),
  }],
  ["minimax-hailuo-2.3-fast-am", {
    upstream: "MiniMax-Hailuo-2.3-Fast", durations: [6, 10], defaultDuration: 6, resolutions: ["768p", "1080p"], firstFrame: true, requireFirstFrame: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "first_frame_image", "prompt_optimizer", "watermark"]),
  }],
  ["pixverse-v6-am", {
    upstream: "pixverse-v6", seconds: [1, 15, 5], resolutions: ["360p", "540p", "720p", "1080p"], defaultResolution: "540p", ratios: new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"]), images: 2, audio: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "size", "seed", "negative_prompt", "audio", "watermark", "image_urls"]),
  }],
  ["viduq3-am", {
    upstream: "viduq3", seconds: [1, 16, 5], resolutions: ["540p", "720p", "1080p"], defaultResolution: "720p", ratios: RATIOS, images: 2, audio: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "image_urls", "audio", "seed"]),
  }],
  ["viduq3-pro-am", {
    upstream: "viduq3-pro", seconds: [1, 16, 5], resolutions: ["540p", "720p", "1080p"], defaultResolution: "720p", ratios: RATIOS, images: 2, audio: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "image_urls", "audio", "seed"]),
  }],
  ["viduq3-turbo-am", {
    upstream: "viduq3-turbo", seconds: [1, 16, 5], resolutions: ["540p", "720p", "1080p"], defaultResolution: "720p", ratios: RATIOS, images: 2, audio: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "image_urls", "audio", "seed"]),
  }],
  ["wan2.7-am", {
    upstream: "wan2.7", seconds: [2, 15, 5], resolutions: ["720p", "1080p"], defaultResolution: "1080p", ratios: RATIOS, images: 2, videos: 1,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "size", "image_urls", "image_with_roles", "video_urls", "audio_url", "negative_prompt", "prompt_extend", "watermark", "seed"]),
  }],
  ["happyhorse-1.0-am", {
    upstream: "happyhorse-1.0", seconds: [3, 15, 5], resolutions: ["720p", "1080p"], defaultResolution: "1080p", ratios: RATIOS, images: 9, firstFrame: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "size", "first_frame_image", "image_urls", "watermark", "seed"]),
  }],
  ["skyreels-v4-fast-am", {
    upstream: "skyreels-v4-fast", seconds: [3, 15, 5], resolutions: ["480p", "720p", "1080p"], ratios: RATIOS, images: 1, firstFrame: true,
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "first_frame_image", "image_urls", "prompt_optimizer", "watermark", "seed"]),
  }],
  ["veo3.1-fast-am", {
    upstream: "veo3.1-fast", durations: [8], defaultDuration: 8, resolutions: ["720p", "1080p", "4k"], ratios: new Set(["16:9", "9:16"]), images: 3, generationTypes: new Set(["frame", "reference"]),
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "image_urls", "generation_type"]),
  }],
  ["veo3.1-quality-am", {
    upstream: "veo3.1-quality", durations: [8], defaultDuration: 8, resolutions: ["720p", "1080p", "4k"], ratios: new Set(["16:9", "9:16"]), images: 2, generationTypes: new Set(["frame"]),
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio", "image_urls", "generation_type"]),
  }],
  ["veo3.1-lite-am", {
    upstream: "veo3.1-lite", durations: [8], defaultDuration: 8, resolutions: ["720p", "1080p", "4k"], ratios: new Set(["16:9", "9:16"]),
    fields: new Set(["model", "prompt", "nsfw_check", "duration", "resolution", "aspect_ratio"]),
  }],
]);

const SEEDANCE_FIELDS = new Set(["model", "prompt", "duration", "resolution", "size", "aspect_ratio", "generate_audio", "audio", "watermark", "nsfw_check", "seed", "output_format", "omni_reference_task_type", "image_urls", "image_with_roles", "video_urls", "audio_urls", "return_last_frame", "tools"]);
for (const [model, resolutions] of [
  ["seedance-2.0", ["480p", "720p", "1080p", "4k"]],
  ["seedance-2.0-fast", ["480p", "720p"]],
  ["seedance-2.0-mini", ["480p", "720p"]],
  ["seedance-2.5", ["480p", "720p", "1080p"]],
]) MODELS.set(model + "-am", { upstream: model, seconds: [4, model === "seedance-2.5" ? 30 : 15, 5], resolutions: resolutions, defaultResolution: "720p", fields: SEEDANCE_FIELDS });

// Estimated upstream credits per second. AM settles completed Seedance tasks in
// credits, where one credit is $0.1; completion usage replaces this estimate.
const SEEDANCE_CREDITS_PER_SECOND = {
  "seedance-2.0-am": { "480p": [0.66, 0.4], "720p": [1.42, 0.8584], "1080p": [3.544, 2.1568], "4k": [7.22, 4.4432] },
  "seedance-2.0-fast-am": { "480p": [0.3984, 0.2368], "720p": [0.856, 0.5128] },
  "seedance-2.0-mini-am": { "480p": [0.1056, 0.064], "720p": [0.2288, 0.1384] },
  "seedance-2.5-am": { "480p": [0.9608, 0.576], "720p": [2.16, 1.296], "1080p": [3.8488, 2.2992] },
};

function usageSchema(model) {
  const schema = {
    seconds: { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } },
    resolution: { enum: MODELS.get(model).resolutions, description: { en: "Output resolution", zh: "输出分辨率" } },
  };
  if (model === "pixverse-v6-am") schema.audio = { enum: ["off", "on"], description: { en: "Whether the paid audio track is enabled.", zh: "是否启用付费音轨。" } };
  if (model.startsWith("veo3.1-")) {
    delete schema.seconds;
    schema.requests = { type: "number", unit: "count", description: { en: "Completed video requests.", zh: "完成的视频请求次数。" } };
  }
  if (model.startsWith("seedance-")) {
    delete schema.seconds;
    delete schema.resolution;
    schema.upstream_credits = { type: "number", unit: "credit", description: { en: "AM settlement credit unit price", zh: "AM 结算积分单价" } };
  }
  return schema;
}

const schemas = {};
const examples = {};
for (const [model, spec] of MODELS) {
  schemas[model] = usageSchema(model);
  const facts = model.startsWith("veo3.1-")
    ? { requests: 1, resolution: spec.defaultResolution || spec.resolutions[0] }
    : { seconds: spec.defaultDuration || spec.seconds[2], resolution: spec.defaultResolution || spec.resolutions[0] };
  if (model === "pixverse-v6-am") facts.audio = "off";
  if (model.startsWith("seedance-")) {
    examples[model] = Object.entries(SEEDANCE_CREDITS_PER_SECOND[model]).map(function (entry) {
      return { label: entry[0] + " · 5s", facts: { upstream_credits: Math.round(entry[1][0] * 5 * 1e8) / 1e8 } };
    });
  } else examples[model] = [{ label: "Default", facts: facts }];
}

export const meta = {
  apiVersion: 1,
  key: "am-video",
  name: "AM Video",
  icon: "text:AV",
  description: { en: "Validated AM asynchronous video generation tasks.", zh: "经过逐模型校验的 AM 异步视频生成任务。" },
  version: "0.3.2",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  allowedHosts: ["api.apib.ai", "api.apimart.ai", "upload.apimart.ai", "cdn.apimart.ai"],
  models: Array.from(MODELS.keys()),
  usageProfiles: Array.from(MODELS.keys()).map(function (model) {
    return { models: [model], schema: schemas[model], examples: examples[model] };
  }),
  routes: [
    { method: "POST", path: "/am/video/v1/videos/generations", type: "submit", action: "video_generation", decode: "decodeVideoGeneration", render: "renderSubmitted" },
    { method: "GET", path: "/am/video/v1/tasks/:task_id", type: "query", render: "renderTask" },
    { method: "POST", path: "/am/video/v1/seedance/assets", type: "submit", action: "asset", decode: "decodeSeedanceAssets", render: "renderSubmitted" },
  ],
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function publicMessage(value) {
  return text(value).replace(/\b(?:APIMart|APIB)\b/gi, "AM");
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function boolean(value, field) {
  if (typeof value !== "boolean") throw new Error(field + " must be a boolean");
  return value;
}

function integer(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(field + " must be an integer between " + minimum + " and " + maximum);
  }
  return value;
}

function normalizedResolution(value, spec) {
  const resolution = text(value || spec.defaultResolution || spec.resolutions[0]).toLowerCase();
  if (!spec.resolutions.includes(resolution)) throw new Error("unsupported resolution");
  return resolution;
}

function mediaURL(value, field, allowData) {
  const url = text(value);
  const validHTTP = /^https?:\/\/[^\s/@?#]+(?:[/?#][^\s]*)?$/i.test(url);
  const validData = allowData && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(url);
  if (!url || url.length > 14 * 1024 * 1024 || (!validHTTP && !validData)) throw new Error(field + " must be a valid media URL" + (allowData ? " or image data URL" : ""));
  return url;
}

function urlArray(value, field, maximum) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new Error(field + " must contain 1 to " + maximum + " URLs");
  return value.map(function (url) { return mediaURL(url, field, false); });
}

// Public references identify an owned gateway task and an item, never a raw
// provider asset id. The host checks ownership and pins the original channel.
function seedanceURL(value, field) {
  if (/^am-asset:\/\/[A-Za-z0-9_-]+\/[0-9]{1,2}$/.test(text(value))) return text(value);
  return mediaURL(value, field, false);
}

function normalizeSeedance(model, request) {
  const spec = MODELS.get(model);
  const v25 = model === "seedance-2.5-am";
  for (const field of Object.keys(request)) {
    if (!SEEDANCE_FIELDS.has(field) || (!v25 && ["aspect_ratio", "audio", "watermark", "output_format", "omni_reference_task_type"].includes(field))) throw new Error("unsupported field for " + model + ": " + field);
  }
  if (request.model !== undefined && request.model !== model) throw new Error("model must be " + model);
  const body = { model: model, resolution: normalizedResolution(request.resolution, spec) };
  const mode = request.omni_reference_task_type === undefined ? "auto" : request.omni_reference_task_type;
  if (!["auto", "reference", "edit", "extend"].includes(mode)) throw new Error("unsupported omni_reference_task_type");
  body.duration = request.duration === undefined ? (mode === "edit" ? -1 : 5) : request.duration;
  if (!(v25 && body.duration === -1)) integer(body.duration, "duration", 4, v25 ? 30 : 15);
  if (request.size !== undefined && request.aspect_ratio !== undefined && request.size !== request.aspect_ratio) throw new Error("size and aspect_ratio conflict");
  body.size = request.size === undefined ? (request.aspect_ratio === undefined ? (v25 ? "adaptive" : "16:9") : request.aspect_ratio) : request.size;
  if (!["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(body.size)) throw new Error("unsupported aspect ratio");
  for (const field of ["image_urls", "video_urls", "audio_urls"]) {
    if (request[field] === undefined) continue;
    const maximum = field === "image_urls" ? (v25 ? 30 : 9) : (v25 ? 10 : 3);
    if (!Array.isArray(request[field]) || !request[field].length || request[field].length > maximum) throw new Error(field + " exceeds the model input limit");
    body[field] = request[field].map(function (url) { return seedanceURL(url, field); });
  }
  if (request.image_with_roles !== undefined) {
    const entries = request.image_with_roles;
    if (!Array.isArray(entries) || !entries.length || entries.length > (v25 ? 32 : 9)) throw new Error("invalid image_with_roles count");
    const counts = { first_frame: 0, last_frame: 0, reference_image: 0 };
    body.image_with_roles = entries.map(function (entry) {
      object(entry, "invalid image role entry");
      if (!Object.keys(entry).every(function (key) { return key === "url" || key === "role"; }) || !Object.prototype.hasOwnProperty.call(counts, entry.role)) throw new Error("unsupported image role");
      const role = v25 && (body.video_urls || body.audio_urls) ? "reference_image" : entry.role;
      counts[role] += 1;
      return { url: seedanceURL(entry.url, "image_with_roles.url"), role: role };
    });
    if (counts.first_frame > 1 || counts.last_frame > 1 || counts.reference_image + (body.image_urls || []).length > (v25 ? 30 : 9)) throw new Error("image role count exceeds model limit");
    if (!v25 && body.image_urls) throw new Error("image_urls and image_with_roles are mutually exclusive");
    if (counts.first_frame || counts.last_frame) {
      if (!v25 && (body.video_urls || body.audio_urls)) throw new Error("first/last frames conflict with reference video or audio");
      if (v25 && body.size !== "adaptive") throw new Error("first/last-frame tasks require adaptive size");
    }
  }
  if (!v25 && body.audio_urls && !body.video_urls && !body.image_urls && !body.image_with_roles) throw new Error("Seedance 2.0 audio requires image or video input");
  const prompt = text(request.prompt);
  if (!prompt && (v25 || !(body.image_urls || body.image_with_roles || body.video_urls))) throw new Error("prompt is required");
  if (!model.includes("mini") && prompt.length > 4000) throw new Error("prompt is too long");
  if (prompt) body.prompt = prompt;
  if (request.generate_audio !== undefined && request.audio !== undefined && request.generate_audio !== request.audio) throw new Error("generate_audio and audio conflict");
  body.generate_audio = request.generate_audio === undefined ? (request.audio === undefined ? true : boolean(request.audio, "audio")) : boolean(request.generate_audio, "generate_audio");
  for (const field of ["nsfw_check", "watermark", "return_last_frame"]) if (request[field] !== undefined) body[field] = boolean(request[field], field);
  if (request.seed !== undefined) body.seed = integer(request.seed, "seed", -1, 4294967295);
  if (request.output_format !== undefined) {
    if (!["mp4", "mov"].includes(request.output_format)) throw new Error("unsupported output_format");
    body.output_format = request.output_format;
  }
  if (request.tools !== undefined) {
    if (!Array.isArray(request.tools) || request.tools.length !== 1 || !request.tools[0] || request.tools[0].type !== "web_search" || Object.keys(request.tools[0]).length !== 1) throw new Error("only web_search is supported");
    body.tools = [{ type: "web_search" }];
  }
  if (v25) {
    body.omni_reference_task_type = mode;
    if (["edit", "extend"].includes(mode) && (!body.video_urls || body.size !== "adaptive")) throw new Error("edit/extend requires reference video and adaptive size");
    if (mode === "edit" && body.duration !== -1) throw new Error("edit requires automatic duration");
  }
  return body;
}

function assetReferences(body) {
  const refs = [];
  for (const field of ["image_urls", "video_urls", "audio_urls", "image_with_roles"]) {
    for (const entry of body[field] || []) {
      const url = typeof entry === "string" ? entry : entry.url;
      if (url.startsWith("am-asset://")) {
        const id = url.slice(11).split("/")[0];
        if (!refs.includes(id)) refs.push(id);
      }
    }
  }
  return refs;
}

function normalizeAssets(request) {
  object(request, "asset request must be an object");
  if (!MODELS.has(request.model) || !request.model.startsWith("seedance-")) throw new Error("unsupported Seedance asset model");
  if (!Object.keys(request).every(function (key) { return ["model", "asset_type", "assets", "group"].includes(key); })) throw new Error("unsupported asset field; raw group identifiers are not accepted");
  if (!["Image", "Video", "Audio"].includes(request.asset_type)) throw new Error("asset_type must be Image, Video or Audio");
  if (!Array.isArray(request.assets) || !request.assets.length || request.assets.length > 20) throw new Error("assets must contain 1 to 20 entries");
  const body = { model: request.model, asset_type: request.asset_type, assets: request.assets.map(function (asset) {
    object(asset, "invalid asset");
    if (!Object.keys(asset).every(function (key) { return key === "url" || key === "name"; })) throw new Error("unsupported asset field");
    const name = text(asset.name);
    if (name.length > 128) throw new Error("asset name is too long");
    return { url: mediaURL(asset.url, "asset.url", false), name: name || "asset" };
  }) };
  if (request.group !== undefined) {
    object(request.group, "invalid group");
    if (!Object.keys(request.group).every(function (key) { return key === "name"; }) || !text(request.group.name) || text(request.group.name).length > 128) throw new Error("invalid group name");
    body.group = { name: text(request.group.name) };
  }
  return body;
}

function normalize(model, request) {
  object(request, "video generation request must be an object");
  const spec = MODELS.get(model);
  if (!spec) throw new Error("unsupported AM video model");
  if (model.startsWith("seedance-")) return normalizeSeedance(model, request);
  for (const field of Object.keys(request)) {
    if (!VIDEO_FIELDS.has(field) || !spec.fields.has(field)) throw new Error("unsupported field for " + model + ": " + field);
  }
  if (request.model !== undefined && request.model !== model) throw new Error("model must be " + model);

  const body = { model: model };
  const prompt = text(request.prompt);
  const hasMedia = request.first_frame_image !== undefined || request.image_urls !== undefined || request.image_with_roles !== undefined || request.video_urls !== undefined;
  const optionalMediaPrompt = hasMedia && (["viduq3-am", "viduq3-pro-am", "viduq3-turbo-am", "wan2.7-am"].includes(model)
    || (["kling-3.0-turbo-am", "happyhorse-1.0-am"].includes(model) && request.first_frame_image !== undefined));
  if (!prompt && !optionalMediaPrompt) throw new Error("prompt is required");
  if (prompt.length > (model === "minimax-hailuo-2.3-am" || model === "minimax-hailuo-2.3-fast-am" ? 2000 : model === "kling-3.0-turbo-am" ? 3072 : 5000)) throw new Error("prompt is too long");
  if (prompt) body.prompt = prompt;

  const duration = request.duration === undefined ? (spec.defaultDuration || spec.seconds[2]) : request.duration;
  if (spec.durations) {
    if (!spec.durations.includes(duration)) throw new Error("unsupported duration");
  } else {
    integer(duration, "duration", spec.seconds[0], spec.seconds[1]);
  }
  const resolution = normalizedResolution(request.resolution, spec);
  if ((model === "minimax-hailuo-2.3-am" || model === "minimax-hailuo-2.3-fast-am") && resolution === "1080p" && duration !== 6) throw new Error("1080p Hailuo video must be 6 seconds");
  body.duration = duration;
  body.resolution = resolution;

  const ratioField = spec.fields.has("aspect_ratio") ? "aspect_ratio" : spec.fields.has("size") ? "size" : "";
  const mediaDeterminesRatio = (request.first_frame_image !== undefined && ["kling-3.0-turbo-am", "happyhorse-1.0-am", "skyreels-v4-fast-am"].includes(model))
    || (request.image_urls !== undefined && ["grok-imagine-1.5-video-am", "viduq3-am", "viduq3-pro-am", "viduq3-turbo-am", "wan2.7-am", "skyreels-v4-fast-am"].includes(model))
    || (request.image_with_roles !== undefined && model === "wan2.7-am")
    || (request.video_urls !== undefined && model === "wan2.7-am");
  if (ratioField && !mediaDeterminesRatio) {
    const ratio = text(request[ratioField] || "16:9");
    if (!spec.ratios.has(ratio)) throw new Error("unsupported aspect ratio");
    body[ratioField] = ratio;
  }
  if (request.first_frame_image !== undefined) body.first_frame_image = mediaURL(request.first_frame_image, "first_frame_image", true);
  if (spec.requireFirstFrame && body.first_frame_image === undefined) throw new Error("first_frame_image is required");
  if (request.image_urls !== undefined) body.image_urls = urlArray(request.image_urls, "image_urls", spec.images);
  if (body.first_frame_image !== undefined && body.image_urls !== undefined) throw new Error("first_frame_image and image_urls are mutually exclusive");

  if (request.image_with_roles !== undefined) {
    if (!Array.isArray(request.image_with_roles) || request.image_with_roles.length < 1 || request.image_with_roles.length > 2) throw new Error("image_with_roles must contain 1 or 2 entries");
    body.image_with_roles = request.image_with_roles.map(function (entry) {
      object(entry, "image_with_roles entries must be objects");
      if (!Object.keys(entry).every(function (key) { return key === "url" || key === "role"; })) throw new Error("unsupported image_with_roles field");
      const role = entry.role === undefined ? "first_frame" : entry.role;
      if (!["first_frame", "last_frame"].includes(role)) throw new Error("image role must be first_frame or last_frame");
      return { url: mediaURL(entry.url, "image_with_roles.url", false), role: role };
    });
  }
  if (body.image_urls !== undefined && body.image_with_roles !== undefined) throw new Error("image_urls and image_with_roles are mutually exclusive");
  if (request.video_urls !== undefined) body.video_urls = urlArray(request.video_urls, "video_urls", spec.videos);
  if (body.video_urls !== undefined && (body.image_urls !== undefined || body.image_with_roles && body.image_with_roles.some(function (entry) { return entry.role === "first_frame"; }))) throw new Error("video_urls conflicts with first-frame input");
  if (request.audio_url !== undefined) {
    body.audio_url = mediaURL(request.audio_url, "audio_url", false);
    if (body.video_urls !== undefined) throw new Error("audio_url and video_urls are mutually exclusive");
  }

  for (const field of ["nsfw_check", "watermark", "prompt_optimizer", "prompt_extend", "audio", "generate_audio"]) {
    if (request[field] !== undefined) body[field] = boolean(request[field], field);
  }
  if (request.negative_prompt !== undefined) {
    if (typeof request.negative_prompt !== "string" || request.negative_prompt.length > 2048) throw new Error("negative_prompt is too long");
    body.negative_prompt = request.negative_prompt;
  }
  if (request.seed !== undefined) body.seed = integer(request.seed, "seed", model.startsWith("viduq3-") ? -1 : 0, 4294967295);
  if (request.generation_type !== undefined) {
    if (!spec.generationTypes || !spec.generationTypes.has(request.generation_type)) throw new Error("unsupported generation_type");
    body.generation_type = request.generation_type;
  }
  if (model === "pixverse-v6-am" && body.image_urls && body.image_urls.length === 2 && ![5, 8].includes(duration)) throw new Error("Pixverse first/last-frame mode requires 5 or 8 seconds");
  if (model.startsWith("veo3.1-") && body.generation_type === "frame" && (!body.image_urls || body.image_urls.length !== 2)) throw new Error("Veo frame mode requires exactly 2 images");
  if (model === "veo3.1-fast-am" && body.generation_type === "reference" && (!body.image_urls || body.image_urls.length !== 3)) throw new Error("Veo reference mode requires exactly 3 images");
  return body;
}

function taskData(task) {
  const snapshot = task && task.data;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};
  const response = snapshot.response && typeof snapshot.response === "object" && !Array.isArray(snapshot.response) ? snapshot.response : snapshot;
  return response.data && typeof response.data === "object" && !Array.isArray(response.data) ? response.data : {};
}

function progress(value) {
  const parsed = Number(String(value === undefined || value === null ? "" : value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : undefined;
}

function failure(data, fallback) {
  if (data.error && typeof data.error === "object" && text(data.error.message)) return publicMessage(data.error.message);
  return publicMessage(data.error) || publicMessage(data.message) || publicMessage(fallback);
}

function videoURLs(task) {
  const data = taskData(task);
  const result = data.result && typeof data.result === "object" ? data.result : {};
  const urls = [];
  function add(value) {
    if (typeof value === "string" && /^https?:\/\//i.test(value) && !urls.includes(value)) urls.push(value);
    if (Array.isArray(value)) for (const item of value) add(item && typeof item === "object" ? item.url : item);
  }
  add(data.video_url);
  add(data.output && data.output.video_url);
  add(result.video_url);
  add(result.video_urls);
  add(result.videos);
  return urls;
}

function artifactKey(index, url) {
  return "video-" + index + "-" + utils.hmacSHA256(url, "new-api:apimart-video:artifact-key");
}

export function buildSubmitRequest(ctx) {
  const request = object(ctx.requestBody, "video generation request is required");
  const publicModel = text(ctx.model || request.model);
  const spec = MODELS.get(publicModel);
  if (!spec) throw new Error("unsupported AM video model");
  const upstream = text(ctx.upstreamModel);
  if (upstream && upstream !== publicModel && upstream !== spec.upstream) throw new Error("upstream model does not match the public video model");
  const body = ctx.action === "asset" ? normalizeAssets(request) : normalize(publicModel, request);
  body.model = upstream && upstream !== publicModel ? upstream : spec.upstream;
  if (publicModel.startsWith("seedance-") && ctx.action !== "asset") {
    for (const field of ["image_urls", "video_urls", "audio_urls", "image_with_roles"]) {
      if (!body[field]) continue;
      body[field] = body[field].map(function (entry) {
        const url = typeof entry === "string" ? entry : entry.url;
        if (!url.startsWith("am-asset://")) return entry;
        const parts = url.slice(11).split("/");
        const origin = (ctx.originTasks || []).find(function (task) { return task.taskId === parts[0] && task.action === "asset"; });
        if (!origin) throw new Error("asset reference is not an owned Seedance asset task");
        const data = taskData(origin);
        const assets = data.result && data.result.usable_assets;
        const asset = Array.isArray(assets) && assets[Number(parts[1])];
        if (!asset || asset.status !== "Active" || !/^asset:\/\/[A-Za-z0-9_-]+$/.test(asset.asset_url)) throw new Error("asset is not available");
        return typeof entry === "string" ? asset.asset_url : { url: asset.asset_url, role: entry.role };
      });
    }
  }
  return {
    url: ctx.baseUrl + (ctx.action === "asset" ? "/v1/seedance2/private-avatar/assets" : "/v1/videos/generations"),
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: ctx.action === "asset" ? "asset" : "video_generation",
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid AM submit response");
  if (Number(body.code) !== 200) throw new Error(publicMessage(body.message) || failure(body, "AM video task submission failed"));
  const entry = ctx.action === "asset" ? body.data || {} : Array.isArray(body.data) && body.data[0] && typeof body.data[0] === "object" ? body.data[0] : {};
  const taskId = text(ctx.action === "asset" ? entry.id : entry.task_id);
  if (!taskId) throw new Error("AM submit response is missing task_id");
  return { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const request = ctx.requestBody || {};
  const model = text(ctx.model || request.model);
  if (model.startsWith("seedance-")) {
    const asset = ctx.action === "asset";
    const body = asset ? normalizeAssets(request) : normalize(model, request);
    if (asset) return { upstream_credits: 0 };
    const hasVideo = !asset && !!body.video_urls;
    // Remote media durations are not client-trusted billing facts. Reserve the
    // documented total-input ceiling; final cost replaces this estimate.
    const seconds = body.duration === -1 ? 30 : body.duration;
    const inputSeconds = hasVideo ? (model === "seedance-2.5-am" ? 30 : 15.2) : 0;
    const rates = SEEDANCE_CREDITS_PER_SECOND[model][body.resolution || "720p"];
    const rate = rates[hasVideo ? 1 : 0];
    return { upstream_credits: Math.round((seconds + inputSeconds) * rate * 1e8) / 1e8 };
  }
  const body = normalize(model, request);
  const usage = { resolution: body.resolution };
  if (model.startsWith("veo3.1-")) usage.requests = 1;
  else usage.seconds = body.duration;
  if (model === "pixverse-v6-am") usage.audio = body.audio === true ? "on" : "off";
  return usage;
}

function seedanceCost(data) {
  // Only the authenticated upstream response is accepted. $100 is a safety
  // ceiling above the documented single-task maximum, not a pricing rate.
  const cost = data.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > 100) throw new Error("AM completed task has invalid cost");
  if (data.credits_cost !== undefined && (typeof data.credits_cost !== "number" || !Number.isFinite(data.credits_cost) || Math.abs(data.credits_cost - cost * 10) > 0.00001)) throw new Error("AM cost and credits_cost disagree");
  return Math.round(cost * 1e9) / 1e8;
}

export function extractUsageOnComplete(ctx, result, body) {
  if (!String(ctx.model || "").startsWith("seedance-") || ctx.action === "asset") return null;
  if (result.status !== "SUCCESS") return null;
  return { upstream_credits: seedanceCost(object(body.data, "missing AM task data")) };
}

export function buildQueryRequest(ctx) {
  const taskId = text(ctx.taskId);
  if (!taskId) throw new Error("task_id is required");
  return { url: ctx.baseUrl + "/v1/tasks/" + encodeURIComponent(taskId), method: "GET", headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey } };
}

export function parseTaskResult(ctx, body) {
  const response = object(body, "invalid AM task response");
  if (Number(response.code) !== 200) return { code: Number(response.code) || 0, status: "FAILURE", progress: "100%", reason: failure(response, "AM video task query failed") };
  const data = object(response.data, "AM task response is missing data");
  const statuses = { submitted: "SUBMITTED", queued: "SUBMITTED", pending: "SUBMITTED", in_progress: "IN_PROGRESS", processing: "IN_PROGRESS", running: "IN_PROGRESS", completed: "SUCCESS", succeeded: "SUCCESS", success: "SUCCESS", failed: "FAILURE", failure: "FAILURE", cancelled: "FAILURE", canceled: "FAILURE" };
  const status = statuses[text(data.status).toLowerCase()];
  if (status === "SUCCESS" && String(ctx.model || "").startsWith("seedance-") && ctx.action !== "asset") seedanceCost(data);
  if (!status) return { status: "UNKNOWN", reason: "unrecognized AM task status: " + String(data.status || "") };
  const value = progress(data.progress);
  return { status: status, progress: status === "SUCCESS" || status === "FAILURE" ? "100%" : value === undefined ? "" : value + "%", reason: status === "FAILURE" ? failure(data, "AM video task failed") : "" };
}

export function listArtifacts(task) {
  if (String(task && task.status || "").toUpperCase() !== "SUCCESS") return [];
  return videoURLs(task).map(function (url, index) { return { key: artifactKey(index, url), type: "video" }; });
}

export function buildContentRequest(ctx) {
  const urls = videoURLs(ctx);
  for (let index = 0; index < urls.length; index += 1) {
    if (artifactKey(index, urls[index]) === ctx.artifactKey) return { url: urls[index], method: ctx.clientRequest.method, credentialless: true };
  }
  throw new Error("artifact_not_found");
}

export const native = {
  decodeSeedanceAssets: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = normalizeAssets(ctx.body.value);
    return { kind: "submit", model: body.model, action: "asset", requestBody: body };
  },
  decodeVideoGeneration: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const request = object(ctx.body.value, "request body must be an object");
    const model = text(request.model);
    const body = normalize(model, request);
    const intent = { kind: "submit", model: model, action: "video_generation", requestBody: body };
    if (model.startsWith("seedance-")) {
      const refs = assetReferences(body);
      if (refs.length) intent.originTaskIds = refs;
    }
    return intent;
  },
  renderSubmitted: function (_ctx, task) {
    return { code: 200, data: [{ status: "submitted", task_id: task.task_id || "" }] };
  },
  renderTask: function (_ctx, task) {
    const data = taskData(task);
    const statusMap = { SUBMITTED: "submitted", QUEUED: "submitted", IN_PROGRESS: "processing", SUCCESS: "completed", FAILURE: "failed" };
    const response = { id: task.task_id || "", status: statusMap[String(task.status || "").toUpperCase()] || "submitted", progress: progress(task.progress) };
    if (data.created !== undefined) response.created = data.created;
    if (data.completed !== undefined) response.completed = data.completed;
    if (data.result !== undefined) {
      if (task.action === "asset" || Array.isArray(data.result.usable_assets)) {
        const usableAssets = Array.isArray(data.result.usable_assets) ? data.result.usable_assets : [];
        response.result = { usable_assets: usableAssets.map(function (asset, index) {
          return { asset_url: "am-asset://" + task.task_id + "/" + index, status: asset.status };
        }), failed_count: Array.isArray(data.result.failed_assets) ? data.result.failed_assets.length : 0 };
      } else response.result = data.result;
    }
    const reason = failure(data, task.fail_reason);
    if (reason) response.error = { message: reason };
    return { code: 200, data: response };
  },
  error: function (_ctx, error) { return { code: error.code, message: publicMessage(error.message) }; },
};

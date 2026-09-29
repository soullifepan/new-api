// Seedance Hub exposes Volcengine's native video and asset APIs through a
// type-61 channel. Asset Action responses preserve the provider's native IDs.

const ASSET_ROUTING_MODEL = "doubao-seedance-2-0-hub";
const VERSION = "2024-01-01";
const VIDEO_MODELS = new Map([
  ["doubao-seedance-2-0-hub", ["480p", "720p", "1080p", "4k", 15]],
  ["doubao-seedance-2-0-fast-hub", ["480p", "720p", 15]],
  ["doubao-seedance-2-0-mini-hub", ["480p", "720p", 15]],
  ["doubao-seedance-2-5-hub", ["480p", "720p", "1080p", 30]],
]);
const UPSTREAM_MODELS = new Map([
  ["doubao-seedance-2-0-hub", "doubao-seedance-2-0-260128"],
  ["doubao-seedance-2-0-fast-hub", "doubao-seedance-2-0-fast-260128"],
  ["doubao-seedance-2-0-mini-hub", "doubao-seedance-2-0-mini-260615"],
  ["doubao-seedance-2-5-hub", "doubao-seedance-2-5-260628"],
]);
const EXAMPLE_TOKENS = {
  "doubao-seedance-2-0-hub": { "480p": 50220, "720p": 108000, "1080p": 243000, "4k": 972000 },
  "doubao-seedance-2-0-fast-hub": { "480p": 50220, "720p": 108000 },
  "doubao-seedance-2-0-mini-hub": { "480p": 50220, "720p": 108000 },
  "doubao-seedance-2-5-hub": { "480p": 48037.5, "720p": 108000, "1080p": 243000 },
};
const ASSET_ACTIONS = new Set([
  "CreateAssetGroup", "ListAssetGroups", "GetAssetGroup", "UpdateAssetGroup", "DeleteAssetGroup",
  "CreateAsset", "ListAssets", "GetAsset", "UpdateAsset", "DeleteAsset",
  "CreateVisualValidateSession", "GetVisualValidateResult",
]);

const VIDEO_FIELDS = new Set(["model", "content", "duration", "resolution", "ratio", "watermark", "generate_audio", "return_last_frame"]);
const VIDEO_25_FIELDS = new Set(["omni_reference_task_type", "output_format"]);

export const meta = {
  apiVersion: 1,
  key: "seedance-hub",
  name: "Seedance Hub",
  icon: "Doubao.Color",
  description: { en: "Seedance video generation and owned asset management through the Hub API", zh: "通过 Hub API 生成 Seedance 视频并管理归属素材" },
  version: "2.1.0",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  models: [...VIDEO_MODELS.keys()],
  usageProfiles: [...VIDEO_MODELS.keys()].map(function (model) {
    return {
      models: [model],
      schema: {
        tokens: { type: "number", unit: "token", description: { en: "Video generation token unit price", zh: "视频生成 Token 单价" } },
        resolution: { enum: VIDEO_MODELS.get(model).slice(0, -1), description: { en: "Output video resolution", zh: "输出视频分辨率" } },
        video_input: { enum: ["none", "video"], description: { en: "Reference video input", zh: "参考视频输入" } },
      },
      examples: VIDEO_MODELS.get(model).slice(0, -1).map(function (resolution) {
        return { label: resolution + " · 5s · 16:9 output estimate", facts: { tokens: EXAMPLE_TOKENS[model][resolution], resolution: resolution, video_input: "none" } };
      }),
    };
  }),
  routes: [
    { method: "POST", path: "/seedance-hub/v1/api/asset", type: "dynamic", decode: "decodeAssetAction", render: "renderAsset" },
    { method: "POST", path: "/seedance-hub/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/seedance-hub/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
};

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function bodyValue(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  return object(ctx.body.value, "request body must be an object");
}
function actionValue(ctx) {
  const values = ctx.query && ctx.query.Action;
  const action = Array.isArray(values) ? text(values[0]) : "";
  if (!ASSET_ACTIONS.has(action)) throw new Error("unsupported asset Action");
  return action;
}
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) result[key] = copy(value[key]);
    return result;
  }
  return value;
}
// Contract: https://www.volcengine.com/docs/82379/1520757 (2026-09-22).
// Media bytes (duration, total input seconds, dimensions, codec) are checked by
// the provider: native URLs and asset IDs do not carry trustworthy media facts.
function validateContent(content, v25) {
  if (!Array.isArray(content) || !content.length) throw new Error("content must be a non-empty array");
  const counts = { first_frame: 0, last_frame: 0, reference_image: 0, reference_video: 0, reference_audio: 0 };
  for (const item of content) {
    object(item, "content items must be objects");
    if (item.type === "text") {
      if (!text(item.text)) throw new Error("text content must be non-empty");
      for (const key of Object.keys(item)) if (!["type", "text"].includes(key)) throw new Error("unsupported text content field: " + key);
      // Weak prompt flags can override validated billing parameters upstream.
      if (/(?:^|\s)--(?:rs|rt|dur|fps|frames|resolution|ratio|duration)(?=\s|=|$)/i.test(item.text)) throw new Error("use top-level video parameters instead of prompt flags");
      continue;
    }
    if (!["image_url", "video_url", "audio_url"].includes(item.type)) throw new Error("unsupported content type");
    const fields = ["type", "role", item.type];
    for (const key of Object.keys(item)) if (!fields.includes(key)) throw new Error("unsupported media content field: " + key);
    const media = object(item[item.type], item.type + " must be an object");
    for (const key of Object.keys(media)) if (key !== "url") throw new Error("unsupported media URL field: " + key);
    const url = media.url;
    const dataURL = item.type === "image_url" ? /^data:image\/(?:jpeg|png|webp|bmp|tiff|gif|heic|heif);base64,[A-Za-z0-9+/]+={0,2}$/ : /^data:audio\/(?:wav|mp3|mpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
    if (typeof url !== "string" || !(/^(?:https?:\/\/[^\s/?#]+[^\s]*|asset:\/\/[A-Za-z0-9_-]{1,256})$/.test(url) || (item.type !== "video_url" && dataURL.test(url)))) throw new Error("invalid native asset reference or media URL");
    const defaultRole = item.type === "image_url" ? "first_frame" : item.type === "video_url" ? "reference_video" : "reference_audio";
    const role = own(item, "role") ? item.role : defaultRole;
    const roles = item.type === "image_url" ? ["first_frame", "last_frame", "reference_image"] : [defaultRole];
    if (!roles.includes(role)) throw new Error("invalid role for " + item.type);
    counts[role]++;
  }
  if (counts.first_frame > 1 || counts.last_frame > 1 || (counts.last_frame && !counts.first_frame)) throw new Error("use one first frame and at most one last frame");
  const references = counts.reference_image + counts.reference_video + counts.reference_audio;
  if ((counts.first_frame || counts.last_frame) && references) throw new Error("first/last frames cannot be mixed with reference media");
  if (counts.reference_image > (v25 ? 30 : 9) || counts.reference_video > (v25 ? 10 : 3) || counts.reference_audio > (v25 ? 10 : 3)) throw new Error("too many reference media for this model");
  if (!v25 && counts.reference_audio && !counts.reference_image && !counts.reference_video) throw new Error("Seedance 2.0 audio requires a reference image or video");
  return counts;
}
function validateVideo(body) {
  const model = text(body.model);
  const spec = VIDEO_MODELS.get(model);
  if (!spec) throw new Error("unsupported Seedance model");
  const v25 = model === "doubao-seedance-2-5-hub";
  for (const field of Object.keys(body)) {
    if (!VIDEO_FIELDS.has(field) && !(v25 && VIDEO_25_FIELDS.has(field))) throw new Error("unsupported video field: " + field);
  }
  const counts = validateContent(body.content, v25);
  // Keep the deployed 2.0 default; 2.5 defaults to the official automatic mode.
  const duration = own(body, "duration") ? body.duration : v25 ? -1 : 5;
  if (!Number.isInteger(duration) || (duration !== -1 && (duration < 4 || duration > spec[spec.length - 1]))) throw new Error("duration is outside the supported range");
  const resolution = own(body, "resolution") ? text(body.resolution).toLowerCase() : "720p";
  if (!spec.slice(0, -1).includes(resolution)) throw new Error("unsupported resolution");
  const ratio = own(body, "ratio") ? body.ratio : "adaptive";
  if (!["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"].includes(ratio)) throw new Error("unsupported ratio");
  for (const field of ["watermark", "generate_audio", "return_last_frame"]) if (own(body, field) && typeof body[field] !== "boolean") throw new Error(field + " must be boolean");
  if (own(body, "output_format") && !["mp4", "mov"].includes(body.output_format)) throw new Error("unsupported output_format");
  const taskType = own(body, "omni_reference_task_type") ? body.omni_reference_task_type : "auto";
  if (!["auto", "reference", "edit", "extend"].includes(taskType)) throw new Error("unsupported omni_reference_task_type");
  if (own(body, "omni_reference_task_type") && !(counts.reference_image + counts.reference_video + counts.reference_audio)) throw new Error("omni_reference_task_type requires reference media");
  if (taskType === "edit" || taskType === "extend") {
    if (!counts.reference_video) throw new Error(taskType + " requires reference video input");
    if (ratio !== "adaptive") throw new Error(taskType + " requires adaptive ratio");
    if (taskType === "edit" && duration !== -1) throw new Error("edit requires automatic duration (-1)");
  }
  if (v25 && counts.first_frame && ratio !== "adaptive") throw new Error("Seedance 2.5 first/last frames require adaptive ratio");
  const request = copy(body);
  request.duration = duration;
  request.resolution = resolution;
  request.ratio = ratio;
  return { model: model, request: request };
}
// Native decoding keeps the auto sentinel out of the host's canonical numeric
// duration guard. This internal flag is never accepted from the public body or
// sent upstream; transport and billing reconstruct and validate the same input.
function validatedVideoRequest(ctx) {
  const request = ctx.requestBody;
  const metadata = Object.assign({}, request.metadata || {}, { model: ctx.model });
  if (own(request, "automaticDuration")) {
    if (request.automaticDuration !== true || own(metadata, "duration")) throw new Error("invalid automatic duration state");
    metadata.duration = -1;
  }
  return validateVideo(metadata).request;
}
function taskAction(content) {
  return Array.isArray(content) && content.some(function (item) {
    return item && typeof item === "object" && (item.type === "image_url" || item.type === "video_url" || item.type === "audio_url");
  }) ? "image_to_video" : "text_to_video";
}
function responseBody(data) {
  if (data && typeof data === "object" && data.body && typeof data.body === "object") return data.body;
  return data && typeof data === "object" ? data : {};
}
function responseID(body) {
  for (const candidate of [body.Id, body.id, body.AssetId, body.GroupId, body.TaskId, body.task_id]) if (text(candidate)) return text(candidate);
  const result = body.Result || body.result || body.Data || body.data;
  if (result && typeof result === "object") return responseID(result);
  return "";
}
function providerError(body) {
  const error = body && (body.Error || body.error);
  if (error && typeof error === "object") return text(error.Message || error.message || error.Code || error.code);
  const metadata = body && body.ResponseMetadata;
  if (metadata && metadata.Error) return text(metadata.Error.Message || metadata.Error.Code);
  return "";
}
function assetURL(baseUrl, action) { return baseUrl + "/v1/api/asset?Action=" + action + "&Version=" + VERSION; }
function headers(apiKey) { return { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + apiKey }; }
// Upper pixel count across the official aspect-ratio table, including adaptive.
function resolutionMaxPixels(resolution) {
  if (resolution === "480p") return [992, 432];
  if (resolution === "1080p") return [2206, 946];
  if (resolution === "4k") return [3326, 2494];
  return [1112, 834];
}
function estimateTokens(seconds, resolution) {
  const dimensions = resolutionMaxPixels(resolution);
  return Math.ceil(seconds * dimensions[0] * dimensions[1] * 24 / 1024);
}
function hasVideo(content) {
  return Array.isArray(content) && content.some(function (item) { return item && typeof item === "object" && item.type === "video_url"; });
}

export const native = {
  decodeAssetAction: function (ctx) {
    const action = actionValue(ctx);
    const body = bodyValue(ctx);
    return { kind: "submit", model: ASSET_ROUTING_MODEL, action: action, requestBody: copy(body) };
  },
  createTask: function (ctx) {
    const video = validateVideo(bodyValue(ctx));
    const request = { model: video.model, metadata: video.request };
    if (video.request.duration === -1) {
      request.automaticDuration = true;
      delete request.metadata.duration;
    }
    return { kind: "submit", model: video.model, action: taskAction(video.request.content), requestBody: request };
  },
  taskCreated: function (_ctx, task) { return { id: task.task_id }; },
  taskStatus: function (_ctx, task) {
    const body = responseBody(task.data);
    const hostStatus = { QUEUED: "queued", NOT_START: "queued", SUBMITTED: "queued", IN_PROGRESS: "running", SUCCESS: "succeeded", FAILURE: "failed" };
    const status = hostStatus[task.status] || text(body.status).toLowerCase();
    const mapped = { pending: "queued", queued: "queued", processing: "running", running: "running", succeeded: "succeeded", failed: "failed", expired: "expired" };
    const result = { id: task.task_id, status: mapped[status] || "queued" };
    const content = {};
    for (const field of ["video_url", "last_frame_url"]) if (body.content && text(body.content[field])) content[field] = body.content[field];
    if (Object.keys(content).length) result.content = content;
    for (const field of ["duration", "resolution", "ratio", "output_format", "generate_audio", "created_at", "updated_at"]) {
      if (own(body, field)) result[field] = copy(body[field]);
    }
    if (body.usage) result.usage = copy(body.usage);
    if (body.error) result.error = copy(body.error);
    if (task.fail_reason) result.error = Object.assign({}, result.error || {}, { message: task.fail_reason });
    return result;
  },
  renderAsset: function (ctx, task) {
    actionValue(ctx);
    return copy(responseBody(task.data));
  },
  error: function (_ctx, error) { return { error: { code: error.code, message: error.message } }; },
};

function isAssetAction(action) { return ASSET_ACTIONS.has(action); }

export function buildSubmitRequest(ctx) {
  if (isAssetAction(ctx.action)) {
    return { url: assetURL(ctx.baseUrl, ctx.action), method: "POST", headers: headers(ctx.apiKey), body: copy(ctx.requestBody), action: ctx.action };
  }
  const metadata = validatedVideoRequest(ctx);
  const expectedUpstream = UPSTREAM_MODELS.get(ctx.model) || ctx.model;
  if (ctx.upstreamModel && ctx.upstreamModel !== ctx.model && ctx.upstreamModel !== expectedUpstream) throw new Error("upstream model does not match the Seedance Hub alias");
  metadata.model = expectedUpstream;
  return { url: ctx.baseUrl + "/api/v3/contents/generations/tasks", method: "POST", headers: headers(ctx.apiKey), body: metadata, action: taskAction(metadata.content) };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid upstream response");
  const failure = providerError(body);
  if (failure) throw new Error(failure);
  if (!isAssetAction(ctx.action)) {
    const id = responseID(body);
    if (!id) throw new Error("task_id is empty");
    return { taskId: id, taskData: body };
  }
  const taskData = { action: ctx.action, body: body };
  const id = responseID(body) || ctx.publicTaskId || utils.uuid();
  if (ctx.action === "CreateAsset") return { taskId: id, taskData: taskData };
  return { taskId: id, taskData: taskData, immediate: { status: "SUCCESS", progress: "100%" } };
}

export function buildQueryRequest(ctx) {
  if (ctx.action === "CreateAsset") return { url: assetURL(ctx.baseUrl, "GetAsset"), method: "POST", headers: headers(ctx.apiKey), body: { Id: ctx.taskId }, action: "GetAsset" };
  return { url: ctx.baseUrl + "/api/v3/contents/generations/tasks/" + ctx.taskId, method: "GET", headers: headers(ctx.apiKey) };
}

export function parseTaskResult(ctx, body) {
  const value = object(body, "invalid upstream response");
  if (ctx.action === "CreateAsset") {
    const asset = responseBody(value);
    const status = text(asset.Status).toLowerCase();
    if (status === "active") return { status: "SUCCESS", progress: "100%" };
    if (status === "failed") return { status: "FAILURE", progress: "100%", reason: text(asset.Error && (asset.Error.Message || asset.Error.Code)) || "asset processing failed" };
    return { status: "IN_PROGRESS", progress: "50%" };
  }
  const status = text(value.status).toLowerCase();
  if (status === "pending" || status === "queued") return { status: "QUEUED", progress: "10%" };
  if (status === "processing" || status === "running") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "succeeded") {
    const tokens = billingTokens(value);
    if (!value.content || !text(value.content.video_url)) throw new Error("missing generated video URL");
    return { status: "SUCCESS", progress: "100%", totalTokens: tokens };
  }
  if (status === "failed" || status === "expired") return { status: "FAILURE", progress: "100%", reason: text(value.error && value.error.message) || status };
  return { status: "UNKNOWN", reason: "unrecognized status" };
}

export function extractUsage(ctx) {
  if (isAssetAction(ctx.action)) return { tokens: 0, resolution: "720p", video_input: "none" };
  const metadata = validatedVideoRequest(ctx);
  // -1 is an upstream selection sentinel, never a negative billable quantity.
  // Reserve the model maximum; only measured tokens can complete settlement.
  const spec = VIDEO_MODELS.get(ctx.model);
  const seconds = metadata.duration === -1 ? spec[spec.length - 1] : metadata.duration;
  const resolution = text(metadata.resolution || "720p").toLowerCase();
  return { tokens: estimateTokens(seconds, resolution), resolution: resolution, video_input: hasVideo(metadata.content) ? "video" : "none" };
}

// Prefer reported completion tokens; fall back only when that field is absent.
function billingTokens(body) {
  const usage = body && body.usage || {};
  const tokens = own(usage, "completion_tokens") ? usage.completion_tokens : usage.total_tokens;
  if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 0 || tokens > 2147483647) throw new Error("missing or invalid billing tokens");
  return tokens;
}

export function extractUsageOnComplete(task, result, body) {
  if (isAssetAction(task.action) || result.status !== "SUCCESS") return {};
  const tokens = billingTokens(body);
  return { tokens: tokens };
}

export function listArtifacts(task) {
  if (String(task && task.status || "").toUpperCase() !== "SUCCESS") return [];
  const content = responseBody(task.data).content || {};
  const artifacts = [];
  if (text(content.video_url)) artifacts.push({ key: "video", type: "video" });
  if (text(content.last_frame_url)) artifacts.push({ key: "last_frame", type: "image" });
  return artifacts;
}

export function buildContentRequest(ctx) {
  const content = responseBody(ctx.data).content || {};
  const urls = { video: content.video_url, last_frame: content.last_frame_url };
  const url = text(urls[ctx.artifactKey]);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

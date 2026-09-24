// Token0A video and asset adapter. Like Hub, asset APIs preserve the native
// asset ID and video requests forward asset://asset-... references unchanged.

const ASSET_ROUTING_MODEL = "doubao-seedance-2-0-sea";
const VIDEO_MODELS = new Map([
  ["doubao-seedance-2-0-sea", ["480p", "720p", "1080p", "4k", 15]],
  ["doubao-seedance-2-0-fast-sea", ["480p", "720p", "1080p", 15]],
  ["doubao-seedance-2-0-mini-sea", ["480p", "720p", 15]],
  ["doubao-seedance-2-5-sea", ["480p", "720p", 30]],
]);
const UPSTREAM_MODELS = new Map([
  ["doubao-seedance-2-0-sea", "doubao-seedance-2-0-260128"],
  ["doubao-seedance-2-0-fast-sea", "doubao-seedance-2-0-fast-260128"],
  ["doubao-seedance-2-0-mini-sea", "doubao-seedance-2-0-mini-260615"],
  ["doubao-seedance-2-5-sea", "doubao-seedance-2-5-260628"],
]);
const EXAMPLE_TOKENS = {
  "doubao-seedance-2-0-sea": { "480p": 50220, "720p": 108000, "1080p": 243000, "4k": 972000 },
  "doubao-seedance-2-0-fast-sea": { "480p": 50220, "720p": 108000, "1080p": 243000 },
  "doubao-seedance-2-0-mini-sea": { "480p": 50220, "720p": 108000 },
  "doubao-seedance-2-5-sea": { "480p": 50220, "720p": 108000 },
};
const ASSET_ACTIONS = new Set(["create", "createMedia"]);
const VIDEO_FIELDS = new Set(["model", "content", "duration", "resolution", "ratio", "watermark", "generate_audio", "seed", "camera_fixed", "return_last_frame"]);

export const meta = {
  apiVersion: 1,
  key: "seedance-sea",
  name: "Seedance Sea",
  icon: "Doubao.Color",
  description: { en: "Seedance video generation and owned asset management through the Token0A API", zh: "通过 Token0A API 生成 Seedance 视频并管理归属素材" },
  version: "1.0.4",
  author: { name: "Tapcomfy" },
  baseUrl: "https://seedance.0a.com",
  fetchMode: "per_task",
  models: [...VIDEO_MODELS.keys()],
  usageProfiles: [...VIDEO_MODELS.keys()].map(function (model) {
    return {
      models: [model],
      schema: {
        tokens: { type: "number", unit: "token", description: { en: "Billing token unit price", zh: "计费 Token 单价" } },
        resolution: { enum: VIDEO_MODELS.get(model).slice(0, -1), description: { en: "Output video resolution", zh: "输出视频分辨率" } },
        video_input: { enum: ["none", "video"], description: { en: "Reference video input", zh: "参考视频输入" } },
      },
      examples: VIDEO_MODELS.get(model).slice(0, -1).map(function (resolution) {
        return { label: resolution + " · 5s output estimate", facts: { tokens: EXAMPLE_TOKENS[model][resolution], resolution: resolution, video_input: "none" } };
      }),
    };
  }),
  routes: [
    { method: "POST", path: "/seedance-sea/v7/asset/create", type: "submit", decode: "createAsset", render: "assetCreated" },
    { method: "POST", path: "/seedance-sea/v7/asset/createMedia", type: "submit", decode: "createAsset", render: "assetCreated" },
    { method: "GET", path: "/seedance-sea/v7/asset/tasks/:task_id", type: "query", render: "assetStatus" },
    { method: "POST", path: "/seedance-sea/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/seedance-sea/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
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
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) result[key] = copy(value[key]);
    return result;
  }
  return value;
}
function validateAssetReferences(value) {
  if (typeof value === "string") {
    if (value.startsWith("asset://") && !/^asset:\/\/asset-[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid native asset reference");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateAssetReferences(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) validateAssetReferences(item);
  }
}
function assetView(task) {
  const body = copy(responseBody(task.data));
  // Keep the public polling task and the native video reference distinct.
  // The host rewrites lowercase id; Token0A also returns the native Id field.
  const id = text(body.Id || body.id);
  delete body.Id;
  delete body.id;
  if (/^asset-[A-Za-z0-9_-]+$/.test(id)) body.id = id;
  body.task_id = task.task_id;
  const status = text(body.Status || body.status).toLowerCase();
  body.Status = task.status === "FAILURE" ? "Failed" : ({ active: "Active", processing: "Processing", failed: "Failed" }[status] || "Processing");
  delete body.status;
  if (task.fail_reason) body.errorMessage = task.fail_reason;
  return body;
}
function validateVideo(body) {
  const model = text(body.model);
  const spec = VIDEO_MODELS.get(model);
  if (!spec) throw new Error("unsupported Seedance model");
  if (body.content !== undefined && !Array.isArray(body.content)) throw new Error("content must be an array");
  const content = Array.isArray(body.content) ? body.content : [];
  if (!content.length) throw new Error("content is required");
  const duration = own(body, "duration") ? body.duration : 5;
  if (!Number.isInteger(duration) || duration < 4 || duration > spec[spec.length - 1]) throw new Error("duration is outside the supported range");
  const resolution = own(body, "resolution") ? text(body.resolution).toLowerCase() : "720p";
  if (!spec.slice(0, -1).includes(resolution)) throw new Error("unsupported resolution");
  for (const field of Object.keys(body)) if (!VIDEO_FIELDS.has(field)) throw new Error("unsupported video field: " + field);
  for (const field of ["watermark", "generate_audio", "camera_fixed", "return_last_frame"]) if (own(body, field) && typeof body[field] !== "boolean") throw new Error(field + " must be boolean");
  const request = copy(body);
  request.duration = duration;
  request.resolution = resolution;
  validateAssetReferences(content);
  return { model: model, request: request };
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
  if (body && body.success === false) return text(body.message) || "upstream request failed";
  const error = body && (body.Error || body.error);
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") return text(error.Message || error.message || error.Code || error.code);
  const metadata = body && body.ResponseMetadata;
  if (metadata && metadata.Error) return text(metadata.Error.Message || metadata.Error.Code);
  return "";
}
function assetURL(baseUrl, action) { return baseUrl.replace(/\/+$/, "") + "/api/token/v7/asset/" + action; }
function headers(apiKey) { return { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + apiKey }; }
function resolutionMaxPixels(resolution) {
  if (resolution === "480p") return [854, 480];
  if (resolution === "1080p") return [1920, 1080];
  if (resolution === "4k") return [3840, 2160];
  return [1280, 720];
}
function estimateTokens(seconds, resolution) {
  const dimensions = resolutionMaxPixels(resolution);
  return seconds * dimensions[0] * dimensions[1] * 24 / 1024;
}
function hasVideo(content) {
  return Array.isArray(content) && content.some(function (item) { return item && typeof item === "object" && item.type === "video_url"; });
}

export const native = {
  createAsset: function (ctx) {
    const body = bodyValue(ctx);
    const action = ctx.path.endsWith("/createMedia") ? "createMedia" : "create";
    if (!/^https?:\/\/[^\s]+$/.test(text(body.url))) throw new Error("asset url must be an HTTP or HTTPS URL");
    if (!text(body.name) || Array.from(body.name).length > 64) throw new Error("asset name must contain 1 to 64 characters");
    const request = { url: text(body.url), name: text(body.name) };
    if (action === "createMedia") {
      if (!["Image", "Video", "Audio"].includes(body.assetType)) throw new Error("unsupported assetType");
      request.assetType = body.assetType;
      if (own(body, "group_id")) {
        if (!text(body.group_id)) throw new Error("group_id must be a non-empty string");
        request.group_id = text(body.group_id);
      }
    }
    return { kind: "submit", model: ASSET_ROUTING_MODEL, action: action, requestBody: request };
  },
  assetCreated: function (_ctx, task) { return assetView(task); },
  assetStatus: function (_ctx, task) { return assetView(task); },
  createTask: function (ctx) {
    const video = validateVideo(bodyValue(ctx));
    return { kind: "submit", model: video.model, action: taskAction(video.request.content), requestBody: { model: video.model, metadata: video.request } };
  },
  taskCreated: function (_ctx, task) { return { id: task.task_id }; },
  taskStatus: function (_ctx, task) {
    const body = responseBody(task.data);
    const hostStatus = { QUEUED: "queued", NOT_START: "queued", SUBMITTED: "queued", IN_PROGRESS: "running", SUCCESS: "succeeded", FAILURE: "failed" };
    const status = hostStatus[task.status] || text(body.status).toLowerCase();
    const mapped = { pending: "queued", queued: "queued", processing: "running", running: "running", succeeded: "succeeded", failed: "failed", expired: "expired" };
    const result = { id: task.task_id, status: mapped[status] || "queued" };
    if (body.content && text(body.content.video_url)) result.content = { video_url: body.content.video_url };
    if (body.usage) result.usage = body.usage;
    if (body.error) result.error = body.error;
    if (task.fail_reason) result.error = { message: task.fail_reason };
    return result;
  },
  error: function (_ctx, error) { return { error: { code: error.code, message: error.message } }; },
};

function isAssetAction(action) { return ASSET_ACTIONS.has(action); }

export function buildSubmitRequest(ctx) {
  if (isAssetAction(ctx.action)) {
    const body = copy(ctx.requestBody);
    return { url: assetURL(ctx.baseUrl, ctx.action), method: "POST", headers: headers(ctx.apiKey), body: body, action: ctx.action };
  }
  const metadata = validateVideo(Object.assign({}, ctx.requestBody.metadata || {}, { model: ctx.model })).request;
  const expectedUpstream = UPSTREAM_MODELS.get(ctx.model) || ctx.model;
  if (ctx.upstreamModel && ctx.upstreamModel !== ctx.model && ctx.upstreamModel !== expectedUpstream) throw new Error("upstream model does not match the Seedance Sea alias");
  metadata.model = expectedUpstream;
  return { url: ctx.baseUrl.replace(/\/+$/, "") + "/api/token/v3/contents/generations/tasks", method: "POST", headers: headers(ctx.apiKey), body: metadata, action: taskAction(metadata.content) };
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
  const id = responseID(body);
  if (!/^asset-[A-Za-z0-9_-]+$/.test(id)) throw new Error("native asset id is empty or invalid");
  const asset = copy(body);
  asset.Id = id;
  delete asset.id;
  return { taskId: id, taskData: asset };
}

export function buildQueryRequest(ctx) {
  if (ctx.action === "create" || ctx.action === "createMedia") return { url: assetURL(ctx.baseUrl, "get") + "?id=" + encodeURIComponent(ctx.taskId), method: "GET", headers: headers(ctx.apiKey) };
  return { url: ctx.baseUrl.replace(/\/+$/, "") + "/api/token/v3/contents/generations/tasks/" + ctx.taskId, method: "GET", headers: headers(ctx.apiKey) };
}

export function parseTaskResult(ctx, body) {
  const value = object(body, "invalid upstream response");
  if (ctx.action === "create" || ctx.action === "createMedia") {
    const asset = responseBody(value);
    const status = text(asset.Status || asset.status).toLowerCase();
    if (status === "active") return { status: "SUCCESS", progress: "100%" };
    if (status === "failed") return { status: "FAILURE", progress: "100%", reason: text(asset.errorMessage || asset.errorCode || (asset.Error && (asset.Error.Message || asset.Error.Code))) || "asset processing failed" };
    if (status === "processing") return { status: "IN_PROGRESS", progress: "50%" };
    return { status: "UNKNOWN", reason: "unrecognized asset status" };
  }
  const status = text(value.status).toLowerCase();
  if (status === "pending" || status === "queued") return { status: "QUEUED", progress: "10%" };
  if (status === "processing" || status === "running") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "succeeded") {
    const tokens = value.usage && value.usage.total_tokens;
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0 || tokens > 2147483647) throw new Error("missing or invalid usage.total_tokens");
    return { status: "SUCCESS", progress: "100%", totalTokens: tokens };
  }
  if (status === "failed" || status === "expired") return { status: "FAILURE", progress: "100%", reason: text(value.error && value.error.message) || status };
  return { status: "UNKNOWN", reason: "unrecognized status" };
}

export function extractUsage(ctx) {
  if (isAssetAction(ctx.action)) return { tokens: 0, resolution: "720p", video_input: "none" };
  const metadata = validateVideo(Object.assign({}, ctx.requestBody.metadata || {}, { model: ctx.model })).request;
  const seconds = Number(metadata.duration || 5);
  const resolution = text(metadata.resolution || "720p").toLowerCase();
  return { tokens: estimateTokens(seconds, resolution), resolution: resolution, video_input: hasVideo(metadata.content) ? "video" : "none" };
}

export function extractUsageOnComplete(task, result, body) {
  if (isAssetAction(task.action) || result.status !== "SUCCESS") return {};
  const usage = body && body.usage || {};
  const tokens = usage.total_tokens;
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0 || tokens > 2147483647) throw new Error("missing or invalid usage.total_tokens");
  return { tokens: tokens };
}

export function listArtifacts(task) {
  if (String(task && task.status || "").toUpperCase() !== "SUCCESS") return [];
  const content = responseBody(task.data).content || {};
  const artifacts = [];
  if (text(content.video_url)) artifacts.push({ key: "video", type: "video" });
  if (text(content.last_frame_url)) artifacts.push({ key: "last_frame", type: "image", mimeType: "image/png" });
  return artifacts;
}

export function buildContentRequest(ctx) {
  const content = responseBody(ctx.data).content || {};
  const urls = { video: content.video_url, last_frame: content.last_frame_url };
  const url = text(urls[ctx.artifactKey]);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

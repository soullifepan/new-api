// Huanxing video and asset adapter. Like Hub, asset APIs preserve the native
// asset ID and video requests forward asset://asset-... references unchanged.

const ASSET_ROUTING_MODEL = "doubao-seedance-2-0-hx";
const VIDEO_MODELS = new Map([
  ["doubao-seedance-2-0-hx", ["480p", "720p", "1080p", "4k", 15]],
  ["doubao-seedance-2-0-fast-hx", ["480p", "720p", 15]],
  ["doubao-seedance-2-0-mini-hx", ["480p", "720p", 15]],
  ["doubao-seedance-2-5-hx", ["480p", "720p", "1080p", 30]],
]);
const UPSTREAM_MODELS = new Map([
  ["doubao-seedance-2-0-hx", "doubao-seedance-2.0"],
  ["doubao-seedance-2-0-fast-hx", "doubao-seedance-2.0-fast"],
  ["doubao-seedance-2-0-mini-hx", "doubao-seedance-2.0-mini"],
  ["doubao-seedance-2-5-hx", "doubao-seedance-2.5"],
]);
const EXAMPLE_TOKENS = {
  "doubao-seedance-2-0-hx": { "480p": 50220, "720p": 108000, "1080p": 243000, "4k": 972000 },
  "doubao-seedance-2-0-fast-hx": { "480p": 50220, "720p": 108000 },
  "doubao-seedance-2-0-mini-hx": { "480p": 50220, "720p": 108000 },
  "doubao-seedance-2-5-hx": { "480p": 48037.5, "720p": 108000, "1080p": 243000 },
};
const ASSET_ACTIONS = new Set(["CreateAssetGroup", "ListAssetGroups", "GetAssetGroup", "CreateAsset"]);
const VIDEO_FIELDS = new Set(["model", "content", "duration", "resolution", "ratio", "watermark", "generate_audio"]);

export const meta = {
  apiVersion: 1,
  key: "seedance-hx",
  name: "Seedance HX",
  icon: "Doubao.Color",
  description: { en: "Seedance video generation and owned asset management through the Huanxing API", zh: "通过 Huanxing API 生成 Seedance 视频并管理归属素材" },
  version: "1.0.1",
  author: { name: "Tapcomfy" },
  baseUrl: "https://api.huanxing.ai",
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
    { method: "POST", path: "/seedance-hx/api/material", type: "submit", decode: "createMaterial", render: "materialCreated" },
    { method: "GET", path: "/seedance-hx/v1/asset/tasks/:task_id", type: "query", render: "assetStatus" },
    { method: "POST", path: "/seedance-hx/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/seedance-hx/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
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
  const asset = body.Result || {};
  body.task_id = task.task_id;
  const status = text(asset.Status).toLowerCase();
  asset.Status = task.status === "FAILURE" ? "Failed" : ({ active: "Active", processing: "Processing", failed: "Failed" }[status] || "Processing");
  if (task.fail_reason) asset.Error = { Message: task.fail_reason };
  body.Result = asset;
  return body;
}
function validateVideo(body) {
  const model = text(body.model);
  const spec = VIDEO_MODELS.get(model);
  if (!spec) throw new Error("unsupported Seedance model");
  if (body.content !== undefined && !Array.isArray(body.content)) throw new Error("content must be an array");
  const content = Array.isArray(body.content) ? body.content : [];
  if (!content.some(function (item) { return item && item.type === "text" && text(item.text); })) throw new Error("non-empty text content is required");
  const duration = own(body, "duration") ? body.duration : 5;
  if (!Number.isInteger(duration) || duration < 4 || duration > spec[spec.length - 1]) throw new Error("duration is outside the supported range");
  const resolution = own(body, "resolution") ? text(body.resolution).toLowerCase() : "720p";
  if (!spec.slice(0, -1).includes(resolution)) throw new Error("unsupported resolution");
  for (const field of Object.keys(body)) if (!VIDEO_FIELDS.has(field)) throw new Error("unsupported video field: " + field);
  for (const field of ["watermark", "generate_audio"]) if (own(body, field) && typeof body[field] !== "boolean") throw new Error(field + " must be boolean");
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
  const error = body && (body.Error || body.error || (body.Result && body.Result.Error));
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") return text(error.Message || error.message || error.Code || error.code);
  const metadata = body && body.ResponseMetadata;
  if (metadata && metadata.Error) return text(metadata.Error.Message || metadata.Error.Code);
  return "";
}
function validGroupID(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value); }
function assetURL(baseUrl, action) { return baseUrl.replace(/\/+$/, "") + "/api/material?Action=" + action; }
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
  createMaterial: function (ctx) {
    const action = ctx.query && ctx.query.Action && ctx.query.Action[0];
    if (!ASSET_ACTIONS.has(action)) throw new Error("unsupported material Action");
    const body = bodyValue(ctx);
    let request;
    if (action === "ListAssetGroups") {
      request = {};
    } else if (action === "CreateAssetGroup") {
      if (!text(body.Name)) throw new Error("group name is required");
      request = { Name: text(body.Name) };
      if (own(body, "Description")) request.Description = text(body.Description);
    } else if (action === "GetAssetGroup") {
      if (!validGroupID(body.Id)) throw new Error("native group id is required");
      request = { Id: text(body.Id) };
    } else {
      if (!validGroupID(body.GroupId)) throw new Error("native group id is required");
      if (!/^https?:\/\/[^\s]+$/.test(text(body.URL))) throw new Error("asset URL must be HTTP or HTTPS");
      if (!text(body.Name)) throw new Error("asset name is required");
      if (!["Image", "Video", "Audio"].includes(body.AssetType)) throw new Error("unsupported AssetType");
      request = { GroupId: text(body.GroupId), URL: text(body.URL), Name: text(body.Name), AssetType: body.AssetType };
    }
    return { kind: "submit", model: ASSET_ROUTING_MODEL, action: action, requestBody: request };
  },
  materialCreated: function (ctx, task) {
    return ctx.query && ctx.query.Action && ctx.query.Action[0] === "CreateAsset" ? assetView(task) : copy(responseBody(task.data));
  },
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
  if (ctx.upstreamModel && ctx.upstreamModel !== ctx.model && ctx.upstreamModel !== expectedUpstream) throw new Error("upstream model does not match the Seedance HX alias");
  metadata.model = expectedUpstream;
  if (own(metadata, "watermark")) {
    metadata.metadata = { watermark: metadata.watermark };
    delete metadata.watermark;
  }
  return { url: ctx.baseUrl.replace(/\/+$/, "") + "/api/v3/contents/generations/tasks", method: "POST", headers: headers(ctx.apiKey), body: metadata, action: taskAction(metadata.content) };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid upstream response");
  const failure = providerError(body);
  if (failure) {
    // Preserve lookup errors so the client can distinguish a deleted group
    // from a temporary provider error without creating another group.
    if (ctx.action === "GetAssetGroup") return { taskId: ctx.publicTaskId || utils.uuid(), taskData: body, immediate: { status: "FAILURE", reason: failure } };
    throw new Error(failure);
  }
  if (!isAssetAction(ctx.action)) {
    const id = responseID(body);
    if (!id) throw new Error("task_id is empty");
    return { taskId: id, taskData: body };
  }
  if (ctx.action === "ListAssetGroups") {
    if (!body.Result || !Array.isArray(body.Result.Items)) throw new Error("invalid asset group list");
    return { taskId: ctx.publicTaskId || utils.uuid(), taskData: body, immediate: { status: "SUCCESS", progress: "100%" } };
  }
  const id = responseID(body);
  if (ctx.action === "CreateAsset") {
    if (!/^asset-[A-Za-z0-9_-]+$/.test(id)) throw new Error("native asset id is empty or invalid");
    return { taskId: id, taskData: body };
  }
  if (!validGroupID(id)) throw new Error("native group id is empty or invalid");
  return { taskId: id, taskData: body, immediate: { status: "SUCCESS", progress: "100%" } };
}

export function buildQueryRequest(ctx) {
  if (ctx.action === "CreateAsset") return { url: assetURL(ctx.baseUrl, "GetAsset"), method: "POST", headers: headers(ctx.apiKey), body: { Id: ctx.taskId } };
  return { url: ctx.baseUrl.replace(/\/+$/, "") + "/api/v3/contents/generations/tasks/" + ctx.taskId, method: "GET", headers: headers(ctx.apiKey) };
}

export function parseTaskResult(ctx, body) {
  const value = object(body, "invalid upstream response");
  if (ctx.action === "CreateAsset") {
    const envelope = responseBody(value);
    const asset = envelope.Result || {};
    const status = text(asset.Status || asset.status).toLowerCase();
    if (status === "failed") return { status: "FAILURE", progress: "100%", reason: text(asset.errorMessage || asset.errorCode || (asset.Error && (asset.Error.Message || asset.Error.Code))) || "asset processing failed" };
    const failure = providerError(envelope);
    if (failure) return { status: "UNKNOWN", reason: failure };
    if (ctx.taskId && asset.Id !== ctx.taskId) return { status: "UNKNOWN", reason: "asset id mismatch" };
    if (status === "active") {
      if (!/^asset-[A-Za-z0-9_-]+$/.test(text(asset.Id))) return { status: "UNKNOWN", reason: "invalid native asset id" };
      return { status: "SUCCESS", progress: "100%" };
    }
    if (status === "processing") return { status: "IN_PROGRESS", progress: "50%" };
    return { status: "UNKNOWN", reason: "unrecognized asset status" };
  }
  const status = text(value.status).toLowerCase();
  if (status === "pending" || status === "queued") return { status: "QUEUED", progress: "10%" };
  if (status === "processing" || status === "running") return { status: "IN_PROGRESS", progress: "50%" };
  if (status === "succeeded") {
    const tokens = billingTokens(value);
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

// Match Hub billing: prefer reported completion tokens, fall back only when absent.
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

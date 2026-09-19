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
const ASSET_ACTIONS = new Set([
  "CreateAssetGroup", "ListAssetGroups", "GetAssetGroup", "UpdateAssetGroup", "DeleteAssetGroup",
  "CreateAsset", "ListAssets", "GetAsset", "UpdateAsset", "DeleteAsset",
  "CreateVisualValidateSession", "GetVisualValidateResult",
]);

export const meta = {
  apiVersion: 1,
  key: "seedance-hub",
  name: "Seedance Hub",
  icon: "Doubao.Color",
  description: { en: "Seedance video generation and owned asset management through the Hub API", zh: "通过 Hub API 生成 Seedance 视频并管理归属素材" },
  version: "2.0.3",
  author: { name: "Tapcomfy" },
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
      examples: [{ label: "720p · 5s", facts: { tokens: 108000, resolution: "720p", video_input: "none" } }],
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
function validateAssetReferences(value) {
  if (typeof value === "string") {
    if (value.startsWith("asset://") && !/^asset:\/\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid asset reference");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateAssetReferences(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) validateAssetReferences(item);
  }
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
  const error = body && (body.Error || body.error);
  if (error && typeof error === "object") return text(error.Message || error.message || error.Code || error.code);
  const metadata = body && body.ResponseMetadata;
  if (metadata && metadata.Error) return text(metadata.Error.Message || metadata.Error.Code);
  return "";
}
function assetURL(baseUrl, action) { return baseUrl + "/v1/api/asset?Action=" + action + "&Version=" + VERSION; }
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
  decodeAssetAction: function (ctx) {
    const action = actionValue(ctx);
    const body = bodyValue(ctx);
    return { kind: "submit", model: ASSET_ROUTING_MODEL, action: action, requestBody: copy(body) };
  },
  createTask: function (ctx) {
    const video = validateVideo(bodyValue(ctx));
    return { kind: "submit", model: video.model, action: taskAction(video.request.content), requestBody: { model: video.model, metadata: video.request } };
  },
  taskCreated: function (_ctx, task) { return { id: task.task_id }; },
  taskStatus: function (_ctx, task) {
    const body = responseBody(task.data);
    const status = text(body.status).toLowerCase();
    const mapped = { pending: "queued", queued: "queued", processing: "running", running: "running", succeeded: "succeeded", failed: "failed", expired: "expired" };
    const result = { id: task.task_id, status: mapped[status] || "queued" };
    if (body.content && text(body.content.video_url)) result.content = { video_url: body.content.video_url };
    if (body.usage) result.usage = body.usage;
    if (body.error) result.error = body.error;
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
  const metadata = copy(ctx.requestBody.metadata || {});
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
  if (status === "succeeded") return { status: "SUCCESS", progress: "100%", totalTokens: Number(value.usage && value.usage.total_tokens) || 0, completionTokens: Number(value.usage && value.usage.completion_tokens) || 0 };
  if (status === "failed" || status === "expired") return { status: "FAILURE", progress: "100%", reason: text(value.error && value.error.message) || status };
  return { status: "UNKNOWN", reason: "unrecognized status" };
}

export function extractUsage(ctx) {
  if (isAssetAction(ctx.action)) return { tokens: 0, resolution: "720p", video_input: "none" };
  const metadata = ctx.requestBody.metadata || {};
  const seconds = Number(metadata.duration || 5);
  const resolution = text(metadata.resolution || "720p").toLowerCase();
  return { tokens: estimateTokens(seconds, resolution), resolution: resolution, video_input: hasVideo(metadata.content) ? "video" : "none" };
}

export function extractUsageOnComplete(task, result, body) {
  if (isAssetAction(task.action) || result.status !== "SUCCESS") return {};
  const usage = body && body.usage || {};
  const tokens = Number(usage.completion_tokens || usage.total_tokens);
  return Number.isFinite(tokens) && tokens >= 0 ? { tokens: tokens } : {};
}

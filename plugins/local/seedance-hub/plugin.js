// Seedance Hub exposes Volcengine's native video and asset APIs through a
// type-61 channel. Public asset IDs are gateway task IDs; upstream asset IDs
// never leave driver hooks.

const ASSET_MODEL = "seedance-hub-asset";
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
  "CreateAssetGroup", "GetAssetGroup", "UpdateAssetGroup", "DeleteAssetGroup",
  "CreateAsset", "GetAsset", "UpdateAsset", "DeleteAsset",
]);

export const meta = {
  apiVersion: 1,
  key: "seedance-hub",
  name: "Seedance Hub",
  icon: "Doubao.Color",
  description: { en: "Seedance video generation and owned asset management through the Hub API", zh: "通过 Hub API 生成 Seedance 视频并管理归属素材" },
  version: "1.0.0",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  models: [...VIDEO_MODELS.keys(), ASSET_MODEL],
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
  }).concat([{ models: [ASSET_MODEL], schema: {}, examples: [] }]),
  routes: [
    { method: "POST", path: "/seedance-hub/v1/api/asset", type: "dynamic", decode: "decodeAssetAction", render: "renderAsset" },
    { method: "POST", path: "/seedance-hub/api/v3/contents/generations/tasks", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/seedance-hub/api/v3/contents/generations/tasks/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"], models: [...VIDEO_MODELS.keys()] }, { name: "openai_video", models: [...VIDEO_MODELS.keys()] }],
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
function readAssetReference(value, references) {
  if (typeof value === "string") {
    const match = /^asset:\/\/(cgt-hub-[A-Za-z0-9_-]+)$/.exec(value);
    if (match) references.add(match[1]);
    else if (value.startsWith("asset://")) throw new Error("asset reference must be a gateway asset ID");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) readAssetReference(item, references);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) readAssetReference(item, references);
  }
}
function upstreamAssetID(originTasks, publicID) {
  for (const task of originTasks || []) {
    if (task.taskId !== publicID || task.action !== "CreateAsset" || task.status !== "SUCCESS") continue;
    const body = responseBody(task.data);
    if (text(body.Status) !== "Active") throw new Error("asset is not active");
    if (text(task.upstreamTaskId)) return text(task.upstreamTaskId);
  }
  throw new Error("asset reference is not an owned active asset");
}
function replaceAssetReferences(value, originTasks) {
  if (typeof value === "string") {
    const match = /^asset:\/\/(cgt-hub-[A-Za-z0-9_-]+)$/.exec(value);
    return match ? "asset://" + upstreamAssetID(originTasks, match[1]) : value;
  }
  if (Array.isArray(value)) return value.map(function (item) { return replaceAssetReferences(item, originTasks); });
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) result[key] = replaceAssetReferences(value[key], originTasks);
    return result;
  }
  return value;
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
  const references = new Set();
  readAssetReference(content, references);
  return { model: model, request: request, originTaskIds: [...references] };
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
function assetReferencesFromBody(body) {
  const references = new Set();
  for (const key of ["Id", "GroupId"]) if (text(body[key])) references.add(text(body[key]));
  if (body.Filter && typeof body.Filter === "object" && Array.isArray(body.Filter.GroupIds)) for (const id of body.Filter.GroupIds) if (text(id)) references.add(text(id));
  return [...references];
}
function replaceResourceIDs(value, originTasks) {
  const body = copy(value);
  const mapID = function (id) {
    for (const task of originTasks || []) if (task.taskId === id && text(task.upstreamTaskId)) return text(task.upstreamTaskId);
    throw new Error("resource is not owned by the current user");
  };
  if (text(body.Id)) body.Id = mapID(text(body.Id));
  if (text(body.GroupId)) body.GroupId = mapID(text(body.GroupId));
  if (body.Filter && typeof body.Filter === "object" && Array.isArray(body.Filter.GroupIds)) body.Filter.GroupIds = body.Filter.GroupIds.map(function (id) { return mapID(text(id)); });
  return body;
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
    const originTaskIds = assetReferencesFromBody(body);
    const intent = { kind: "submit", model: ASSET_MODEL, action: action, requestBody: copy(body) };
    if (originTaskIds.length) intent.originTaskIds = originTaskIds;
    return intent;
  },
  createTask: function (ctx) {
    const video = validateVideo(bodyValue(ctx));
    const intent = { kind: "submit", model: video.model, action: taskAction(video.request.content), requestBody: { model: video.model, metadata: video.request } };
    if (video.originTaskIds.length) intent.originTaskIds = video.originTaskIds;
    return intent;
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
    const body = responseBody(task.data);
    const action = actionValue(ctx);
    const result = copy(body);
    if (action === "CreateAsset" || action === "CreateAssetGroup") result.Id = task.task_id;
    else if (task.data && text(task.data.resourcePublicID)) result.Id = task.data.resourcePublicID;
    return result;
  },
  error: function (_ctx, error) { return { error: { code: error.code, message: error.message } }; },
};

export function buildSubmitRequest(ctx) {
  if (ctx.model === ASSET_MODEL) {
    return { url: assetURL(ctx.baseUrl, ctx.action), method: "POST", headers: headers(ctx.apiKey), body: replaceResourceIDs(ctx.requestBody, ctx.originTasks), action: ctx.action };
  }
  const metadata = replaceAssetReferences(copy(ctx.requestBody.metadata || {}), ctx.originTasks);
  const expectedUpstream = UPSTREAM_MODELS.get(ctx.model) || ctx.model;
  if (ctx.upstreamModel && ctx.upstreamModel !== expectedUpstream) throw new Error("upstream model does not match the Seedance Hub alias");
  metadata.model = expectedUpstream;
  return { url: ctx.baseUrl + "/api/v3/contents/generations/tasks", method: "POST", headers: headers(ctx.apiKey), body: metadata, action: taskAction(metadata.content), rewriteModel: metadata.model };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid upstream response");
  const failure = providerError(body);
  if (failure) throw new Error(failure);
  if (ctx.model !== ASSET_MODEL) {
    const id = responseID(body);
    if (!id) throw new Error("task_id is empty");
    return { taskId: id, taskData: body };
  }
  const taskData = { action: ctx.action, body: body };
  if (ctx.requestBody && text(ctx.requestBody.Id)) taskData.resourcePublicID = text(ctx.requestBody.Id);
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
  if (ctx.model === ASSET_MODEL) return {};
  const metadata = ctx.requestBody.metadata || {};
  const seconds = Number(metadata.duration || 5);
  const resolution = text(metadata.resolution || "720p").toLowerCase();
  return { tokens: estimateTokens(seconds, resolution), resolution: resolution, video_input: hasVideo(metadata.content) ? "video" : "none" };
}

export function extractUsageOnComplete(task, result, body) {
  if (task.model === ASSET_MODEL || result.status !== "SUCCESS") return {};
  const usage = body && body.usage || {};
  const tokens = Number(usage.completion_tokens || usage.total_tokens);
  return Number.isFinite(tokens) && tokens >= 0 ? { tokens: tokens } : {};
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const content = responseBody(task.data).content || {};
  return text(content.video_url) ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  const content = responseBody(ctx.data).content || {};
  if (ctx.artifactKey !== "video" || !text(content.video_url)) throw new Error("artifact_not_found");
  return { url: content.video_url, method: ctx.clientRequest.method, credentialless: true };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      const body = bodyValue(ctx);
      const model = text(body.model);
      if (!VIDEO_MODELS.has(model)) throw new Error("unsupported Seedance model");
      const content = [];
      if (text(body.prompt)) content.push({ type: "text", text: body.prompt });
      if (text(body.image)) content.push({ type: "image_url", image_url: { url: body.image } });
      if (!content.length) throw new Error("prompt or image is required");
      const request = validateVideo({ model: model, content: content, duration: own(body, "seconds") ? body.seconds : body.duration, resolution: body.resolution || body.size });
      const intent = { kind: "submit", model: model, action: taskAction(request.request.content), requestBody: { model: model, metadata: request.request } };
      if (request.originTaskIds.length) intent.originTaskIds = request.originTaskIds;
      return intent;
    },
    render: function (_ctx, task) { return native.taskStatus({}, task); },
  },
  openai_responses: {
    decodeRequest: function (ctx) {
      const body = bodyValue(ctx);
      const model = text(body.model);
      if (!VIDEO_MODELS.has(model)) throw new Error("unsupported Seedance model");
      const input = Array.isArray(body.input) ? body.input : [body.input];
      const content = [];
      for (const item of input) {
        if (typeof item === "string") content.push({ type: "text", text: item });
        else if (item && typeof item === "object" && Array.isArray(item.content)) for (const part of item.content) {
          if (part && part.type === "input_text") content.push({ type: "text", text: part.text });
          if (part && part.type === "input_image") content.push({ type: "image_url", image_url: { url: typeof part.image_url === "object" ? part.image_url.url : part.image_url } });
        }
      }
      const metadata = object(body.metadata || {}, "metadata must be an object");
      const request = validateVideo(Object.assign({}, metadata, { model: model, content: content, duration: own(metadata, "duration") ? metadata.duration : 5 }));
      const intent = { kind: "submit", model: model, action: taskAction(request.request.content), requestBody: { model: model, metadata: request.request } };
      if (request.originTaskIds.length) intent.originTaskIds = request.originTaskIds;
      return intent;
    },
    renderEvents: function (_ctx, task, previous) {
      if (task.status === "SUCCESS") return { events: previous && previous.status === "SUCCESS" ? [] : [{ type: "output", data: "Video generated" }], state: { status: "SUCCESS" }, done: true };
      if (task.status === "FAILURE") return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: { status: "FAILURE" }, done: true };
      return { events: [{ type: "progress", message: String(task.status || "queued").toLowerCase() }], state: { status: task.status }, done: false };
    },
    renderFinal: function (_ctx, task) { return { output: [{ type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(native.taskStatus({}, task)), annotations: [], logprobs: [] }] }] }; },
  },
};

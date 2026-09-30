// Huanxing video and asset adapter. Like Hub, asset APIs preserve the native
// asset ID and video requests forward asset://<native-id> references unchanged.

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
// Ordinary vendor options pass through; these fields cross host, billing or
// unresolved task-reference boundaries and must not be supplied as extensions.
const RESERVED_VIDEO_FIELDS = new Set(["common", "advanced", "input", "commonParams", "advancedParams", "variantId", "providerId", "qualityLevel", "aspectRatio", "durationId", "capabilityType", "automaticDuration", "metadata", "parameters", "state", "data", "requestBody", "originTasks", "originTaskIds", "upstreamModel", "publicTaskId", "apiKey", "authHeader", "baseUrl", "billing_usage", "cost", "credits_cost", "usage", "n", "batch_size", "num_videos", "frames", "fps", "seconds", "size", "quality", "service_tier", "draft", "draft_task_id"]);
function validateVideoExtensions(value) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key.startsWith("_") || RESERVED_VIDEO_FIELDS.has(key) || /(?:task_?ids?$|taskId$|taskIds$|^draft_task$)/i.test(key)) throw new Error("unsupported video field: " + key);
    // Duration and pixel multipliers are only accepted at the validated top level.
    if (key === "duration" || key === "resolution" || key === "ratio") throw new Error("unsupported nested billing field: " + key);
    validateVideoExtensions(value[key]);
  }
}

export const meta = {
  apiVersion: 1,
  key: "seedance-hx",
  name: "Seedance HX",
  icon: "Doubao.Color",
  description: { en: "Seedance video generation and owned asset management through the Huanxing API", zh: "通过 Huanxing API 生成 Seedance 视频并管理归属素材" },
  version: "1.3.0",
  author: { name: "Tapcomfy" },
  baseUrl: "https://api.huanxing.ai",
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
    // HX documents subject_type as an image hint; it does not affect billing.
    if (item.type === "image_url" && own(item, "subject_type")) {
      if (!text(item.subject_type) || item.subject_type.length > 64) throw new Error("invalid subject_type");
      fields.push("subject_type");
    }
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
  if (counts.reference_image > (v25 ? 30 : 9) || counts.reference_video > (v25 ? 10 : 3) || counts.reference_audio > (v25 ? 10 : 3)) throw new Error("too many reference media for this model");
}
// Draft references are public gateway IDs until the driver resolves owned origins.
function draftTaskID(body) {
  const content = body.content;
  if (!Array.isArray(content) || !content.some(function (item) { return item && item.type === "draft_task"; })) return "";
  if (content.length !== 1) throw new Error("final video content must contain only one draft_task");
  const item = object(content[0], "invalid draft_task");
  const ref = object(item.draft_task, "invalid draft_task reference");
  if (Object.keys(item).some(function (key) { return key !== "type" && key !== "draft_task"; }) || Object.keys(ref).some(function (key) { return key !== "id"; }) || typeof ref.id !== "string" || !/^task_[A-Za-z0-9_-]+$/.test(ref.id)) throw new Error("draft_task.id must be a public gateway task ID");
  return ref.id;
}
function normalizeFinalVideo(body) {
  const allowed = new Set(["model", "content", "draft", "resolution", "return_last_frame", "output_format", "watermark", "service_tier", "execution_expires_after", "priority", "callback_url", "safety_identifier"]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new Error("unsupported final video field: " + key);
  if (body.draft !== undefined && body.draft !== false) throw new Error("final video cannot enable draft");
  if (body.resolution !== undefined && body.resolution !== "1080p") throw new Error("final video requires 1080p");
  for (const key of ["return_last_frame", "watermark"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new Error("invalid " + key);
  if (body.output_format !== undefined && !["mp4", "mov"].includes(body.output_format)) throw new Error("invalid output_format");
  if (body.service_tier !== undefined && body.service_tier !== "default") throw new Error("Seedance 2.5 requires default service_tier");
  if (body.execution_expires_after !== undefined && (!Number.isInteger(body.execution_expires_after) || body.execution_expires_after < 3600 || body.execution_expires_after > 259200)) throw new Error("invalid execution_expires_after");
  if (body.priority !== undefined && (!Number.isInteger(body.priority) || body.priority < 0 || body.priority > 9)) throw new Error("invalid priority");
  if (body.callback_url !== undefined && (typeof body.callback_url !== "string" || !/^https?:\/\/[^\s]+$/.test(body.callback_url))) throw new Error("invalid callback_url");
  if (body.safety_identifier !== undefined && (typeof body.safety_identifier !== "string" || !/^[\x20-\x7e]{1,64}$/.test(body.safety_identifier))) throw new Error("invalid safety_identifier");
  const request = copy(body);
  delete request.draft;
  request.resolution = "1080p";
  return { model: body.model, request: request };
}
function nativeDraftOrigin(ctx, metadata) {
  const id = draftTaskID(metadata);
  const origin = (ctx.originTasks || []).find(function (task) { return task.taskId === id; });
  if (!origin) throw new Error("draft task is not available or owned by you");
  const facts = origin.state && origin.state.seedanceDraft;
  if (!facts || facts.version !== 1 || !origin.model || !Number.isInteger(origin.createdAt) || origin.createdAt <= 0) throw new Error("trusted draft facts unavailable; upgrade the gateway and create a new draft");
  if (origin.model !== ctx.model || facts.upstreamModel !== UPSTREAM_MODELS.get(ctx.model) || ctx.upstreamModel && ctx.upstreamModel !== ctx.model && ctx.upstreamModel !== facts.upstreamModel) throw new Error("draft model does not match");
  if (origin.status !== "SUCCESS" || !["text_to_video", "image_to_video"].includes(origin.action) || facts.draft !== true) throw new Error("origin must be a successful draft video");
  const age = utils.unixNow() - origin.createdAt;
  if (age < 0 || age >= 7 * 24 * 60 * 60) throw new Error("draft has expired or has an invalid creation time");
  if (facts.duration !== -1 && (!Number.isInteger(facts.duration) || facts.duration < 4 || facts.duration > 30) || typeof facts.hasVideo !== "boolean") throw new Error("invalid trusted draft billing facts");
  if (!text(origin.upstreamTaskId)) throw new Error("draft upstream reference is unavailable");
  return origin;
}
function validateVideo(body) {
  const model = text(body.model);
  const spec = VIDEO_MODELS.get(model);
  if (!spec) throw new Error("unsupported Seedance model");
  const v25 = model === "doubao-seedance-2-5-hx";
  if (draftTaskID(body)) {
    if (!v25) throw new Error("draft requires Seedance 2.5");
    return normalizeFinalVideo(body);
  }
  if (own(body, "draft") && (!v25 || typeof body.draft !== "boolean")) throw new Error("invalid draft option");
  if (own(body, "service_tier") && body.service_tier !== "default") throw new Error("unsupported service_tier");
  for (const field of Object.keys(body)) {
    if (!["model", "content", "duration", "resolution", "ratio", "draft", "service_tier"].includes(field)) validateVideoExtensions({ [field]: body[field] });
  }
  validateContent(body.content, v25);
  // Keep the deployed 2.0 default; 2.5 defaults to the official automatic mode.
  const duration = own(body, "duration") ? body.duration : v25 ? -1 : 5;
  if (!Number.isInteger(duration) || (duration !== -1 && (duration < 4 || duration > spec[spec.length - 1]))) throw new Error("duration is outside the supported range");
  const resolution = own(body, "resolution") ? text(body.resolution).toLowerCase() : body.draft === true ? "480p" : "720p";
  if (body.draft === true && resolution !== "480p") throw new Error("draft requires 480p");
  if (!spec.slice(0, -1).includes(resolution)) throw new Error("unsupported resolution");
  const ratio = own(body, "ratio") ? body.ratio : "adaptive";
  if (!["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"].includes(ratio)) throw new Error("unsupported ratio");
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
  if (body && body.success === false) return text(body.message) || "upstream request failed";
  const error = body && (body.Error || body.error || (body.Result && body.Result.Error));
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") return text(error.Message || error.message || error.Code || error.code);
  const metadata = body && body.ResponseMetadata;
  if (metadata && metadata.Error) return text(metadata.Error.Message || metadata.Error.Code);
  return "";
}
function validResourceID(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value); }
function assetURL(baseUrl, action) { return baseUrl.replace(/\/+$/, "") + "/api/material?Action=" + action; }
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
      if (!validResourceID(body.Id)) throw new Error("native group id is required");
      request = { Id: text(body.Id) };
    } else {
      if (!validResourceID(body.GroupId)) throw new Error("native group id is required");
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
    const request = { model: video.model, metadata: video.request };
    if (video.request.duration === -1) {
      request.automaticDuration = true;
      delete request.metadata.duration;
    }
    const intent = { kind: "submit", model: video.model, action: taskAction(video.request.content), requestBody: request };
    const draftID = draftTaskID(video.request);
    if (draftID) intent.originTaskIds = [draftID];
    return intent;
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
  error: function (_ctx, error) { return { error: { code: error.code, message: error.message } }; },
};

function isAssetAction(action) { return ASSET_ACTIONS.has(action); }

export function buildSubmitRequest(ctx) {
  if (isAssetAction(ctx.action)) {
    const body = copy(ctx.requestBody);
    return { url: assetURL(ctx.baseUrl, ctx.action), method: "POST", headers: headers(ctx.apiKey), body: body, action: ctx.action };
  }
  const metadata = validatedVideoRequest(ctx);
  const expectedUpstream = UPSTREAM_MODELS.get(ctx.model) || ctx.model;
  if (ctx.upstreamModel && ctx.upstreamModel !== ctx.model && ctx.upstreamModel !== expectedUpstream) throw new Error("upstream model does not match the Seedance HX alias");
  const draftID = draftTaskID(metadata);
  if (draftID) metadata.content[0].draft_task.id = nativeDraftOrigin(ctx, metadata).upstreamTaskId;
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
    const result = { taskId: id, taskData: body };
    if (ctx.requestBody && ctx.requestBody.metadata && ctx.requestBody.metadata.draft === true) {
      const metadata = validatedVideoRequest(ctx);
      result.state = { seedanceDraft: { version: 1, draft: true, duration: metadata.duration, hasVideo: hasVideo(metadata.content), upstreamModel: UPSTREAM_MODELS.get(ctx.model) } };
    }
    return result;
  }
  if (ctx.action === "ListAssetGroups") {
    if (!body.Result || !Array.isArray(body.Result.Items)) throw new Error("invalid asset group list");
    return { taskId: ctx.publicTaskId || utils.uuid(), taskData: body, immediate: { status: "SUCCESS", progress: "100%" } };
  }
  const id = responseID(body);
  if (ctx.action === "CreateAsset") {
    if (!validResourceID(id)) throw new Error("native asset id is empty or invalid");
    return { taskId: id, taskData: body };
  }
  if (!validResourceID(id)) throw new Error("native group id is empty or invalid");
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
      if (!validResourceID(asset.Id)) return { status: "UNKNOWN", reason: "invalid native asset id" };
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
  if (draftTaskID(metadata)) {
    const facts = nativeDraftOrigin(ctx, metadata).state.seedanceDraft;
    const seconds = (facts.duration === -1 ? 30 : facts.duration) + (facts.hasVideo ? 30 : 0);
    return { tokens: estimateTokens(seconds, "1080p"), resolution: "1080p", video_input: facts.hasVideo ? "video" : "none" };
  }
  const spec = VIDEO_MODELS.get(ctx.model);
  const seconds = (metadata.duration === -1 ? spec[spec.length - 1] : metadata.duration) + (metadata.draft === true && hasVideo(metadata.content) ? 30 : 0);
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

// APIMart Midjourney task integration. This is intentionally separate from
// the APIMart image-model plugin: Midjourney exposes a task workflow with
// follow-up operations instead of an OpenAI-compatible image contract.
export const meta = {
  apiVersion: 1,
  key: "apimart-midjourney",
  name: "APIMart Midjourney",
  icon: "text:MJ",
  description: {
    en: "APIMart Midjourney asynchronous image and image-to-video tasks",
    zh: "APIMart Midjourney 异步绘图与图生视频任务",
  },
  version: "0.1.0",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  allowedHosts: ["api.apimart.ai", "cdn.apimart.ai"],
  models: ["midjourney-am"],
  routes: [
    { method: "POST", path: "/apimart/midjourney/v1/generations", type: "submit", action: "imagine", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/blend", type: "submit", action: "blend", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/edits", type: "submit", action: "edits", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/upscale", type: "submit", action: "upscale", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/variation", type: "submit", action: "variation", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/high-variation", type: "submit", action: "high_variation", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/low-variation", type: "submit", action: "low_variation", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/reroll", type: "submit", action: "reroll", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/zoom", type: "submit", action: "zoom", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/pan", type: "submit", action: "pan", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/remix-strong", type: "submit", action: "remix_strong", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/remix-subtle", type: "submit", action: "remix_subtle", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "POST", path: "/apimart/midjourney/v1/generations/video", type: "submit", action: "video", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "GET", path: "/apimart/midjourney/v1/tasks/:task_id", type: "query", render: "renderTask" },
  ],
};

const FOLLOW_UP_ACTIONS = new Set(["upscale", "variation", "high_variation", "low_variation", "reroll", "zoom", "pan", "remix_strong", "remix_subtle"]);
const INDEXED_ACTIONS = new Set(["upscale", "variation", "high_variation", "low_variation", "remix_strong", "remix_subtle"]);

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function actionPath(action) {
  const suffix = {
    imagine: "",
    blend: "/blend",
    edits: "/edits",
    upscale: "/upscale",
    variation: "/variation",
    high_variation: "/high-variation",
    low_variation: "/low-variation",
    reroll: "/reroll",
    zoom: "/zoom",
    pan: "/pan",
    remix_strong: "/remix-strong",
    remix_subtle: "/remix-subtle",
    video: "/video",
  };
  if (suffix[action] === undefined) throw new Error("unsupported Midjourney action");
  return "/v1/midjourney/generations" + suffix[action];
}

function taskData(value) {
  const outer = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? outer.data : outer;
}

function normalizeStatus(value) {
  const status = trimmed(value).toUpperCase();
  if (["NOT_START", "SUBMITTED", "QUEUED", "PENDING"].includes(status)) return "SUBMITTED";
  if (["IN_PROGRESS", "PROCESSING"].includes(status)) return "IN_PROGRESS";
  if (["SUCCESS", "COMPLETED"].includes(status)) return "SUCCESS";
  if (["FAILURE", "FAILED"].includes(status)) return "FAILURE";
  if (status === "MODAL") return "IN_PROGRESS";
  return "UNKNOWN";
}

function responseError(response, fallback) {
  const body = response && response.body;
  const error = body && body.error;
  return trimmed(error && error.message) || trimmed(body && body.message) || fallback;
}

function publicTaskID(task) {
  return trimmed(task && task.task_id) || trimmed(task && task.id);
}

function publicTaskData(task) {
  const data = taskData(task && task.data);
  const result = Object.assign({}, data);
  result.id = publicTaskID(task);
  delete result.task_id;
  return result;
}

function taskURLs(task) {
  const data = taskData(task && task.data);
  const images = Array.isArray(data.image_urls) ? data.image_urls : [];
  const videos = Array.isArray(data.video_urls) ? data.video_urls : [];
  const urls = [];
  for (const url of images.concat(videos)) {
    if (trimmed(url)) urls.push(trimmed(url));
  }
  if (urls.length === 0 && trimmed(data.video_url)) urls.push(trimmed(data.video_url));
  return urls;
}

function artifactKey(index, url) {
  return "asset-" + index + "-" + utils.hmacSHA256(url, "new-api:apimart-midjourney:artifact-key");
}

function isVideoURL(url) {
  return /\.(mp4|webm|mov)(?:$|[?#])/i.test(url);
}

function requireTaskID(request) {
  const taskID = trimmed(request.task_id);
  if (!taskID) throw new Error("task_id is required");
  return taskID;
}

function validateModel(request) {
  const model = request.model === undefined ? "midjourney-am" : trimmed(request.model);
  if (model !== "midjourney-am") throw new Error("model must be midjourney-am");
  return model;
}

function validateImages(request, minimum, maximum, field) {
  const images = request[field || "image_urls"];
  if (!Array.isArray(images) || images.length < minimum || images.length > maximum || images.some(function (value) { return !trimmed(value); })) {
    throw new Error((field || "image_urls") + " must contain " + minimum + " to " + maximum + " non-empty URLs");
  }
}

function validateActionRequest(action, request) {
  if (action === "imagine" && !trimmed(request.prompt)) throw new Error("prompt is required");
  if (action === "blend") validateImages(request, 2, 4);
  if (action === "edits") {
    if (!trimmed(request.prompt)) throw new Error("prompt is required");
    validateImages(request, 1, 16);
  }
  if (FOLLOW_UP_ACTIONS.has(action)) {
    requireTaskID(request);
    if (INDEXED_ACTIONS.has(action) && (!Number.isInteger(request.index) || request.index < 1 || request.index > 4)) {
      throw new Error("index must be an integer between 1 and 4");
    }
  }
  if (action === "video") {
    const hasImages = Array.isArray(request.image_urls) && request.image_urls.length > 0;
    const hasTask = Boolean(trimmed(request.task_id));
    if (hasImages === hasTask) throw new Error("provide exactly one of image_urls or task_id");
    if (hasImages) validateImages(request, 1, 1);
    if (hasTask) requireTaskID(request);
    if (request.batch_size !== undefined && ![1, 2, 4].includes(request.batch_size)) {
      throw new Error("batch_size must be 1, 2, or 4");
    }
  }
}

function originTaskIDs(action, request) {
  if (FOLLOW_UP_ACTIONS.has(action) || (action === "video" && trimmed(request.task_id))) return [requireTaskID(request)];
  return undefined;
}

function upstreamOriginTaskID(ctx, request) {
  const origins = Array.isArray(ctx.originTasks) ? ctx.originTasks : [];
  const origin = origins[0];
  const taskID = trimmed(origin && origin.upstreamTaskId);
  if (trimmed(request.task_id) && !taskID) throw new Error("referenced task is unavailable");
  return taskID;
}

export const native = {
  decodeSubmit: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const request = object(ctx.body.value, "request body must be an object");
    const model = validateModel(request);
    const action = trimmed(ctx.action);
    validateActionRequest(action, request);
    const body = Object.assign({}, request);
    delete body.model;
    const intent = { kind: "submit", model: model, action: action, requestBody: body };
    const origins = originTaskIDs(action, request);
    if (origins) intent.originTaskIds = origins;
    return intent;
  },
  renderSubmitted: function (_ctx, task) {
    return { code: 200, data: [{ status: "submitted", task_id: publicTaskID(task) }] };
  },
  renderTask: function (_ctx, task) {
    return publicTaskData(task);
  },
  error: function (_ctx, error) {
    return { code: error.code, message: error.message };
  },
};

export function buildSubmitRequest(ctx) {
  const request = object(ctx.requestBody, "Midjourney request is required");
  const body = Object.assign({}, request);
  if (trimmed(body.task_id)) body.task_id = upstreamOriginTaskID(ctx, body);
  return {
    url: ctx.baseUrl + actionPath(ctx.action),
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: ctx.action,
  };
}

export function parseSubmitResponse(_ctx, response) {
  const body = object(response && response.body, "invalid APIMart Midjourney submission response");
  if (Number(body.code) !== 200) throw new Error(responseError(response, "APIMart Midjourney task submission failed"));
  const entries = Array.isArray(body.data) ? body.data : [];
  const submitted = entries[0] && typeof entries[0] === "object" ? entries[0] : {};
  const taskID = trimmed(submitted.task_id) || trimmed(submitted.id);
  if (!taskID) throw new Error("APIMart Midjourney submission response is missing task_id");
  return { taskId: taskID, taskData: body };
}

export function buildQueryRequest(ctx) {
  const taskID = trimmed(ctx.taskId);
  if (!taskID) throw new Error("task_id is required");
  return {
    url: ctx.baseUrl + "/v1/tasks/" + encodeURIComponent(taskID),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(_ctx, body) {
  const response = object(body, "invalid APIMart Midjourney task response");
  if (Number(response.code) && Number(response.code) !== 200) {
    return { code: Number(response.code), status: "FAILURE", progress: "100%", reason: trimmed(response.message) || "APIMart Midjourney task query failed" };
  }
  const data = taskData(response);
  const status = normalizeStatus(data.status);
  if (status === "UNKNOWN") return { status: "UNKNOWN", reason: "unrecognized APIMart Midjourney task status: " + String(data.status || "") };
  return {
    status: status,
    progress: status === "SUCCESS" || status === "FAILURE" ? "100%" : trimmed(data.progress),
    reason: status === "FAILURE" ? trimmed(data.fail_reason) || trimmed(data.message) || "APIMart Midjourney task failed" : "",
  };
}

export function listArtifacts(task) {
  if (String(task && task.status || "").toUpperCase() !== "SUCCESS") return [];
  return taskURLs(task).map(function (url, index) {
    return { key: artifactKey(index, url), type: isVideoURL(url) ? "video" : "image" };
  });
}

export function buildContentRequest(ctx) {
  const urls = taskURLs(ctx);
  for (let index = 0; index < urls.length; index += 1) {
    if (artifactKey(index, urls[index]) === ctx.artifactKey) {
      return { url: urls[index], method: ctx.clientRequest.method, credentialless: true };
    }
  }
  throw new Error("artifact_not_found");
}

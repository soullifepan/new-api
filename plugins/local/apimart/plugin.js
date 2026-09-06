// APIMart image-task integration. Keep this outside plugins/tasks: it is a
// local, uploadable extension rather than an embedded upstream plugin.
export const meta = {
  apiVersion: 1,
  key: "apimart",
  name: "APIMart",
  icon: "text:AP",
  description: {
    en: "APIMart asynchronous image generation tasks",
    zh: "APIMart 异步图片生成任务",
  },
  version: "0.1.2",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  // api.apib.ai is the configured API entrypoint. APIMart-compatible image
  // results may still be served from the legacy upload/CDN hosts.
  allowedHosts: ["api.apib.ai", "upload.apimart.ai", "cdn.apimart.ai"],
  // The implementation is protocol-based. Adding another documented model is
  // a manifest/config release, not a new plugin implementation.
  models: [
    "gpt-image-2",
    "gpt-image-2-am",
    "gpt-image-2-ext",
    "gpt-image-2-official",
    "gpt-4o-image",
    "gpt-image-1-official",
    "gpt-image-1.5-official",
    "nano-banana-2",
    "nano-banana-2-ext",
    "gemini-3.1-flash-image-preview",
    "gemini-3.1-flash-image-preview-official",
    "flux-2-flex",
    "flux-2-pro",
    "flux-kontext-pro",
    "doubao-seedance-4-0",
    "doubao-seedance-4-5",
    "grok-imagine-1.0-apimart",
  ],
  routes: [
    { method: "POST", path: "/apimart/v1/images/generations", type: "submit", decode: "decodeImageGeneration", render: "renderSubmitted" },
    { method: "GET", path: "/apimart/v1/tasks/:task_id", type: "query", render: "renderTask" },
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

function imageTaskData(task) {
  const snapshot = task && task.data;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};
  return snapshot.data && typeof snapshot.data === "object" && !Array.isArray(snapshot.data) ? snapshot.data : {};
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
  if (error && typeof error === "object" && trimmed(error.message)) return trimmed(error.message);
  return trimmed(fallback);
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
  const model = trimmed(ctx.upstreamModel || ctx.model || request.model);
  if (!isDeclaredModel(model)) throw new Error("unsupported APIMart image model");
  const body = Object.assign({}, request, { model: model });
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
  const body = object(response && response.body, "invalid APIMart submit response");
  if (Number(body.code) !== 200) throw new Error(trimmed(body.message) || "APIMart image task submission failed");
  const entries = Array.isArray(body.data) ? body.data : [];
  const submitted = entries[0] && typeof entries[0] === "object" ? entries[0] : {};
  const taskId = trimmed(submitted.task_id);
  if (!taskId) throw new Error("APIMart submit response is missing task_id");
  return { taskId: taskId, taskData: body };
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
  const response = object(body, "invalid APIMart task response");
  if (Number(response.code) !== 200) {
    return { code: Number(response.code) || 0, status: "FAILURE", progress: "100%", reason: trimmed(response.message) || "APIMart task query failed" };
  }
  const data = object(response.data, "APIMart task response is missing data");
  const statuses = {
    submitted: "SUBMITTED",
    queued: "SUBMITTED",
    in_progress: "IN_PROGRESS",
    processing: "IN_PROGRESS",
    completed: "SUCCESS",
    failed: "FAILURE",
  };
  const status = statuses[trimmed(data.status).toLowerCase()];
  if (!status) return { status: "UNKNOWN", reason: "unrecognized APIMart task status: " + String(data.status || "") };
  const result = {
    status: status,
    progress: status === "SUCCESS" || status === "FAILURE" ? "100%" : progressValue(data.progress) !== undefined ? String(progressValue(data.progress)) + "%" : "",
    reason: status === "FAILURE" ? failureReason(data, "APIMart image task failed") : "",
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
    if (!isDeclaredModel(model)) throw new Error("unsupported APIMart image model");
    if (!trimmed(request.prompt) && (!Array.isArray(request.image_urls) || request.image_urls.length === 0)) {
      throw new Error("prompt or image_urls is required");
    }
    if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 4)) {
      throw new Error("n must be an integer between 1 and 4");
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
    return { code: error.code, message: error.message };
  },
};

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
  version: "0.7.2",
  author: { name: "Tapcomfy" },
  fetchMode: "per_task",
  usageSchemaByModel: {
    "gpt-image-2-am": {
      images: {
        type: "number",
        unit: "count",
        description: { en: "Number of successfully generated images.", zh: "成功生成图片的数量。" },
      },
      resolution: {
        enum: ["default", "1k", "2k", "4k"],
        description: { en: "Requested output resolution tier.", zh: "请求的输出分辨率档位。" },
      },
      input_images: {
        type: "number",
        unit: "count",
        description: { en: "Number of input reference and mask images.", zh: "输入参考图和遮罩图数量。" },
      },
    },
    "gpt-image-2-official-am": {
      upstream_credits: {
        type: "number",
        unit: "credit",
        description: {
          en: "Estimated at submission and replaced by APIMart's completed task deduction.",
          zh: "提交时预估，任务完成后由 APIMart 实际扣减积分覆盖。",
        },
      },
    },
  },
  usageExamplesByModel: {
    "gpt-image-2-am": [
      { label: "Default · 1 image", facts: { images: 1, resolution: "default", input_images: 0 } },
      { label: "2K · 1 image", facts: { images: 1, resolution: "2k", input_images: 0 } },
      { label: "4K · 1 image", facts: { images: 1, resolution: "4k", input_images: 0 } },
    ],
    "gpt-image-2-official-am": [
      { label: "Low · 1K · 1 image (estimated)", facts: { upstream_credits: 0.06 } },
      { label: "Low · 2K · 1 image (estimated)", facts: { upstream_credits: 0.12 } },
      { label: "Low · 4K · 1 image (estimated)", facts: { upstream_credits: 0.20 } },
      { label: "Medium · 1K · 1 image (estimated)", facts: { upstream_credits: 0.53 } },
      { label: "Medium · 2K · 1 image (estimated)", facts: { upstream_credits: 1.07 } },
      { label: "Medium · 4K · 1 image (estimated)", facts: { upstream_credits: 1.78 } },
      { label: "High · 1K · 1 image (estimated)", facts: { upstream_credits: 2.11 } },
      { label: "High · 2K · 1 image (estimated)", facts: { upstream_credits: 4.28 } },
      { label: "High · 4K · 1 image (estimated)", facts: { upstream_credits: 7.12 } },
    ],
  },
  // api.apib.ai is the configured API entrypoint. APIMart-compatible image
  // results may still be served from the legacy upload/CDN hosts.
  allowedHosts: ["api.apib.ai", "upload.apimart.ai", "cdn.apimart.ai"],
  // Keep only explicit APIMart aliases here. Standard model names must remain
  // available to ordinary channels without being classified as task models.
  models: [
    "gpt-image-2-am",
    "gpt-image-2-official-am",
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
  const publicModel = trimmed(ctx.model || request.model);
  const model = trimmed(ctx.upstreamModel || publicModel);
  if (!isDeclaredModel(publicModel)) throw new Error("unsupported APIMart image model");
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

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const request = ctx.requestBody || {};
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
    return { code: error.code, message: error.message };
  },
};

const REGISTRY_VERSION = "public-2026-04-29";
const PRICING_VERSION = "public-2026-04-29";
const MAX_UPSTREAM_CREDITS = 2_147_483_647;
const USAGE_SCHEMA = {
  upstream_cny: {
    type: "number",
    unit: "credit",
    description: { en: "Actual CNY cost unit price", zh: "实际人民币成本单价" },
  },
};

const TOOLS = {
  "volc-subtitle-erase/video": {
    fields: { videoUrl: { type: "url", required: true } },
    durationLimit: 3600,
    price: 0.005,
  },
  "volc-subtitle-erase-pro/video": {
    fields: {
      videoUrl: { type: "url", required: true },
      eraseType: { type: "list", values: ["subtitle", "text"] },
      encodeMode: { type: "list", values: ["size", "quality"] },
    },
    durationLimit: 3600,
    price: 0.013,
  },
  "mureka-ai/stem-song": {
    fields: {
      url: { type: "url", required: true },
      rh_model: { type: "list", required: true, values: ["audio-separation-1", "audio-separation-2"] },
    },
    prices: { "audio-separation-1": 0.408, "audio-separation-2": 4.762 },
  },
  "rhart-video/video-upscaler": {
    fields: {
      videoUrl: { type: "url", required: true },
      targetResolution: { type: "list", required: true, values: ["720p", "1080p", "2k", "4k"] },
    },
    durationLimit: 600,
    prices: { "720p": 0.14, "1080p": 0.21, "2k": 0.35, "4k": 0.56 },
  },
  "rhart-video/video-fps-increaser": {
    fields: { videoUrl: { type: "url", required: true } },
    durationLimit: 3600,
    price: 0.07,
  },
};

export const meta = {
  apiVersion: 1,
  key: "rh-tools",
  name: "RunningHub tools",
  icon: "text:Tools",
  description: { en: "RunningHub tools", zh: "RunningHub 工具" },
  version: "0.1.0",
  author: { name: "QuantumNous" },
  baseUrl: "https://www.runninghub.cn",
  models: Object.keys(TOOLS),
  fetchMode: "per_task",
  auth: "api_key",
  usageSchema: USAGE_SCHEMA,
  usageExamples: [{ label: "¥1 upstream cost", facts: { upstream_cny: 1 } }],
  usageProfiles: [
    {
      models: ["volc-subtitle-erase/video"],
      schema: USAGE_SCHEMA,
      examples: [{ label: "10 seconds · estimate", facts: { upstream_cny: 0.05 } }],
    },
    {
      models: ["volc-subtitle-erase-pro/video"],
      schema: USAGE_SCHEMA,
      examples: [{ label: "10 seconds · estimate", facts: { upstream_cny: 0.13 } }],
    },
    {
      models: ["mureka-ai/stem-song"],
      schema: USAGE_SCHEMA,
      examples: [
        { label: "audio-separation-1 · per task · estimate", facts: { upstream_cny: 0.408 } },
        { label: "audio-separation-2 · per task · estimate", facts: { upstream_cny: 4.762 } },
      ],
    },
    {
      models: ["rhart-video/video-upscaler"],
      schema: USAGE_SCHEMA,
      examples: [
        { label: "720p · 10 seconds · estimate", facts: { upstream_cny: 1.4 } },
        { label: "1080p · 10 seconds · estimate", facts: { upstream_cny: 2.1 } },
        { label: "2k · 10 seconds · estimate", facts: { upstream_cny: 3.5 } },
        { label: "4k · 10 seconds · estimate", facts: { upstream_cny: 5.6 } },
      ],
    },
    {
      models: ["rhart-video/video-fps-increaser"],
      schema: USAGE_SCHEMA,
      examples: [{ label: "10 seconds · estimate", facts: { upstream_cny: 0.7 } }],
    },
  ],
  routes: [
    { method: "POST", path: "/rh-tools/v1/tasks", type: "submit", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "GET", path: "/rh-tools/v1/tasks/:task_id", type: "query", render: "renderTask" },
  ],
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function selectedModel(ctx) {
  const model = trimmed(ctx.upstreamModel || ctx.model);
  if (!TOOLS[model]) throw new Error("unsupported RunningHub tool model");
  return model;
}

function absoluteHTTPSURL(value, field) {
  if (typeof value !== "string" || value.length > 2048 || !/^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(value)) {
    throw new Error(field + " must be an absolute https URL");
  }
  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  const host = authority.startsWith("[") ? authority.slice(1).split("]", 1)[0] : authority.split(":", 1)[0];
  if (!host || authority.includes("@")) throw new Error(field + " must be an absolute https URL");
  return value;
}

function requestForModel(model, value) {
  const request = object(value, "request body must be an object");
  const tool = TOOLS[model];
  if (!tool) throw new Error("unsupported RunningHub tool model");
  for (const key of Object.keys(request)) {
    if (key !== "model" && key !== "duration_seconds" && !hasOwn(tool.fields, key)) {
      throw new Error("unsupported field for " + model + ": " + key);
    }
  }
  if (request.model !== undefined && request.model !== model) {
    throw new Error("model must match the selected RunningHub tool");
  }
  const output = {};
  for (const [field, definition] of Object.entries(tool.fields)) {
    if (!hasOwn(request, field)) {
      if (definition.required) throw new Error(field + " is required");
      continue;
    }
    if (definition.type === "url") output[field] = absoluteHTTPSURL(request[field], field);
    else if (typeof request[field] !== "string" || !definition.values.includes(request[field])) {
      throw new Error(field + " must be one of " + definition.values.join(", "));
    } else output[field] = request[field];
  }
  if (tool.durationLimit === undefined) {
    if (hasOwn(request, "duration_seconds")) throw new Error("duration_seconds is not supported for " + model);
  } else {
    const duration = request.duration_seconds;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > tool.durationLimit) {
      throw new Error("duration_seconds must be a finite number greater than 0 and at most " + tool.durationLimit);
    }
    output.duration_seconds = duration;
  }
  return output;
}

function requestURL(baseURL, endpoint) {
  const root = trimmed(baseURL).replace(/\/+$/, "");
  if (!root) throw new Error("RunningHub base URL is required");
  return root + "/openapi/v2/" + endpoint;
}

function authorization(ctx) {
  const credential = trimmed(ctx.apiKey);
  if (!credential) throw new Error("RunningHub channel credential is required");
  return "Bearer " + credential;
}

function taskData(value, message) {
  const body = object(value, message);
  if (!trimmed(body.taskId)) throw new Error("RunningHub response is missing taskId");
  if (!trimmed(body.status)) throw new Error("RunningHub response is missing status");
  return body;
}

function truncate(value) {
  return trimmed(value).slice(0, 300);
}

function failureReason(body) {
  const message = truncate(body.errorMessage);
  if (message) return message;
  const code = truncate(body.errorCode);
  if (code) return code;
  if (body.failedReason && typeof body.failedReason === "object" && !Array.isArray(body.failedReason)) {
    const serialized = JSON.stringify(body.failedReason);
    if (serialized !== "{}") return serialized.slice(0, 300);
  }
  return "RunningHub task failed";
}

function outputEntries(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.results)) return [];
  const entries = [];
  const urls = new Set();
  for (const result of data.results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const url = trimmed(result.url || result.outputUrl);
    if (!/^https?:\/\/[^\s]+$/i.test(url) || urls.has(url)) continue;
    urls.add(url);
    entries.push({ url: url, outputType: trimmed(result.outputType).toLowerCase() });
    if (entries.length === 16) break;
  }
  return entries;
}

function upstreamCNY(body) {
  const usage = body && body.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  let total = 0;
  let found = false;
  for (const field of ["consumeMoney", "thirdPartyConsumeMoney", "consumeCoins"]) {
    const value = usage[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
    found = true;
    total += field === "consumeCoins" ? Number(value) / 250 : Number(value);
  }
  if (!found || !Number.isFinite(total) || total > MAX_UPSTREAM_CREDITS) return null;
  return total;
}

function nativeTask(task) {
  const status = String(task.status || "").toUpperCase();
  let data = null;
  if (task.data === undefined) {
    data = null;
  } else if (task.data && typeof task.data === "object" && !Array.isArray(task.data)) {
    data = { ...task.data };
  } else {
    data = task.data;
  }
  if (data && typeof data === "object") {
    delete data.usage;
    delete data.taskUsageList;
  }
  const output = {
    task_id: task.task_id || "",
    status: status,
    progress: task.progress || "",
    fail_reason: task.fail_reason || "",
    data: data,
  };
  if (status === "SUCCESS") output.artifact_metadata = { source: "RunningHub temporary result URL" };
  return output;
}

export function buildSubmitRequest(ctx) {
  const model = selectedModel(ctx);
  const request = requestForModel(model, ctx.requestBody);
  delete request.duration_seconds;
  if (model === "mureka-ai/stem-song") {
    request.model = request.rh_model;
    delete request.rh_model;
  }
  return {
    url: requestURL(ctx.baseUrl, model),
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization(ctx),
    },
    body: request,
    action: "rh_tool",
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid RunningHub submission response");
  const taskId = trimmed(body.taskId);
  if (taskId) return { taskId: taskId, taskData: body };
  const errorCode = trimmed(body.errorCode);
  if (errorCode) {
    return {
      taskId: "rh-rejected-" + (trimmed(ctx.publicTaskId) || utils.uuid()),
      taskData: body,
      immediate: {
        status: "FAILURE",
        reason: "RunningHub error " + errorCode + ": " + truncate(body.errorMessage),
      },
    };
  }
  throw new Error("RunningHub response is missing taskId");
}

export function buildQueryRequest(ctx) {
  const taskId = trimmed(ctx.taskId);
  if (!taskId) throw new Error("task_id is required");
  return {
    url: requestURL(ctx.baseUrl, "query"),
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization(ctx),
    },
    body: { taskId: taskId },
  };
}

export function parseTaskResult(_ctx, body) {
  const task = taskData(body, "invalid RunningHub task response");
  const status = trimmed(task.status).toUpperCase();
  if (["CREATE", "QUEUED"].includes(status)) return { status: "QUEUED", progress: "" };
  if (status === "RUNNING") return { status: "IN_PROGRESS", progress: "" };
  if (["FAILED", "CANCEL"].includes(status)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(task) };
  }
  if (status === "SUCCESS") {
    if (!outputEntries(task).length) {
      return { status: "UNKNOWN", reason: "RunningHub success response is missing a result URL" };
    }
    return { status: "SUCCESS", progress: "100%", reason: "" };
  }
  return { status: "UNKNOWN", reason: "unrecognized RunningHub task status: " + status };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const model = selectedModel(ctx);
  const request = requestForModel(model, ctx.requestBody);
  const tool = TOOLS[model];
  const price = tool.price || tool.prices[request.rh_model || request.targetResolution];
  const estimate = tool.durationLimit === undefined ? price : price * request.duration_seconds;
  return { upstream_cny: Number(estimate.toFixed(6)) };
}

export function extractUsageOnComplete(task, result, body) {
  if (!TOOLS[trimmed(task && (task.upstreamModel || task.model))]) return null;
  const status = String((result && result.status) || "").toUpperCase();
  if (["FAILURE", "CANCELLED", "CANCELED"].includes(status)) return { upstream_cny: 0 };
  if (status !== "SUCCESS") return null;
  const cny = upstreamCNY(body);
  return cny === null ? null : { upstream_cny: cny };
}

export function listArtifacts(task) {
  if (String((task && task.status) || "").toUpperCase() !== "SUCCESS") return [];
  return outputEntries(task.data).map(function (entry, index) {
    const artifact = { key: "output-" + index, type: "file" };
    if (entry.outputType === "mp4") {
      artifact.type = "video";
      artifact.mimeType = "video/mp4";
    }
    if (entry.outputType === "mp3") {
      artifact.type = "audio";
      artifact.mimeType = "audio/mpeg";
    }
    if (entry.outputType === "zip") artifact.mimeType = "application/zip";
    return artifact;
  });
}

export function buildContentRequest(ctx) {
  if (String((ctx && ctx.status) || "").toUpperCase() !== "SUCCESS") throw new Error("artifact_not_found");
  const match = /^output-(\d+)$/.exec(String(ctx.artifactKey || ""));
  if (!match) throw new Error("artifact_not_found");
  const entry = outputEntries(ctx.data)[Number(match[1])];
  if (!entry) throw new Error("artifact_not_found");
  const method = String((ctx.clientRequest && ctx.clientRequest.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("unsupported artifact method");
  return { url: entry.url, method: method, credentialless: true };
}

export const native = {
  decodeSubmit: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = object(ctx.body.value, "request body must be an object");
    const model = trimmed(body.model);
    if (!TOOLS[model]) throw new Error("unsupported RunningHub tool model");
    return { kind: "submit", model: model, action: "rh_tool", requestBody: requestForModel(model, body) };
  },
  renderSubmitted: function (_ctx, task) {
    return { task_id: task.task_id || "", status: task.status || "SUBMITTED" };
  },
  renderTask: function (_ctx, task) {
    return nativeTask(task);
  },
  error: function (_ctx, error) {
    return { code: error.code, message: error.message };
  },
};

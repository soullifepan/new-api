const MODEL = "elevenlabs/dubbing";
const ACTION = "dubbing";
// USD per minute of source media, billed on the media duration rounded up to the second.
const DUBBING_PRICES = { dubbing_v1: 0.5, dubbing_v2: 2.2 };
const DEFAULT_DUBBING_MODEL = "dubbing_v1";
// Phase 1 accepts at most one hour; the upstream decodes up to four hours.
const MAX_REQUEST_SECONDS = 3600;
const MAX_MEDIA_SECONDS = 14400;
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const REQUEST_FIELDS = ["model", "mediaUrl", "target_language", "source_language", "dubbing_model", "duration_seconds"];
const OUTPUTS = [
  { key: "lossless_audio", outputType: "flac", type: "audio", mimeType: "audio/flac" },
  { key: "subtitles", outputType: "vtt", type: "file", mimeType: "text/vtt" },
];
const USAGE_SCHEMA = {
  upstream_usd: {
    type: "number",
    unit: "credit",
    description: { en: "Actual USD cost unit price", zh: "实际美元成本单价" },
  },
};

export const meta = {
  apiVersion: 1,
  key: "el-tools",
  name: "ElevenLabs tools",
  icon: "text:EL",
  description: { en: "ElevenLabs dubbing via azopenai", zh: "通过 azopenai 调用 ElevenLabs 配音" },
  version: "0.1.0",
  author: { name: "QuantumNous" },
  baseUrl: "https://llm.azopenai.com",
  models: [MODEL],
  fetchMode: "per_task",
  auth: "api_key",
  usageSchema: USAGE_SCHEMA,
  usageExamples: [
    { label: "dubbing_v1 · 60 seconds · estimate", facts: { upstream_usd: 0.5 } },
    { label: "dubbing_v2 · 60 seconds · estimate", facts: { upstream_usd: 2.2 } },
  ],
  routes: [
    { method: "POST", path: "/el-tools/v1/tasks", type: "submit", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "GET", path: "/el-tools/v1/tasks/:task_id", type: "query", render: "renderTask" },
  ],
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function languageTag(value, field) {
  if (typeof value !== "string" || value.length > 35 || !LANGUAGE_TAG.test(value)) {
    throw new Error(field + " must be a BCP-47 language tag such as zh, en or es-MX");
  }
  return value;
}

function dubbingRequest(value) {
  const request = object(value, "request body must be an object");
  for (const key of Object.keys(request)) {
    if (!REQUEST_FIELDS.includes(key)) throw new Error("unsupported field for " + MODEL + ": " + key);
  }
  if (request.model !== undefined && request.model !== MODEL) throw new Error("model must be " + MODEL);
  const output = {
    mediaUrl: absoluteHTTPSURL(request.mediaUrl, "mediaUrl"),
    target_language: languageTag(request.target_language, "target_language"),
  };
  // An empty or "auto" source language lets the upstream detect it.
  if (hasOwn(request, "source_language") && !["", "auto"].includes(trimmed(request.source_language))) {
    output.source_language = languageTag(request.source_language, "source_language");
  }
  const dubbingModel = request.dubbing_model === undefined ? DEFAULT_DUBBING_MODEL : request.dubbing_model;
  if (typeof dubbingModel !== "string" || !hasOwn(DUBBING_PRICES, dubbingModel)) {
    throw new Error("dubbing_model must be one of " + Object.keys(DUBBING_PRICES).join(", "));
  }
  output.dubbing_model = dubbingModel;
  const duration = request.duration_seconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_REQUEST_SECONDS) {
    throw new Error("duration_seconds must be a finite number greater than 0 and at most " + MAX_REQUEST_SECONDS);
  }
  output.duration_seconds = duration;
  return output;
}

function selectedModel(ctx) {
  const model = trimmed(ctx.upstreamModel || ctx.model);
  if (model !== MODEL) throw new Error("unsupported ElevenLabs tool model");
  return model;
}

function upstreamUSD(dubbingModel, seconds) {
  return Number(((Math.ceil(seconds) / 60) * DUBBING_PRICES[dubbingModel]).toFixed(6));
}

function projectURL(baseURL, projectID) {
  const root = trimmed(baseURL).replace(/\/+$/, "");
  if (!root) throw new Error("ElevenLabs tools base URL is required");
  const path = root + "/v1/dubbing/project";
  return projectID ? path + "/" + encodeURIComponent(projectID) : path;
}

function authorization(ctx) {
  const credential = trimmed(ctx.apiKey);
  if (!credential) throw new Error("ElevenLabs tools channel credential is required");
  return "Bearer " + credential;
}

function dubbingState(value) {
  const state = plainObject(value) || {};
  const output = {};
  for (const key of ["language_id", "dubbing_model", "target_language"]) {
    if (trimmed(state[key])) output[key] = trimmed(state[key]);
  }
  if (typeof state.duration_s === "number" && state.duration_s > 0 && state.duration_s <= MAX_MEDIA_SECONDS) {
    output.duration_s = state.duration_s;
  }
  if (state.project_ready === true) output.project_ready = true;
  return output;
}

function mediaSeconds(project) {
  const media = plainObject(project.media);
  const seconds = media && media.duration_s;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_MEDIA_SECONDS
    ? seconds
    : null;
}

function truncate(value) {
  return trimmed(value).slice(0, 300);
}

function failureReason(body, fallback) {
  const error = body.error;
  if (typeof error === "string" && trimmed(error)) return truncate(error);
  if (plainObject(error)) {
    const message = truncate(error.message) || truncate(error.detail);
    if (message) return message;
    const serialized = JSON.stringify(error);
    if (serialized !== "{}") return serialized.slice(0, 300);
  }
  return fallback;
}

function outputEntries(data) {
  const outputs = plainObject(data) && plainObject(data.outputs);
  if (!outputs) return [];
  const entries = [];
  for (const output of OUTPUTS) {
    const url = trimmed(outputs[output.key]);
    if (!/^https:\/\/[^\s]+$/i.test(url)) return [];
    entries.push({ url: url, outputType: output.outputType });
  }
  return entries;
}

function nativeTask(task) {
  const status = String(task.status || "").toUpperCase();
  const snapshot = plainObject(task.data) || {};
  const data = {
    target_language: trimmed(snapshot.target_language),
    upstream_status: trimmed(snapshot.status),
    results: status === "SUCCESS" ? outputEntries(snapshot) : [],
  };
  const output = {
    task_id: task.task_id || "",
    status: status,
    progress: task.progress || "",
    fail_reason: task.fail_reason || "",
    data: data,
  };
  if (status === "SUCCESS") output.artifact_metadata = { source: "ElevenLabs signed result URL" };
  return output;
}

export function buildSubmitRequest(ctx) {
  selectedModel(ctx);
  const request = dubbingRequest(ctx.requestBody);
  const parts = [
    { name: "model_id", value: request.dubbing_model },
    { name: "source_url", value: request.mediaUrl },
    { name: "target_language", value: request.target_language },
  ];
  if (request.source_language) parts.push({ name: "source_language", value: request.source_language });
  // The public task id tags the upstream project, so an unclear creation can be
  // matched in the project list instead of being submitted again.
  if (trimmed(ctx.publicTaskId)) parts.push({ name: "reference", value: trimmed(ctx.publicTaskId) });
  return {
    url: projectURL(ctx.baseUrl),
    method: "POST",
    headers: { Accept: "application/json", Authorization: authorization(ctx) },
    bodyType: "multipart",
    parts: parts,
    action: ACTION,
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid ElevenLabs dubbing submission response");
  const projectID = trimmed(body.project_id);
  if (!projectID) throw new Error("ElevenLabs dubbing response is missing project_id");
  const request = dubbingRequest(ctx.requestBody);
  const state = { dubbing_model: request.dubbing_model, target_language: request.target_language };
  // Without a language id the first poll reads it from the project.
  const languageID = Array.isArray(body.language_ids) ? trimmed(body.language_ids[0]) : "";
  if (languageID) state.language_id = languageID;
  return { taskId: projectID, taskData: body, state: state };
}

export function buildQueryRequest(ctx) {
  const projectID = trimmed(ctx.taskId);
  if (!projectID) throw new Error("task_id is required");
  const state = dubbingState(ctx.state);
  // The project carries the media duration used for settlement; the language
  // task carries the dubbed outputs.
  const readLanguage = state.language_id && (state.duration_s || state.project_ready);
  return {
    url: readLanguage
      ? projectURL(ctx.baseUrl, projectID) + "/language/" + encodeURIComponent(state.language_id)
      : projectURL(ctx.baseUrl, projectID),
    method: "GET",
    headers: { Accept: "application/json", Authorization: authorization(ctx) },
  };
}

export function parseTaskResult(ctx, body) {
  const task = object(body, "invalid ElevenLabs dubbing task response");
  const state = dubbingState(ctx.state);
  const status = trimmed(task.status).toLowerCase();
  if (Array.isArray(task.language_ids)) {
    if (["failed", "error"].includes(status)) {
      return { status: "FAILURE", progress: "100%", reason: failureReason(task, "ElevenLabs dubbing project failed") };
    }
    if (!["queued", "processing", "ready"].includes(status)) {
      return { status: "UNKNOWN", reason: "unrecognized ElevenLabs dubbing project status: " + status };
    }
    const languageID = trimmed(task.language_ids[0]) || state.language_id;
    if (languageID) state.language_id = languageID;
    const seconds = mediaSeconds(task);
    if (seconds !== null) state.duration_s = seconds;
    if (status === "ready") state.project_ready = true;
    return { status: status === "queued" ? "QUEUED" : "IN_PROGRESS", progress: "", state: state };
  }
  if (status === "queued") return { status: "QUEUED", progress: "" };
  if (status === "processing") return { status: "IN_PROGRESS", progress: "" };
  if (["failed", "error", "cancelled", "canceled"].includes(status)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(task, "ElevenLabs dubbing failed") };
  }
  if (status === "completed") {
    if (!outputEntries(task).length) {
      return { status: "UNKNOWN", reason: "ElevenLabs dubbing result is missing lossless_audio or subtitles" };
    }
    return { status: "SUCCESS", progress: "100%", reason: "" };
  }
  return { status: "UNKNOWN", reason: "unrecognized ElevenLabs dubbing status: " + status };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  selectedModel(ctx);
  const request = dubbingRequest(ctx.requestBody);
  return { upstream_usd: upstreamUSD(request.dubbing_model, request.duration_seconds) };
}

export function extractUsageOnComplete(task, result) {
  if (trimmed(task && (task.upstreamModel || task.model)) !== MODEL) return null;
  const status = String((result && result.status) || "").toUpperCase();
  if (["FAILURE", "CANCELLED", "CANCELED"].includes(status)) return { upstream_usd: 0 };
  if (status !== "SUCCESS") return null;
  const state = dubbingState(task.state);
  // Settle on the decoded media duration; without it the reservation stands.
  if (!state.duration_s || !hasOwn(DUBBING_PRICES, state.dubbing_model)) return null;
  return { upstream_usd: upstreamUSD(state.dubbing_model, state.duration_s) };
}

export function listArtifacts(task) {
  if (String((task && task.status) || "").toUpperCase() !== "SUCCESS") return [];
  return outputEntries(task.data).map(function (_entry, index) {
    return { key: "output-" + index, type: OUTPUTS[index].type, mimeType: OUTPUTS[index].mimeType };
  });
}

export function buildContentRequest(ctx) {
  if (String((ctx && ctx.status) || "").toUpperCase() !== "SUCCESS") throw new Error("artifact_not_found");
  const match = /^output-(\d+)$/.exec(String(ctx.artifactKey || ""));
  if (!match) throw new Error("artifact_not_found");
  const index = Number(match[1]);
  const stored = outputEntries(ctx.data)[index];
  if (!stored) throw new Error("artifact_not_found");
  const method = String((ctx.clientRequest && ctx.clientRequest.method) || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("unsupported artifact method");
  // Output links are signed and expire; read the language task again for a
  // current link and fall back to the stored one when that read fails.
  let url = stored.url;
  const state = dubbingState(ctx.state);
  const projectID = trimmed(ctx.upstreamTaskId);
  if (state.language_id && projectID && typeof utils !== "undefined" && typeof utils.fetch === "function") {
    try {
      const response = utils.fetch({
        url: projectURL(ctx.baseUrl, projectID) + "/language/" + encodeURIComponent(state.language_id),
        headers: { Accept: "application/json", Authorization: authorization(ctx) },
      });
      const fresh = response.status === 200 ? outputEntries(response.body)[index] : null;
      if (fresh) url = fresh.url;
    } catch (_error) {
      url = stored.url;
    }
  }
  return { url: url, method: method, credentialless: true };
}

export const native = {
  decodeSubmit: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = object(ctx.body.value, "request body must be an object");
    if (trimmed(body.model) !== MODEL) throw new Error("unsupported ElevenLabs tool model");
    return { kind: "submit", model: MODEL, action: ACTION, requestBody: dubbingRequest(body) };
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

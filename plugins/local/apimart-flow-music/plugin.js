// APIMart/APIB Flow Music tasks. Independent of the Suno and image plugins.
// Plugin: am-flow-music@0.2.0; public model: flowmusic-am; upstream: flowmusic.
// Channel: Task Plugin, base https://api.apib.ai or https://api.apimart.ai.
// Model mapping: empty or flowmusic-am -> flowmusic. No ordinary audio endpoints.
// Public POST /am/flow-music/v1/generations, plus the provider suffixes below.
// Public GET /am/flow-music/v1/tasks/:task_id returns only the public task ID.
// A source is a public task_id + optional 1-based audio_index (default 1), NEVER
// a client clip_id. The host checks owner/plugin/channel and supplies originTasks;
// this plugin reads the selected completed music entry's private clip_id.
// External audio uses uploadAudioFlowMusic first, then its public task ID.
// version is request-only: omit for default; lyria-3.5 is supported on generate,
// extend, replace and cover. Do not change model to the version name.
// All nine actions are asynchronous; generation produces one song, stems a ZIP.
// There are no documented cancel/callback endpoints. Query errors are not refunds:
// only a real failed task enters the host's failure/refund lifecycle.
//
// Contract pages: https://docs.apib.ai/cn/api-reference/audios/flow-music/
// music, music-lyria-3-5, lyrics, extend, extend-lyria-3-5, replace,
// replace-lyria-3-5, cover, cover-lyria-3-5, stems, upload-audio,
// download-audio, video-clip, query (reviewed 2026-09-10).
// Safety bounds not supplied by the provider: text <=65536, IDs <=256,
// BPM <= MAX_SAFE_INTEGER, source times <=3600s, at most 64 output entries.
// Provider bounds: lyrics prompt <=3000, length 1..240, extend_s >0..164,
// strength 0..1. replace seed is an integer; other generation seeds are strings.
// Source times are also checked against duration_seconds when it is present.
// Upload requires a public HTTP(S) URL; common audio extensions (e.g. mp3/wav)
// are checked by the provider, not guessed from signed URL query strings here.
//
// Administrator pricing only; this plugin does not install or overwrite prices.
// User-supplied discounted USD/request schedule (2026-09-10):
// u("action") == "lyrics" ? tier("lyrics", u("requests") * 0.02) :
// u("action") == "extend" ? tier("extend", u("requests") * 0.06) :
// u("action") == "replace" ? tier("replace", u("requests") * 0.06) :
// u("action") == "cover" ? tier("cover", u("requests") * 0.06) :
// u("action") == "stems" ? tier("stems", u("requests") * 0.06) :
// u("action") == "upload_audio" ? tier("upload_audio", u("requests") * 0.01) :
// u("action") == "download_audio" ? tier("download_audio", u("requests") * 0.02) :
// u("action") == "video_clip" ? tier("video_clip", u("requests") * 0.02) :
// tier("generate", u("requests") * 0.06)
// Do not apply another 20% discount or divide by 1M. Each operation is one request.
// Same-action versions have equal prices; usageSchema contains no version.
// Ignore provider cost/credits_cost for user billing. Host owns safe quota math,
// pre-consumption, group ratios, terminal settlement and failed-task refunds.
//
// Offline validation (does not call a paid endpoint):
// go run . plugin lint plugins/local/apimart-flow-music/plugin.js
// go run . plugin test plugins/local/apimart-flow-music/plugin.js --fixture plugins/local/apimart-flow-music/apimart-flow-music.fixture.json

const MAX_SOURCE_SECONDS = 3600;
const MAX_TRACKS = 64;
const ACTIONS = {
  generate: { suffix: "", version: true, fields: ["sound_prompt", "lyrics", "title", "bpm", "length", "seed"] },
  lyrics: { suffix: "/lyricsFlowMusic", fields: ["prompt"] },
  extend: { suffix: "/extendFlowMusic", source: true, version: true, fields: ["extend_from_s", "extend_s", "instruction", "title", "seed"] },
  replace: { suffix: "/replaceFlowMusic", source: true, version: true, fields: ["start_s", "end_s", "instruction", "title", "seed"] },
  cover: { suffix: "/coverFlowMusic", source: true, version: true, fields: ["instruction", "strength", "title", "seed"] },
  stems: { suffix: "/stemsFlowMusic", source: true, fields: [] },
  upload_audio: { suffix: "/uploadAudioFlowMusic", fields: ["audio_url"] },
  download_audio: { suffix: "/downloadAudioFlowMusic", source: true, fields: ["format"] },
  video_clip: { suffix: "/videoClipFlowMusic", source: true, fields: ["preset"] },
};
for (const spec of Object.values(ACTIONS)) {
  spec.allowed = new Set(["model", ...spec.fields]);
  if (spec.source) {
    spec.allowed.add("task_id");
    spec.allowed.add("audio_index");
  }
  if (spec.version) spec.allowed.add("version");
}

export const meta = {
  apiVersion: 1,
  key: "am-flow-music",
  name: "AM Flow Music",
  version: "0.2.0",
  author: { name: "Tapcomfy" },
  description: {
    en: "Flow Music and Lyria 3.5 music, editing, lyrics and audio tasks via AM.",
    zh: "通过 AM 提供 Flow Music 与 Lyria 3.5 音乐生成、编辑、歌词和音频任务。",
  },
  fetchMode: "per_task",
  allowedHosts: ["api.apib.ai", "api.apimart.ai"],
  models: ["flowmusic-am"],
  usageSchema: {
    requests: { type: "number", unit: "count", description: { en: "Calls (one per task).", zh: "调用次数（每个任务固定为 1）。" } },
    action: { enum: Object.keys(ACTIONS), description: { en: "Flow Music operation.", zh: "Flow Music 操作。" } },
  },
  usageExamples: [
    { label: "Generate music", facts: { requests: 1, action: "generate" } },
    { label: "Upload audio", facts: { requests: 1, action: "upload_audio" } },
    { label: "Download audio", facts: { requests: 1, action: "download_audio" } },
  ],
  routes: Object.entries(ACTIONS)
    .map(function ([action, spec]) {
      return {
        method: "POST",
        path: "/am/flow-music/v1/generations" + spec.suffix,
        type: "submit",
        action: action,
        decode: "decodeSubmit",
        render: "renderSubmitted",
      };
    })
    .concat([{ method: "GET", path: "/am/flow-music/v1/tasks/:task_id", type: "query", render: "renderTask" }]),
};
const SUBMIT_ACTIONS = new Map();
for (const route of meta.routes) if (route.type === "submit") SUBMIT_ACTIONS.set(route.path, route.action);

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(field + " must be an object");
  return value;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function publicMessage(value) {
  return text(value).replace(/\b(?:APIMart|APIB)\b/gi, "AM");
}

function requiredText(value, field, maximum = 65536) {
  if (!text(value) || value.length > maximum) throw new Error(field + " must be a non-empty string of at most " + maximum + " characters");
  return value.trim();
}

function number(value, field, minimum, maximum, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) {
    throw new Error(field + " must be " + (integer ? "an integer " : "a number ") + "between " + minimum + " and " + maximum);
  }
  return value;
}

function httpURL(value) {
  return typeof value === "string" && value.length <= 8192 && /^https?:\/\/[^\s/@?#\\]+(?:[/?#][^\s\\]*)?$/i.test(value);
}

function normalizedRequest(action, request) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error("unsupported Flow Music action");
  object(request, "request body");
  const spec = ACTIONS[action];
  for (const field of Object.keys(request)) {
    if (!spec.allowed.has(field)) throw new Error("unsupported field for " + action + ": " + field);
  }
  if (request.model !== undefined && request.model !== "flowmusic-am") throw new Error("model must be flowmusic-am");
  const body = { ...request };
  delete body.model;
  if (body.version !== undefined && body.version !== "lyria-3.5") throw new Error("version must be lyria-3.5 or omitted");
  for (const field of ["sound_prompt", "lyrics", "title", "instruction"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > 65536))
      throw new Error(field + " must be a string of at most 65536 characters");
  }
  if (body.seed !== undefined) {
    if (action === "replace") number(body.seed, "seed", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true);
    else if (typeof body.seed !== "string" || body.seed.length > 256) throw new Error("seed must be a string of at most 256 characters");
  }
  if (spec.source) {
    body.task_id = requiredText(body.task_id, "task_id", 128);
    body.audio_index = body.audio_index === undefined ? 1 : number(body.audio_index, "audio_index", 1, MAX_TRACKS, true);
  }
  if (action === "generate") {
    if (!text(body.sound_prompt) && !text(body.lyrics)) throw new Error("sound_prompt and lyrics cannot both be empty");
    if (body.length !== undefined) number(body.length, "length", 1, 240, true);
    if (body.bpm !== undefined) {
      if (typeof body.bpm !== "string" || !/^\d+(?:\.\d+)?$/.test(body.bpm) || body.bpm.length > 32) throw new Error("bpm must be a numeric string");
      number(Number(body.bpm), "bpm", 1, Number.MAX_SAFE_INTEGER);
    }
  }
  if (action === "lyrics") body.prompt = requiredText(body.prompt, "prompt", 3000);
  if (action === "extend" || action === "replace" || action === "cover") requiredText(body.instruction, "instruction");
  if (action === "extend") {
    number(body.extend_from_s, "extend_from_s", 0, MAX_SOURCE_SECONDS);
    number(body.extend_s, "extend_s", 0, 164);
    if (body.extend_s === 0) throw new Error("extend_s must be greater than zero");
  }
  if (action === "replace") {
    number(body.start_s, "start_s", 0, MAX_SOURCE_SECONDS);
    number(body.end_s, "end_s", 0, MAX_SOURCE_SECONDS);
    if (body.end_s <= body.start_s) throw new Error("end_s must be greater than start_s");
  }
  if (action === "cover") number(body.strength, "strength", 0, 1);
  if (action === "upload_audio" && !httpURL(body.audio_url)) throw new Error("audio_url must be an HTTP(S) URL without embedded credentials");
  if (action === "download_audio" && !["mp3", "wav"].includes(body.format)) throw new Error("format must be mp3 or wav");
  if (action === "video_clip") {
    if (body.preset === undefined) body.preset = "simple";
    if (!["simple", "modern", "player"].includes(body.preset)) throw new Error("preset must be simple, modern or player");
  }
  return body;
}

// The driver stores the whole query response; host views may supply data only.
function taskData(raw) {
  const outer = object(raw, "task response");
  if (outer.code !== undefined && outer.code !== 200) throw new Error("Flow Music task query failed");
  return outer.data === undefined ? outer : object(outer.data, "task data");
}

function storedResult(task) {
  const data = taskData(task.data || {});
  return data.result === undefined ? {} : object(data.result, "task result");
}

export function buildSubmitRequest(ctx) {
  const body = normalizedRequest(ctx.action, ctx.requestBody);
  if (ctx.upstreamModel !== undefined && ctx.upstreamModel !== "" && ctx.upstreamModel !== "flowmusic-am" && ctx.upstreamModel !== "flowmusic")
    throw new Error("upstream model must be flowmusic");
  if (ACTIONS[ctx.action].source) {
    const origin = (Array.isArray(ctx.originTasks) ? ctx.originTasks : []).find(function (entry) {
      return entry.taskId === body.task_id;
    });
    if (!origin || origin.status !== "SUCCESS" || !text(origin.upstreamTaskId)) throw new Error("referenced task must be completed and resolved by the host");
    const music = storedResult(origin).music;
    if (!Array.isArray(music) || music.length > MAX_TRACKS || !music[body.audio_index - 1])
      throw new Error("audio_index is outside the referenced music result");
    const clip = object(music[body.audio_index - 1], "referenced clip");
    body.clip_id = requiredText(clip.clip_id, "referenced clip_id", 256);
    // Durations are strings in Flow Music responses. They are not billing units.
    if (clip.duration_seconds !== undefined) {
      const duration = typeof clip.duration_seconds === "number" ? clip.duration_seconds : text(clip.duration_seconds) ? Number(clip.duration_seconds) : NaN;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("invalid referenced clip duration");
      if (body.extend_from_s !== undefined && body.extend_from_s > duration) throw new Error("extend_from_s exceeds the referenced clip duration");
      if (body.end_s !== undefined && body.end_s > duration) throw new Error("end_s exceeds the referenced clip duration");
    }
    delete body.task_id;
    delete body.audio_index;
  }
  body.model = "flowmusic";
  return {
    url: ctx.baseUrl.replace(/\/$/, "") + "/v1/music/generations" + ACTIONS[ctx.action].suffix,
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: ctx.action,
  };
}

export function parseSubmitResponse(_ctx, response) {
  if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) throw new Error("Flow Music submission HTTP error");
  const body = object(response.body, "submission response");
  if (body.code !== 200) throw new Error("Flow Music submission failed");
  if (!Array.isArray(body.data) || body.data.length !== 1) throw new Error("Flow Music submission must return one task_id");
  const taskId = requiredText(object(body.data[0], "submitted task").task_id, "task_id", 256);
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  const id = requiredText(ctx.taskId, "task_id", 256);
  return {
    url: ctx.baseUrl.replace(/\/$/, "") + "/v1/music/tasks/" + encodeURIComponent(id),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

const STATES = { submitted: "SUBMITTED", pending: "SUBMITTED", processing: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE" };
export function parseTaskResult(_ctx, body, response) {
  if (response && response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300))
    throw new Error("Flow Music query HTTP error");
  const data = taskData(body);
  const status = Object.hasOwn(STATES, data.status) ? STATES[data.status] : "UNKNOWN";
  if (status === "UNKNOWN") return { status: status, reason: "unrecognized Flow Music task status" };
  const terminal = status === "SUCCESS" || status === "FAILURE";
  const progress = terminal
    ? "100%"
    : typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 100
      ? String(data.progress) + "%"
      : "";
  return {
    status: status,
    progress: progress,
    reason: status === "FAILURE" ? text(data.error && data.error.message) || text(data.error) || "Flow Music task failed" : "",
  };
}

const MEDIA_FIELDS = { audio_url: "audio", wav_url: "audio", image_url: "image", video_url: "video", file_url: "file" };
function artifactEntries(task) {
  const result = storedResult(task);
  if (result.music === undefined) return [];
  if (!Array.isArray(result.music) || result.music.length > MAX_TRACKS) throw new Error("invalid Flow Music output tracks");
  const entries = [];
  result.music.forEach(function (raw, index) {
    const clip = object(raw, "output track");
    for (const [field, type] of Object.entries(MEDIA_FIELDS)) {
      const url = clip[field];
      if (!httpURL(url)) continue;
      entries.push({
        key: "asset-" + utils.hmacSHA256("music." + index + "." + field + "\n" + url, "new-api:apimart-flow-music:artifact"),
        type: type,
        url: url,
      });
    }
  });
  if (entries.length > 64) throw new Error("too many Flow Music artifacts");
  return entries;
}

function publicResult(value, depth = 0) {
  if (depth > 8) throw new Error("Flow Music result nesting exceeds limit");
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length > 4096) throw new Error("Flow Music result array exceeds limit");
    return value.map(function (item) {
      return publicResult(item, depth + 1);
    });
  }
  const result = {};
  for (const [key, item] of Object.entries(object(value, "Flow Music result"))) {
    if (/(?:^id$|_ids?$|Id$|Ids$|token|secret|authorization|api_key|^cost$|credits_cost|^__proto__$|^constructor$|^prototype$)/i.test(key)) continue;
    if (Object.hasOwn(MEDIA_FIELDS, key) || key === "url") {
      if (httpURL(item)) result[key] = item;
    } else if (!/url/i.test(key)) result[key] = publicResult(item, depth + 1);
  }
  return result;
}

export const native = {
  decodeSubmit: function (ctx) {
    const action = ctx.method === "POST" ? SUBMIT_ACTIONS.get(ctx.path) : undefined;
    if (!action) throw new Error("unsupported Flow Music route");
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = normalizedRequest(action, ctx.body.value);
    const intent = { kind: "submit", model: "flowmusic-am", action: action, requestBody: body };
    if (ACTIONS[action].source) intent.originTaskIds = [body.task_id];
    return intent;
  },
  renderSubmitted: function (_ctx, task) {
    return { code: 200, data: [{ status: "submitted", task_id: task.task_id }] };
  },
  renderTask: function (_ctx, task) {
    const status = { SUCCESS: "completed", FAILURE: "failed", IN_PROGRESS: "processing", SUBMITTED: "pending", NOT_START: "pending" }[task.status] || "pending";
    const progress = status === "completed" || status === "failed" ? 100 : Number(String(task.progress || "0").replace(/%$/, ""));
    const data = { id: task.task_id, status: status, progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0 };
    if (status === "completed") data.result = publicResult(storedResult(task));
    if (status === "failed") data.error = { message: publicMessage(task.fail_reason) || "Flow Music task failed" };
    return { code: 200, data: data };
  },
  error: function (_ctx, error) {
    return { code: error.code, message: publicMessage(error.message) };
  },
};

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  return artifactEntries(task).map(function (entry) {
    return { key: entry.key, type: entry.type };
  });
}

export function buildContentRequest(ctx) {
  if (ctx.status !== "SUCCESS") throw new Error("artifact_not_found");
  const method = (ctx.clientRequest && ctx.clientRequest.method) || "GET";
  if (method !== "GET" && method !== "HEAD") throw new Error("unsupported artifact method");
  const entry = artifactEntries(ctx).find(function (artifact) {
    return artifact.key === ctx.artifactKey;
  });
  if (!entry) throw new Error("artifact_not_found");
  return { url: entry.url, method: method, credentialless: true };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  normalizedRequest(ctx.action, ctx.requestBody);
  return { requests: 1, action: ctx.action };
}

export function extractUsageOnComplete(_ctx, _result, body) {
  if (!body || typeof body !== "object" || (body.code !== undefined && body.code !== 200)) return null;
  return taskData(body).status === "completed" ? { requests: 1 } : null;
}

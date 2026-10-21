// RunningHub Model API audio tasks. Each request normalizer accepts only fields
// published for that exact endpoint; there is no generic passthrough body.
const QWEN_MODEL = "qwen3-tts-flash";
const MINIMAX_TTS_MODEL = "minimax/speech-2.8-hd";
const DOUBAO_TTS_MODEL = "bytedance/doubao-seed-tts-2.0";
const QWEN_TTS_CNY_PER_10000_BILLED_CHARACTERS = 0.8029;
const DOUBAO_TTS_CNY_PER_1000_CHARACTERS = 0.24;
const MINIMAX_TTS_CNY_PER_1000_CHARACTERS = 0.62;
const QWEN_TTS_LANGUAGES = ["Auto", "Chinese", "English", "German", "Italian", "Portuguese", "Spanish", "Japanese", "Korean", "French", "Russian"];
const MINIMAX_TTS_VOICES = new Set([
  "Wise_Woman",
  "Friendly_Person",
  "Inspirational_girl",
  "Deep_Voice_Man",
  "Calm_Woman",
  "Casual_Guy",
  "Lively_Girl",
  "Patient_Man",
  "Young_Knight",
  "Determined_Man",
  "Lovely_Girl",
  "Decent_Boy",
  "Imposing_Manner",
  "Elegant_Man",
  "Abbess",
  "Sweet_Girl_2",
  "Exuberant_Girl",
]);
const MINIMAX_TTS_EMOTIONS = new Set(["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]);
const MAX_UPSTREAM_CREDITS = 2_147_483_647;
const PROFILES = {
  [QWEN_MODEL]: { endpoint: "alibaba/qwen3-tts-flash" },
  [MINIMAX_TTS_MODEL]: { endpoint: "rhart-audio/text-to-audio/speech-2.8-hd" },
  [DOUBAO_TTS_MODEL]: { endpoint: "bytedance/doubao-seed-tts-2.0" },
};
const TTS_USAGE_SCHEMA = {
  upstream_cny: {
    type: "number",
    unit: "credit",
    description: { en: "Actual CNY cost unit price", zh: "实际人民币成本单价" },
  },
};

export const meta = {
  apiVersion: 1,
  key: "rh-audio",
  name: "Audio Generation",
  icon: "text:Audio",
  description: {
    en: "Audio generation tasks",
    zh: "音频生成任务",
  },
  version: "0.5.1",
  author: { name: "QuantumNous" },
  baseUrl: "https://www.runninghub.cn",
  models: Object.keys(PROFILES),
  fetchMode: "per_task",
  auth: "api_key",
  usageSchema: TTS_USAGE_SCHEMA,
  usageExamples: [{ label: "¥1 upstream cost", facts: { upstream_cny: 1 } }],
  usageProfiles: [
    {
      models: [QWEN_MODEL],
      schema: TTS_USAGE_SCHEMA,
      examples: [
        { label: "1,000 billed characters · estimate", facts: { upstream_cny: 0.08029 } },
        { label: "5,000 billed characters · estimate", facts: { upstream_cny: 0.40145 } },
        { label: "10,000 billed characters · estimate", facts: { upstream_cny: 0.8029 } },
      ],
    },
    {
      models: [DOUBAO_TTS_MODEL],
      schema: TTS_USAGE_SCHEMA,
      examples: [
        { label: "1,000 characters · estimate", facts: { upstream_cny: 0.24 } },
        { label: "5,000 characters · estimate", facts: { upstream_cny: 1.2 } },
        { label: "10,000 characters · estimate", facts: { upstream_cny: 2.4 } },
      ],
    },
    {
      models: [MINIMAX_TTS_MODEL],
      schema: TTS_USAGE_SCHEMA,
      examples: [
        { label: "1,000 characters · estimate", facts: { upstream_cny: 0.62 } },
        { label: "5,000 characters · estimate", facts: { upstream_cny: 3.1 } },
        { label: "10,000 characters · estimate", facts: { upstream_cny: 6.2 } },
      ],
    },
  ],
  routes: [
    { method: "POST", path: "/rh-audio/v1/audio/generations", type: "submit", decode: "decodeSubmit", render: "renderSubmitted" },
    { method: "GET", path: "/rh-audio/v1/tasks/:task_id", type: "query", render: "renderTask" },
  ],
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requiredText(value, field, maximum) {
  const text = trimmed(value);
  if (!text || text.length > maximum) throw new Error(field + " must be a non-empty string of at most " + maximum + " characters");
  return text;
}

function optionalText(value, field, maximum) {
  if (typeof value !== "string") throw new Error(field + " must be a string");
  if (!value.trim() || value.length > maximum) throw new Error(field + " must be a non-empty string of at most " + maximum + " characters");
  return value.trim();
}

function integer(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(field + " must be an integer between " + minimum + " and " + maximum);
  }
  return value;
}

function number(value, field, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(field + " must be a number between " + minimum + " and " + maximum);
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== "boolean") throw new Error(field + " must be a boolean");
  return value;
}

function oneOf(value, field, values) {
  if (!values.includes(value)) throw new Error(field + " must be one of " + values.join(", "));
  return value;
}

function profileFor(model) {
  const profile = PROFILES[trimmed(model)];
  if (!profile) throw new Error("unsupported RunningHub audio model");
  return profile;
}

function checkFields(request, model, fields) {
  for (const field of Object.keys(request)) {
    if (!fields.includes(field)) throw new Error("unsupported field for " + model + ": " + field);
  }
}

function qwenBilledCharacters(text) {
  let count = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    count +=
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0x20000 && codePoint <= 0x2ebef) ||
      (codePoint >= 0x30000 && codePoint <= 0x323af)
        ? 2
        : 1;
  }
  return count;
}

function qwenRequest(value) {
  const request = object(value, "request body must be an object");
  checkFields(request, QWEN_MODEL, ["model", "text", "voice", "languageType"]);
  const text = requiredText(request.text, "text", 1200);
  if (qwenBilledCharacters(text) > 600) throw new Error("text must be at most 600 billed characters");
  const voice = request.voice === undefined ? "Cherry" : requiredText(request.voice, "voice", 128);
  const languageType = request.languageType === undefined ? "Auto" : oneOf(request.languageType, "languageType", QWEN_TTS_LANGUAGES);
  return { text: text, voice: voice, languageType: languageType };
}

function minimaxTTSRequest(value) {
  const request = object(value, "request body must be an object");
  checkFields(request, MINIMAX_TTS_MODEL, [
    "model",
    "text",
    "pronunciation_dict",
    "voice_id",
    "speed",
    "volume",
    "pitch",
    "emotion",
    "enable_base64_output",
    "english_normalization",
  ]);
  const voiceID = requiredText(request.voice_id, "voice_id", 64);
  if (!MINIMAX_TTS_VOICES.has(voiceID)) throw new Error("unsupported voice_id");
  const output = {
    text: requiredText(request.text, "text", 10000),
    voice_id: voiceID,
    enable_base64_output: request.enable_base64_output === undefined ? false : boolean(request.enable_base64_output, "enable_base64_output"),
    english_normalization: request.english_normalization === undefined ? false : boolean(request.english_normalization, "english_normalization"),
  };
  if (request.pronunciation_dict !== undefined) output.pronunciation_dict = optionalText(request.pronunciation_dict, "pronunciation_dict", 10000);
  if (request.speed !== undefined) output.speed = number(request.speed, "speed", 0.5, 2);
  if (request.volume !== undefined) output.volume = number(request.volume, "volume", 0.1, 10);
  if (request.pitch !== undefined) output.pitch = integer(request.pitch, "pitch", -12, 12);
  if (request.emotion !== undefined) {
    const emotion = optionalText(request.emotion, "emotion", 32);
    if (!MINIMAX_TTS_EMOTIONS.has(emotion)) throw new Error("unsupported emotion");
    output.emotion = emotion;
  }
  return output;
}

function doubaoTTSRequest(value) {
  const request = object(value, "request body must be an object");
  // model selects the gateway profile only; it is never forwarded upstream.
  checkFields(request, DOUBAO_TTS_MODEL, ["model", "text", "speaker", "format", "sample_rate", "speech_rate", "loudness_rate", "bit_rate", "pitch"]);
  const output = {
    text: requiredText(request.text, "text", 10000),
    speaker: requiredText(request.speaker, "speaker", 256),
  };
  if (hasOwn(request, "format")) output.format = oneOf(optionalText(request.format, "format", 64), "format", ["mp3", "wav", "ogg_opus", "pcm"]);
  if (hasOwn(request, "sample_rate"))
    output.sample_rate = oneOf(request.sample_rate, "sample_rate", ["8000", "16000", "22050", "24000", "32000", "44100", "48000"]);
  if (hasOwn(request, "speech_rate")) output.speech_rate = integer(request.speech_rate, "speech_rate", -50, 100);
  if (hasOwn(request, "loudness_rate")) output.loudness_rate = integer(request.loudness_rate, "loudness_rate", -50, 100);
  if (hasOwn(request, "bit_rate")) {
    if (hasOwn(output, "format") && output.format !== "mp3") throw new Error("bit_rate is supported only when format is mp3");
    output.bit_rate = integer(request.bit_rate, "bit_rate", 64000, 160000);
  }
  if (hasOwn(request, "pitch")) output.pitch = integer(request.pitch, "pitch", -12, 12);
  return output;
}

function requestForModel(model, value) {
  if (model === QWEN_MODEL) return qwenRequest(value);
  if (model === MINIMAX_TTS_MODEL) return minimaxTTSRequest(value);
  if (model === DOUBAO_TTS_MODEL) return doubaoTTSRequest(value);
  throw new Error("unsupported RunningHub audio model");
}

function selectedModel(ctx) {
  const model = trimmed(ctx.upstreamModel || ctx.model);
  profileFor(model);
  return model;
}

function requestURL(baseUrl, endpoint) {
  const root = trimmed(baseUrl).replace(/\/+$/, "");
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

function failureReason(body) {
  return trimmed(body.errorMessage) || trimmed(body.errorCode) || "RunningHub audio task failed";
}

function upstreamCNY(body) {
  const usage = body && body.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  let total = 0;
  for (const field of ["consumeMoney", "thirdPartyConsumeMoney"]) {
    const value = usage[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
    total += Number(value);
  }
  const coins = usage.consumeCoins;
  if (coins !== undefined && coins !== null) {
    if (typeof coins !== "string" || !/^\d+(?:\.\d+)?$/.test(coins)) return null;
    total += Number(coins) / 250;
  }
  if (!Number.isFinite(total) || total < 0 || total > MAX_UPSTREAM_CREDITS) return null;
  return total;
}

function audioEntries(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.results)) return [];
  const entries = [];
  const urls = new Set();
  for (const result of data.results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const url = trimmed(result.url);
    if (!/^https?:\/\/[^\s/@?#]+(?:[/?#][^\s]*)?$/i.test(url) || urls.has(url)) continue;
    urls.add(url);
    entries.push({ url: url, outputType: trimmed(result.outputType).toLowerCase() });
    if (entries.length === 16) break;
  }
  return entries;
}

function mimeType(outputType) {
  return (
    {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      ogg: "audio/ogg",
      ogg_opus: "audio/ogg",
      flac: "audio/flac",
    }[outputType] || ""
  );
}

function nativeTask(task) {
  const status = String(task.status || "").toUpperCase();
  const output = {
    task_id: task.task_id || "",
    status: status,
    progress: task.progress || "",
    fail_reason: task.fail_reason || "",
    data: task.data === undefined ? null : task.data,
  };
  if (status === "SUCCESS") {
    output.artifact_metadata = {
      source: "RunningHub temporary result URL",
      expires_in_hours: 24,
    };
  }
  return output;
}

export function buildSubmitRequest(ctx) {
  const model = selectedModel(ctx);
  return {
    url: requestURL(ctx.baseUrl, profileFor(model).endpoint),
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization(ctx),
    },
    body: requestForModel(model, ctx.requestBody),
    action: "audio_generation",
  };
}

export function parseSubmitResponse(_ctx, response) {
  const body = taskData(response && response.body, "invalid RunningHub submission response");
  // Model API responses are top-level {taskId, status, results}; do not apply
  // the legacy RunningHub Workflow {code, data, msg} envelope here.
  return { taskId: trimmed(body.taskId), taskData: body };
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
  if (["PENDING", "QUEUED", "SUBMITTED"].includes(status)) return { status: "SUBMITTED", progress: "" };
  if (["RUNNING", "PROCESSING", "IN_PROGRESS"].includes(status)) return { status: "IN_PROGRESS", progress: "" };
  if (["FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(task) };
  }
  if (status === "SUCCESS") {
    if (audioEntries(task).length === 0) return { status: "UNKNOWN", reason: "RunningHub success response is missing an audio result URL" };
    return { status: "SUCCESS", progress: "100%", reason: "" };
  }
  return { status: "UNKNOWN", reason: "unrecognized RunningHub task status: " + status };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const model = selectedModel(ctx);
  const request = requestForModel(model, ctx.requestBody);
  let estimate;
  if (model === QWEN_MODEL) estimate = (qwenBilledCharacters(request.text) * QWEN_TTS_CNY_PER_10000_BILLED_CHARACTERS) / 10000;
  else {
    const rate = model === DOUBAO_TTS_MODEL ? DOUBAO_TTS_CNY_PER_1000_CHARACTERS : MINIMAX_TTS_CNY_PER_1000_CHARACTERS;
    estimate = (Array.from(request.text).length * rate) / 1000;
  }
  // Reserve the published estimate; completion replaces it with RunningHub's
  // actual CNY deduction.
  return { upstream_cny: Number(estimate.toFixed(6)) };
}

export function extractUsageOnComplete(task, result, body) {
  const model = trimmed(task && (task.upstreamModel || task.model));
  if ([QWEN_MODEL, DOUBAO_TTS_MODEL, MINIMAX_TTS_MODEL].includes(model)) {
    const status = String((result && result.status) || "").toUpperCase();
    if (["FAILURE", "CANCELLED", "CANCELED"].includes(status)) return { upstream_cny: 0 };
    if (status !== "SUCCESS") return null;
    const cny = upstreamCNY(body);
    return cny === null ? null : { upstream_cny: cny };
  }
  return null;
}

export function listArtifacts(task) {
  if (String((task && task.status) || "").toUpperCase() !== "SUCCESS") return [];
  return audioEntries(task.data).map(function (entry, index) {
    const artifact = { key: "audio-" + index, type: "audio" };
    const type = mimeType(entry.outputType);
    if (type) artifact.mimeType = type;
    return artifact;
  });
}

export function buildContentRequest(ctx) {
  if (String((ctx && ctx.status) || "").toUpperCase() !== "SUCCESS") throw new Error("artifact_not_found");
  const index = /^audio-(\d+)$/.exec(String(ctx.artifactKey || ""));
  if (!index) throw new Error("artifact_not_found");
  const entry = audioEntries(ctx.data)[Number(index[1])];
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
    profileFor(model);
    return { kind: "submit", model: model, action: "audio_generation", requestBody: requestForModel(model, body) };
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

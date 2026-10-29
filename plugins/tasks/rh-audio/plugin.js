// RunningHub Model API audio tasks. Each request normalizer accepts only fields
// published for that exact endpoint; there is no generic passthrough body.
const QWEN_MODEL = "qwen3-tts-flash";
const MINIMAX_TTS_MODEL = "minimax/speech-2.8-hd";
const DOUBAO_TTS_MODEL = "bytedance/doubao-seed-tts-2.0";
const DOUBAO_SEED_AUDIO_MODEL = "bytedance/doubao-seed-audio-1.0";
const MUREKA_MODEL = "mureka-ai/mureka-v9";
const MUREKA_ENDPOINTS = {
  song: "mureka-ai/mureka-v9/generate-song",
  instrumental: "mureka-ai/mureka-v9/generate-bgm",
  lyrics: "mureka-ai/generate-lyrics",
};
const LYRICS_ACTION = "lyrics_generation";
const QWEN_TTS_CNY_PER_10000_BILLED_CHARACTERS = 0.8029;
const DOUBAO_TTS_CNY_PER_1000_CHARACTERS = 0.24;
const DOUBAO_SEED_AUDIO_CNY_PER_SECOND = 0.004;
const MINIMAX_TTS_CNY_PER_1000_CHARACTERS = 0.62;
// The public list (public-2026-04-29) shows 0.28 for v9 songs, but RunningHub
// deducted 0.34 per track (n=1 0.34, n=2 0.68). Lyrics use the listed per-call
// price. Completion settles every mode on the actual deduction.
const MUREKA_V9_CNY_PER_SONG = 0.34;
const MUREKA_LYRICS_CNY_PER_CALL = 0.06;
const QWEN_TTS_LANGUAGES = ["Auto", "Chinese", "English", "German", "Italian", "Portuguese", "Spanish", "Japanese", "Korean", "French", "Russian"];
const DOUBAO_TTS_EXPLICIT_LANGUAGES = [
  "",
  "zh-cn",
  "en",
  "ja",
  "es-mx",
  "id",
  "pt-br",
  "pt",
  "ko",
  "de",
  "fr",
  "th",
  "vi",
  "ru",
  "fil",
  "ms",
  "ar",
];
const MINIMAX_TTS_EMOTIONS = new Set(["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"]);
const MAX_UPSTREAM_CREDITS = 2_147_483_647;
const PROFILES = {
  [QWEN_MODEL]: { endpoint: "alibaba/qwen3-tts-flash" },
  [MINIMAX_TTS_MODEL]: { endpoint: "rhart-audio/text-to-audio/speech-2.8-hd" },
  [DOUBAO_TTS_MODEL]: { endpoint: "bytedance/doubao-seed-tts-2.0" },
  [DOUBAO_SEED_AUDIO_MODEL]: { endpoint: "bytedance/doubao-seed-audio-1.0" },
  // The Mureka endpoint follows the request mode; see buildSubmitRequest.
  [MUREKA_MODEL]: { endpoint: "" },
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
  version: "0.8.0",
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
      models: [DOUBAO_SEED_AUDIO_MODEL],
      schema: TTS_USAGE_SCHEMA,
      examples: [
        { label: "10 seconds · estimate", facts: { upstream_cny: 0.04 } },
        { label: "30 seconds · estimate", facts: { upstream_cny: 0.12 } },
        { label: "60 seconds · estimate", facts: { upstream_cny: 0.24 } },
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
    {
      models: [MUREKA_MODEL],
      schema: TTS_USAGE_SCHEMA,
      examples: [
        { label: "Song · 1 track · estimate", facts: { upstream_cny: 0.34 } },
        { label: "Song · 3 tracks · estimate", facts: { upstream_cny: 1.02 } },
        { label: "Instrumental · 1 track · estimate", facts: { upstream_cny: 0.34 } },
        { label: "Instrumental · 3 tracks · estimate", facts: { upstream_cny: 1.02 } },
        { label: "Lyrics · estimate", facts: { upstream_cny: 0.06 } },
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
  // System, cloned and designed voices share this field. The client catalog
  // chooses which IDs to offer; RunningHub fails unknown IDs without a charge.
  const voiceID = requiredText(request.voice_id, "voice_id", 128);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(voiceID)) throw new Error("voice_id must not contain control characters");
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
  checkFields(request, DOUBAO_TTS_MODEL, [
    "model",
    "text",
    "speaker",
    "format",
    "sample_rate",
    "speech_rate",
    "loudness_rate",
    "bit_rate",
    "pitch",
    "enable_subtitle",
    "explicit_language",
    "explicit_dialect",
    "max_length_to_filter_parenthesis",
    "silence_duration",
    "disable_markdown_filter",
    "disable_emoji_filter",
    "enable_latex_tn",
  ]);
  const output = {
    text: requiredText(request.text, "text", 10000),
    speaker: requiredText(request.speaker, "speaker", 256),
  };
  if (hasOwn(request, "format")) {
    output.format = oneOf(optionalText(request.format, "format", 64), "format", ["mp3", "wav", "ogg_opus", "pcm"]);
  }
  if (hasOwn(request, "sample_rate")) {
    output.sample_rate = oneOf(
      request.sample_rate,
      "sample_rate",
      ["8000", "16000", "22050", "24000", "32000", "44100", "48000"],
    );
  }
  if (hasOwn(request, "speech_rate")) output.speech_rate = integer(request.speech_rate, "speech_rate", -50, 100);
  if (hasOwn(request, "loudness_rate")) {
    output.loudness_rate = integer(request.loudness_rate, "loudness_rate", -50, 100);
  }
  if (hasOwn(request, "bit_rate")) {
    if (hasOwn(output, "format") && output.format !== "mp3") throw new Error("bit_rate is supported only when format is mp3");
    output.bit_rate = integer(request.bit_rate, "bit_rate", 64000, 160000);
  }
  if (hasOwn(request, "pitch")) output.pitch = integer(request.pitch, "pitch", -12, 12);
  if (hasOwn(request, "enable_subtitle")) output.enable_subtitle = boolean(request.enable_subtitle, "enable_subtitle");
  if (hasOwn(request, "explicit_language")) {
    const language = oneOf(request.explicit_language, "explicit_language", DOUBAO_TTS_EXPLICIT_LANGUAGES);
    if (language) output.explicit_language = language;
  }
  if (hasOwn(request, "explicit_dialect")) {
    output.explicit_dialect = optionalText(request.explicit_dialect, "explicit_dialect", 64);
  }
  if (hasOwn(request, "max_length_to_filter_parenthesis")) {
    output.max_length_to_filter_parenthesis = oneOf(
      request.max_length_to_filter_parenthesis,
      "max_length_to_filter_parenthesis",
      [0, 100],
    );
  }
  if (hasOwn(request, "silence_duration")) {
    output.silence_duration = integer(request.silence_duration, "silence_duration", 0, 30000);
  }
  if (hasOwn(request, "disable_markdown_filter")) {
    output.disable_markdown_filter = boolean(request.disable_markdown_filter, "disable_markdown_filter");
  }
  if (hasOwn(request, "disable_emoji_filter")) {
    output.disable_emoji_filter = boolean(request.disable_emoji_filter, "disable_emoji_filter");
  }
  if (hasOwn(request, "enable_latex_tn")) output.enable_latex_tn = boolean(request.enable_latex_tn, "enable_latex_tn");
  return output;
}

function httpsURL(value, field) {
  if (typeof value !== "string" || value.length > 2048 || !/^https:\/\/[^/\s@?#]+(?:[/?#][^\s]*)?$/i.test(value)) {
    throw new Error(field + " must be an absolute https URL without userinfo");
  }
  return value;
}

function seedAudioReference(request, output) {
  const references = [];
  for (const field of ["speaker", "audio_url", "image_url"]) {
    if (!hasOwn(request, field)) continue;
    if (typeof request[field] !== "string") throw new Error(field + " must be a string");
    if (!trimmed(request[field])) continue;
    references.push(field);
  }
  if (references.length !== 1) throw new Error("exactly one of speaker, audio_url, image_url is required");
  const field = references[0];
  if (field === "speaker") output.speaker = optionalText(request.speaker, "speaker", 256);
  else output[field] = httpsURL(request[field], field);
}

function doubaoSeedAudioRequest(value) {
  const request = object(value, "request body must be an object");
  checkFields(request, DOUBAO_SEED_AUDIO_MODEL, [
    "model",
    "text_prompt",
    "speaker",
    "audio_url",
    "image_url",
    "format",
    "sample_rate",
    "speech_rate",
    "loudness_rate",
    "pitch_rate",
  ]);
  const output = { text_prompt: requiredText(request.text_prompt, "text_prompt", 3000) };
  seedAudioReference(request, output);
  output.speech_rate = integer(request.speech_rate, "speech_rate", -50, 100);
  if (hasOwn(request, "format")) {
    output.format = oneOf(optionalText(request.format, "format", 64), "format", ["wav", "mp3", "pcm", "ogg_opus"]);
  }
  if (hasOwn(request, "sample_rate")) {
    output.sample_rate = oneOf(request.sample_rate, "sample_rate", ["8000", "16000", "24000", "32000", "44100"]);
  }
  if (hasOwn(request, "loudness_rate")) {
    output.loudness_rate = integer(request.loudness_rate, "loudness_rate", -50, 100);
  }
  if (hasOwn(request, "pitch_rate")) output.pitch_rate = integer(request.pitch_rate, "pitch_rate", -12, 12);
  return output;
}

function murekaCount(request) {
  if (!hasOwn(request, "n")) return 1;
  const count = typeof request.n === "string" && /^\d{1,2}$/.test(request.n.trim()) ? Number(request.n.trim()) : request.n;
  return integer(count, "n", 1, 3);
}

// The normalized body keeps mode so repeated normalization and endpoint
// selection agree; buildSubmitRequest removes it before sending. Phase one is
// text-only: reference, vocal, melody and instrumental IDs and stream are
// rejected by checkFields.
function murekaRequest(value) {
  const request = object(value, "request body must be an object");
  const mode = oneOf(request.mode, "mode", Object.keys(MUREKA_ENDPOINTS));
  const label = MUREKA_MODEL + " " + mode + " mode";
  if (mode === "lyrics") {
    checkFields(request, label, ["model", "mode", "prompt"]);
    return { mode: mode, prompt: requiredText(request.prompt, "prompt", 1024) };
  }
  if (mode === "instrumental") {
    checkFields(request, label, ["model", "mode", "prompt", "n"]);
    return { mode: mode, prompt: requiredText(request.prompt, "prompt", 1024), n: murekaCount(request) };
  }
  checkFields(request, label, ["model", "mode", "lyrics", "prompt", "n"]);
  const output = { mode: mode, lyrics: requiredText(request.lyrics, "lyrics", 3000) };
  if (hasOwn(request, "prompt")) {
    if (typeof request.prompt !== "string") throw new Error("prompt must be a string");
    if (request.prompt.trim()) output.prompt = optionalText(request.prompt, "prompt", 1024);
  }
  output.n = murekaCount(request);
  return output;
}

function requestForModel(model, value) {
  if (model === QWEN_MODEL) return qwenRequest(value);
  if (model === MINIMAX_TTS_MODEL) return minimaxTTSRequest(value);
  if (model === DOUBAO_TTS_MODEL) return doubaoTTSRequest(value);
  if (model === DOUBAO_SEED_AUDIO_MODEL) return doubaoSeedAudioRequest(value);
  if (model === MUREKA_MODEL) return murekaRequest(value);
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
  let found = false;
  for (const field of ["consumeMoney", "thirdPartyConsumeMoney"]) {
    const value = usage[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
    found = true;
    total += Number(value);
  }
  const coins = usage.consumeCoins;
  if (coins !== undefined && coins !== null) {
    if (typeof coins !== "string" || !/^\d+(?:\.\d+)?$/.test(coins)) return null;
    found = true;
    total += Number(coins) / 250;
  }
  if (!found || !Number.isFinite(total) || total < 0 || total > MAX_UPSTREAM_CREDITS) return null;
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

// Mureka lyrics arrive as text results; title results, when present, pair
// with lyrics in order. Song ID results are not lyrics.
function lyricEntries(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.results)) return [];
  const lyrics = [];
  const titles = [];
  for (const result of data.results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    if (trimmed(result.outputType).toLowerCase() !== "text" || !trimmed(result.text)) continue;
    const name = trimmed(result.name).toLowerCase();
    if (name === "songids") continue;
    if (name === "title" || name === "titles") {
      titles.push(trimmed(result.text));
      continue;
    }
    let entry = { text: result.text };
    if (/^\s*\{/.test(result.text)) {
      try {
        const parsed = JSON.parse(result.text);
        if (parsed && typeof parsed.lyrics === "string" && parsed.lyrics.trim()) {
          entry = { text: parsed.lyrics };
          if (trimmed(parsed.title)) entry.title = trimmed(parsed.title);
        }
      } catch (_error) {
        // Plain text that happens to start with a brace stays as it is.
      }
    }
    lyrics.push(entry);
    if (lyrics.length === 16) break;
  }
  return lyrics.map(function (entry, index) {
    const output = { outputType: "text", text: entry.text };
    const title = entry.title || titles[index];
    if (title) output.title = title;
    return output;
  });
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
  let data = task.data === undefined ? null : task.data;
  // Mureka also lists song IDs as text results; clients receive one entry
  // per audio file, or one per lyrics candidate for lyrics tasks.
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.results)) {
    const audio = audioEntries(data);
    data = { ...data, results: audio.length > 0 ? audio : lyricEntries(data) };
  }
  const output = {
    task_id: task.task_id || "",
    status: status,
    progress: task.progress || "",
    fail_reason: task.fail_reason || "",
    data: data,
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
  const body = requestForModel(model, ctx.requestBody);
  let endpoint = profileFor(model).endpoint;
  let action = "audio_generation";
  if (model === MUREKA_MODEL) {
    endpoint = MUREKA_ENDPOINTS[body.mode];
    if (body.mode === "lyrics") action = LYRICS_ACTION;
    delete body.mode;
  }
  return {
    url: requestURL(ctx.baseUrl, endpoint),
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization(ctx),
    },
    body: body,
    action: action,
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response && response.body, "invalid RunningHub submission response");
  if (!trimmed(body.taskId) && trimmed(body.errorCode)) {
    return {
      taskId: "rh-rejected-" + (trimmed(ctx && ctx.publicTaskId) || utils.uuid()),
      taskData: body,
      immediate: {
        status: "FAILURE",
        reason: "RunningHub error " + trimmed(body.errorCode) + ": " + trimmed(body.errorMessage).slice(0, 300),
      },
    };
  }
  // Model API responses are top-level {taskId, status, results}; do not apply
  // the legacy RunningHub Workflow {code, data, msg} envelope here.
  const task = taskData(body, "invalid RunningHub submission response");
  return { taskId: trimmed(task.taskId), taskData: task };
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

export function parseTaskResult(ctx, body) {
  const task = taskData(body, "invalid RunningHub task response");
  const status = trimmed(task.status).toUpperCase();
  if (["PENDING", "CREATE", "QUEUED", "SUBMITTED"].includes(status)) return { status: "SUBMITTED", progress: "" };
  if (["RUNNING", "PROCESSING", "IN_PROGRESS"].includes(status)) return { status: "IN_PROGRESS", progress: "" };
  if (["FAILED", "FAILURE", "ERROR", "CANCEL", "CANCELED", "CANCELLED"].includes(status)) {
    return { status: "FAILURE", progress: "100%", reason: failureReason(task) };
  }
  if (status === "SUCCESS") {
    if (ctx && ctx.action === LYRICS_ACTION) {
      if (lyricEntries(task).length === 0) return { status: "UNKNOWN", reason: "RunningHub success response is missing lyrics" };
      return { status: "SUCCESS", progress: "100%", reason: "" };
    }
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
  else if (model === DOUBAO_SEED_AUDIO_MODEL) {
    const chars = Array.from(request.text_prompt).length;
    const speedFactor = 1 + request.speech_rate / 100;
    const seconds = Math.max(5, Math.ceil(chars / (2 * speedFactor)));
    estimate = seconds * DOUBAO_SEED_AUDIO_CNY_PER_SECOND;
  } else if (model === MUREKA_MODEL) {
    estimate = request.mode === "lyrics" ? MUREKA_LYRICS_CNY_PER_CALL : request.n * MUREKA_V9_CNY_PER_SONG;
  } else {
    const rate = model === DOUBAO_TTS_MODEL ? DOUBAO_TTS_CNY_PER_1000_CHARACTERS : MINIMAX_TTS_CNY_PER_1000_CHARACTERS;
    estimate = (Array.from(request.text).length * rate) / 1000;
  }
  // Reserve the published estimate; completion replaces it with RunningHub's
  // actual CNY deduction.
  return { upstream_cny: Number(estimate.toFixed(6)) };
}

export function extractUsageOnComplete(task, result, body) {
  const model = trimmed(task && (task.upstreamModel || task.model));
  if ([QWEN_MODEL, DOUBAO_TTS_MODEL, DOUBAO_SEED_AUDIO_MODEL, MINIMAX_TTS_MODEL, MUREKA_MODEL].includes(model)) {
    const status = String((result && result.status) || "").toUpperCase();
    if (["FAILURE", "CANCEL", "CANCELLED", "CANCELED"].includes(status)) return { upstream_cny: 0 };
    if (status !== "SUCCESS") return null;
    const cny = upstreamCNY(body);
    if (cny !== null) return { upstream_cny: cny };
    const usage = body && body.usage;
    const seconds = usage && usage.billingSeconds;
    const amountsMissing =
      usage &&
      typeof usage === "object" &&
      !Array.isArray(usage) &&
      ["consumeMoney", "thirdPartyConsumeMoney", "consumeCoins"].every(function (field) {
        return usage[field] === undefined || usage[field] === null;
      });
    if (
      model !== DOUBAO_SEED_AUDIO_MODEL ||
      !amountsMissing ||
      typeof seconds !== "string" ||
      !/^\d+(?:\.\d+)?$/.test(seconds)
    ) {
      return null;
    }
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0 || value > 3600) return null;
    return { upstream_cny: Number((value * DOUBAO_SEED_AUDIO_CNY_PER_SECOND).toFixed(6)) };
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
    const requestBody = requestForModel(model, body);
    const action = model === MUREKA_MODEL && requestBody.mode === "lyrics" ? LYRICS_ACTION : "audio_generation";
    return { kind: "submit", model: model, action: action, requestBody: requestBody };
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

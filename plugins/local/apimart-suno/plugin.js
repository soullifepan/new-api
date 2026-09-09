// APIMart/APIB Suno music tasks, isolated from both the image plugin and Suno-API.
// Setup: Task Plugin channel, key am-suno, model suno-am, base https://api.apib.ai.
// Leave model mapping empty or map suno-am -> suno. Configure an administrator task
// expression over requests/action. Each operation is one request, not two
// songs or one request per download format. Provider costs are not billing inputs.
// Primary contract: https://docs.apib.ai/cn/api-reference/audios/suno/overview
// Public source IDs are resolved by the host (owner/plugin/channel) before these
// hooks validate completion, operation and 1-based track index. Never accept a
// provider persona/audio ID: use persona_task_id or vox_task_id instead.
//
// Client API: POST /am/suno/v1/generations[/<action>] and
// GET /am/suno/v1/tasks/:task_id. Action suffixes below are case-sensitive.
// Configure only these native routes, not an OpenAI audio/image endpoint override.
// Generation requires version; other versioned actions explicitly default to v5.5.
// For follow-ups use public task_id + audio_index (1-based), or task_ids +
// audio_indexes for mashup. addVocals/addInstrumental require uploadTask sources;
// concat requires extend. Persona references use persona_task_id on custom
// generation/extend/coverSong/mashup; Persona creation accepts vox_task_id from vox.
// Raw provider resource IDs are not a public API. createVoice takes an audio_url
// containing MP3/WAV media, not a source task ID. Media format is checked upstream.
// upsampleTags is immediately queryable, but still uses the documented task_id
// submission envelope. There is no documented cancel/callback endpoint to expose.
//
// Billing configuration belongs to the administrator, under model suno-am.
// Public USD/request snapshot (2026-09-09), not installed prices:
// https://api.apib.ai/api/pricing/model?model=suno
// generation/extend/coverSong/remaster/addVocals/addInstrumental/addStem/
// replaceMusic/mashup/sample/midi: 0.0625; inspo: 0.085; sounds: 0.012;
// lyrics/crop/removeSection/fadeIn/fadeOut: 0.01; adjustSpeed: 0.03;
// stems: 0.125; stemsAll: 0.3; createVoice: 0.02; alignedLyrics/bpm: 0.001;
// upsampleTags/uploadTask/vox/persona/concat/generateMp4: 0.005; download: 0.002.
// These published version prices currently match within each action. Preserve
// administrator overrides and recheck rates before activation; do not apply the
// ambiguous discount_percent=20 alongside discount_rate=1 automatically.
// Use action tiers returning USD, with tier() on every branch. Version is request-only.
// The download tier body, for example, is tier("download", u("requests") * 0.002).
// Fill ALL action tiers using the task pricing editor; no /1000000 conversion.
// Completed tasks preserve one request even with two songs or three formats.
// The host handles pre-consumption, final settlement, and failed-task refunds.
//
// Query results keep media URLs and text but strip private resource IDs/costs.
// Media links may expire; save outputs promptly. The existing host artifact API
// also exposes credentialless GET/HEAD access for audio/image/video/MIDI/archive
// results. Never store API keys, real user prompts, or private media in fixtures.
// Verification:
// go run . plugin lint plugins/local/apimart-suno/plugin.js
// go run . plugin test plugins/local/apimart-suno/plugin.js --fixture plugins/local/apimart-suno/apimart-suno.fixture.json
const VERSIONS = ["v3.5", "v4", "v4.5", "v4.5+", "v4.5-all", "v5", "v5.5"];
const WEIGHTS = ["style_weight", "weirdness_constraint", "audio_weight"];
const CUSTOM_FIELDS = ["prompt", "title", "tags", "negative_tags", ...WEIGHTS];
const FOLLOW_FIELDS = ["custom", "gpt_description", ...CUSTOM_FIELDS];
const VOICE_FIELDS = ["vocal_gender"];
const SOURCE_FIELDS = ["task_id", "audio_index"];
// These are plugin safety bounds, not advertised Suno model limits.
const MAX_SECONDS = 3600;
const MAX_TRACKS = 64;
const ACTIONS = {
  generation: { versions: VERSIONS, requiredVersion: true, fields: ["custom", "instrumental", "prompt", "title", "style", "negative_tags", "auto_lyrics", "vocal_gender", ...WEIGHTS, "persona_task_id"] },
  lyrics: { fields: ["prompt", "lyrics_model"] },
  inspo: { versions: VERSIONS.slice(1), fields: ["audio_urls", "prompt", "title", "tags", "negative_tags", "auto_lyrics", ...VOICE_FIELDS, ...WEIGHTS], weightAlias: true },
  sounds: { versions: ["v5", "v5.5"], fields: ["prompt", "type", "bpm", "key"] },
  upsampleTags: { fields: ["tags"] },
  uploadTask: { fields: ["audioFilePath"] },
  extend: { versions: VERSIONS, source: "music", fields: ["continue_at", ...FOLLOW_FIELDS, ...VOICE_FIELDS, "auto_lyrics", "persona_task_id"], weightAlias: true },
  coverSong: { versions: VERSIONS, source: "music", fields: [...FOLLOW_FIELDS, ...VOICE_FIELDS, "persona_task_id"], inferCustom: true, weightAlias: true },
  remaster: { versions: ["v4.5+", "v5", "v5.5"], source: "music", fields: ["variation_category"] },
  stems: { source: "music", fields: ["stem_type"] },
  stemsAll: { source: "music", fields: [] },
  addVocals: { versions: ["v5", "v5.5"], source: "uploadTask", fields: [...FOLLOW_FIELDS, ...VOICE_FIELDS], inferCustom: true, weightAlias: true },
  addInstrumental: { versions: ["v5", "v5.5"], source: "uploadTask", fields: [...FOLLOW_FIELDS, ...VOICE_FIELDS], inferCustom: true, weightAlias: true },
  addStem: { versions: ["v5.5"], source: "music", fields: FOLLOW_FIELDS, inferCustom: true, weightAlias: true },
  vox: { source: "music", fields: ["vocal_start_s", "vocal_end_s"] },
  createVoice: { fields: ["audio_url"] },
  persona: { source: "music", fields: ["name", "describe", "styles", "vox_task_id", "vocal_start_s", "vocal_end_s"] },
  replaceMusic: { versions: ["v4", "v4.5+", "v5", "v5.5"], source: "music", fields: ["start_s", "end_s", "infill_lyrics", "prompt", "title", "tags", "negative_tags"] },
  removeSection: { source: "music", fields: ["start_s", "end_s"] },
  crop: { source: "music", fields: ["start_s", "end_s"] },
  fadeIn: { source: "music", fields: ["duration_s", "title"] },
  fadeOut: { source: "music", fields: ["duration_s", "title"] },
  adjustSpeed: { source: "music", fields: ["speed", "keep_pitch", "title"] },
  concat: { source: "extend", fields: [] },
  mashup: { versions: VERSIONS, source: "pair", fields: ["instrumental", "auto_lyrics", ...FOLLOW_FIELDS, ...VOICE_FIELDS, "persona_task_id"], inferCustom: true, weightAlias: true },
  sample: { versions: VERSIONS, source: "music", fields: ["start_s", "end_s", "instrumental", "auto_lyrics", ...FOLLOW_FIELDS, ...VOICE_FIELDS], inferCustom: true, weightAlias: true },
  midi: { source: "music", fields: [] },
  alignedLyrics: { source: "music", fields: [] },
  bpm: { source: "music", fields: [] },
  generateMp4: { source: "music", fields: [] },
  download: { source: "music", fields: ["formats", "format"] },
};
for (const spec of Object.values(ACTIONS)) {
  spec.allowed = new Set(["model", ...spec.fields]);
  if (spec.versions) spec.allowed.add("version");
  if (spec.weightAlias) spec.allowed.add("weirdness");
  for (const field of spec.source === "pair" ? ["task_ids", "audio_indexes"] : spec.source ? SOURCE_FIELDS : []) spec.allowed.add(field);
}

export const meta = {
  apiVersion: 1,
  key: "am-suno",
  name: "AM Suno",
  version: "0.2.0",
  author: { name: "Tapcomfy" },
  description: { en: "Suno music generation, editing and audio tasks via AM.", zh: "通过 AM 提供 Suno 音乐生成、编辑及音频任务。" },
  fetchMode: "per_task",
  allowedHosts: ["api.apib.ai", "api.apimart.ai"],
  models: ["suno-am"],
  usageSchema: {
    requests: { type: "number", unit: "count", description: { en: "Operations, independent of output track or format count.", zh: "操作次数，不按输出歌曲或下载格式数量重复计费。" } },
    action: { enum: Object.keys(ACTIONS), description: { en: "Suno operation.", zh: "Suno 操作。" } },
  },
  usageExamples: [
    { label: "Music", facts: { requests: 1, action: "generation" } },
    { label: "Inspiration", facts: { requests: 1, action: "inspo" } },
    { label: "All stems", facts: { requests: 1, action: "stemsAll" } },
    { label: "Multi-format download", facts: { requests: 1, action: "download" } },
  ],
  routes: Object.keys(ACTIONS).map(function (action) {
    return { method: "POST", path: "/am/suno/v1/generations" + (action === "generation" ? "" : "/" + action), type: "submit", action: action, decode: "decodeSubmit", render: "renderSubmitted" };
  }).concat([{ method: "GET", path: "/am/suno/v1/tasks/:task_id", type: "query", render: "renderTask" }]),
};

const SUBMIT_ACTIONS = new Map();
for (const route of meta.routes) {
  if (route.type === "submit" && route.method === "POST") SUBMIT_ACTIONS.set(route.path, route.action);
}

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
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(field + " must be " + (integer ? "an integer " : "a number ") + "between " + minimum + " and " + maximum);
  }
  return value;
}

function httpURL(value) {
  return typeof value === "string" && value.length <= 8192 && /^https?:\/\/[^\s\/@?#\\]+(?:[\/?#][^\s\\]*)?$/i.test(value);
}

function sourceID(value, field) {
  return requiredText(value, field, 128);
}

function normalizedRequest(action, request) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error("unsupported Suno action");
  object(request, "request body");
  const spec = ACTIONS[action];
  for (const field of Object.keys(request)) {
    if (!spec.allowed.has(field)) throw new Error("unsupported field for " + action + ": " + field);
  }
  if (request.model !== undefined && request.model !== "suno-am") throw new Error("model must be suno-am");
  const body = { ...request };
  delete body.model;
  if (spec.versions) {
    if (body.version === undefined && !spec.requiredVersion) body.version = "v5.5";
    if (!spec.versions.includes(body.version)) throw new Error("version must be one of " + spec.versions.join(", "));
  }
  for (const field of ["custom", "instrumental", "auto_lyrics", "keep_pitch"]) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") throw new Error(field + " must be boolean");
  }
  if (body.weirdness !== undefined) {
    if (body.weirdness_constraint !== undefined && body.weirdness_constraint !== body.weirdness) throw new Error("weirdness conflicts with weirdness_constraint");
    body.weirdness_constraint = body.weirdness;
    delete body.weirdness;
  }
  for (const field of WEIGHTS) if (body[field] !== undefined) number(body[field], field, 0, 1);
  for (const field of ["prompt", "title", "style", "tags", "negative_tags", "gpt_description", "infill_lyrics", "name", "describe", "styles"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > 65536)) throw new Error(field + " must be a string of at most 65536 characters");
  }
  if (body.vocal_gender !== undefined) {
    const gender = typeof body.vocal_gender === "string" ? body.vocal_gender.toLowerCase() : "";
    if (!["m", "male", "f", "female"].includes(gender)) throw new Error("vocal_gender must be Male or Female");
    body.vocal_gender = gender === "m" || gender === "male" ? "Male" : "Female";
  }
  if (spec.source === "pair") {
    if (!Array.isArray(body.task_ids) || body.task_ids.length !== 2) throw new Error("task_ids must contain exactly two referenced tasks");
    body.task_ids = body.task_ids.map(function (id) { return sourceID(id, "task_ids"); });
    if (body.audio_indexes !== undefined) {
      if (!Array.isArray(body.audio_indexes) || body.audio_indexes.length !== 2) throw new Error("audio_indexes must contain exactly two indexes");
      for (const value of body.audio_indexes) number(value, "audio_indexes", 1, MAX_TRACKS, true);
    }
  } else if (spec.source) {
    body.task_id = sourceID(body.task_id, "task_id");
    if (body.audio_index !== undefined) number(body.audio_index, "audio_index", 1, MAX_TRACKS, true);
  }
  for (const field of ["persona_task_id", "vox_task_id"]) {
    if (body[field] !== undefined) body[field] = sourceID(body[field], field);
  }
  if (spec.inferCustom && body.custom === undefined) {
    body.custom = !!text(body.prompt) || (!text(body.gpt_description) && (!!text(body.tags) || !!text(body.title)));
  }
  if (action === "generation") {
    if (body.custom !== true || body.instrumental !== true) requiredText(body.prompt, "prompt");
    if (body.custom !== true) {
      for (const field of ["title", "style", "negative_tags", "auto_lyrics", "persona_task_id", ...WEIGHTS]) delete body[field];
    }
  } else if (spec.inferCustom || action === "extend") {
    if (body.custom === true) {
      delete body.gpt_description;
    } else {
      if (spec.inferCustom) requiredText(body.gpt_description, "gpt_description");
      for (const field of [...CUSTOM_FIELDS, "auto_lyrics", "persona_task_id"]) delete body[field];
    }
  }
  if (action === "lyrics") {
    requiredText(body.prompt, "prompt");
    if (body.lyrics_model !== undefined && !["classic", "remi"].includes(body.lyrics_model)) throw new Error("lyrics_model must be classic or remi");
  }
  if (action === "inspo") {
    if (!Array.isArray(body.audio_urls) || body.audio_urls.length < 1 || body.audio_urls.length > 4 || body.audio_urls.some(function (url) { return !httpURL(url); })) throw new Error("audio_urls must contain 1 to 4 HTTP(S) URLs");
  }
  if (action === "sounds") {
    requiredText(body.prompt, "prompt");
    if (body.type !== undefined && !["one-shot", "loop"].includes(body.type)) throw new Error("type must be one-shot or loop");
    if (body.bpm !== undefined) number(body.bpm, "bpm", 1, 300, true);
    if (body.key !== undefined && (typeof body.key !== "string" || !/^(?:[A-G]|[CDFGA]#)m?$/.test(body.key))) throw new Error("key must be a supported sharp-only musical key");
  }
  if (action === "upsampleTags") requiredText(body.tags, "tags");
  for (const field of ["audioFilePath", "audio_url"]) {
    if ((action === "uploadTask" && field === "audioFilePath") || (action === "createVoice" && field === "audio_url")) {
      if (!httpURL(body[field])) throw new Error(field + " must be an HTTP(S) audio URL");
    }
  }
  // A URL suffix does not prove the media format (signed/extensionless URLs work).
  // createVoice's MP3/WAV content restriction is enforced by the provider.
  if (action === "extend") number(body.continue_at, "continue_at", 0, MAX_SECONDS, true);
  if (action === "remaster" && body.variation_category !== undefined && !["subtle", "normal", "high"].includes(body.variation_category)) throw new Error("variation_category must be subtle, normal or high");
  if (action === "stems") {
    if (body.stem_type === undefined) body.stem_type = "lead_vocal";
    // The provider has over 100 types without an exhaustive published enum.
    if (typeof body.stem_type !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(body.stem_type)) throw new Error("stem_type must be a valid stem name");
  }
  if (["replaceMusic", "removeSection", "crop", "sample"].includes(action)) {
    number(body.start_s, "start_s", 0, MAX_SECONDS, action !== "sample");
    number(body.end_s, "end_s", 0, MAX_SECONDS, action !== "sample");
    if (body.end_s <= body.start_s) throw new Error("end_s must be greater than start_s");
  }
  if (action === "fadeIn" || action === "fadeOut") number(body.duration_s, "duration_s", 0, MAX_SECONDS, true);
  if (action === "adjustSpeed") number(body.speed, "speed", 0.25, 4);
  for (const field of ["vocal_start_s", "vocal_end_s"]) {
    if (body[field] !== undefined) number(body[field], field, 0, MAX_SECONDS, true);
  }
  if (body.vocal_start_s !== undefined && body.vocal_end_s !== undefined && body.vocal_end_s <= body.vocal_start_s) throw new Error("vocal_end_s must be greater than vocal_start_s");
  if (action === "persona") requiredText(body.name, "name", 256);
  if (action === "download") {
    if (body.formats !== undefined && body.format !== undefined) throw new Error("provide formats or format, not both");
    const formats = body.formats === undefined ? [body.format] : body.formats;
    if (!Array.isArray(formats) || formats.length < 1 || formats.length > MAX_TRACKS || formats.some(function (format) { return typeof format !== "string" || !["mp3", "m4a", "wav"].includes(format.toLowerCase()); })) throw new Error("formats must contain mp3, m4a or wav entries");
    body.formats = [...new Set(formats.map(function (format) { return format.toLowerCase(); }))];
    delete body.format;
  }
  return body;
}

function originIDs(action, body) {
  const ids = ACTIONS[action].source === "pair" ? [...body.task_ids] : ACTIONS[action].source ? [body.task_id] : [];
  if (body.persona_task_id) ids.push(body.persona_task_id);
  if (body.vox_task_id) ids.push(body.vox_task_id);
  return [...new Set(ids)];
}

// Both envelopes are documented: overview has top-level status, download nests
// status under code/data. Payload-only data is also used by host task views.
function taskPayload(raw) {
  const outer = object(raw, "task response");
  if (outer.status !== undefined) return { envelope: outer, payload: outer.data === undefined ? outer : object(outer.data, "task data") };
  if (outer.data !== undefined) {
    const inner = object(outer.data, "task data");
    return { envelope: inner, payload: inner };
  }
  return { envelope: outer, payload: outer };
}

function storedResult(task) {
  const payload = taskPayload(task.data || {}).payload;
  return payload.result === undefined ? {} : object(payload.result, "task result");
}

function resolvedOrigin(ctx, id, action, audioIndex) {
  const origin = (Array.isArray(ctx.originTasks) ? ctx.originTasks : []).find(function (entry) { return entry.taskId === id; });
  if (!origin || origin.status !== "SUCCESS" || !text(origin.upstreamTaskId)) throw new Error("referenced task must be completed and resolved by the host");
  if (action && origin.action !== action) throw new Error("referenced task must be a " + action + " task");
  const result = storedResult(origin);
  let song;
  if (audioIndex !== undefined) {
    if (!Array.isArray(result.music) || result.music.length > MAX_TRACKS || !result.music[audioIndex - 1]) throw new Error("audio_index is outside the referenced music result");
    song = object(result.music[audioIndex - 1], "referenced audio");
    if (!text(song.audio_id) && !text(song.audio_url)) throw new Error("referenced audio_index has no audio");
  }
  return { origin: origin, result: result, song: song };
}

export function buildSubmitRequest(ctx) {
  const body = normalizedRequest(ctx.action, ctx.requestBody);
  const mapped = ctx.upstreamModel;
  if (mapped !== undefined && mapped !== "" && mapped !== "suno-am" && mapped !== "suno") throw new Error("upstream model must be suno");
  const spec = ACTIONS[ctx.action];
  if (spec.source) {
    const ids = spec.source === "pair" ? body.task_ids : [body.task_id];
    const indexes = spec.source === "pair" ? body.audio_indexes || [1, 1] : [body.audio_index || 1];
    const resolved = ids.map(function (id, position) {
      return resolvedOrigin(ctx, id, spec.source === "uploadTask" || spec.source === "extend" ? spec.source : "", indexes[position]);
    });
    if (spec.source === "pair") body.task_ids = resolved.map(function (source) { return source.origin.upstreamTaskId; });
    else body.task_id = resolved[0].origin.upstreamTaskId;
    const duration = resolved[0].song.duration;
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      for (const field of ["continue_at", "end_s", "duration_s", "vocal_end_s"]) {
        if (body[field] !== undefined && body[field] > duration) throw new Error(field + " exceeds the referenced audio duration");
      }
    }
  }
  if (body.persona_task_id) {
    const source = resolvedOrigin(ctx, body.persona_task_id, "persona");
    body.persona_id = requiredText(source.result.persona_id, "referenced persona_id", 256);
    delete body.persona_task_id;
  }
  if (body.vox_task_id) {
    const source = resolvedOrigin(ctx, body.vox_task_id, "vox");
    body.vox_audio_id = requiredText(source.result.vox_audio_id, "referenced vox_audio_id", 256);
    // Do not fabricate a crop interval when the provider did not return it.
    for (const field of ["vocal_start_s", "vocal_end_s"]) {
      if (source.result[field] !== undefined) {
        number(source.result[field], "referenced " + field, 0, MAX_SECONDS, true);
        if (body[field] !== undefined && body[field] !== source.result[field]) throw new Error(field + " must match the referenced Vox interval");
        body[field] = source.result[field];
      }
    }
    delete body.vox_task_id;
  }
  body.model = "suno";
  return {
    url: ctx.baseUrl.replace(/\/$/, "") + "/v1/music/generations" + (ctx.action === "generation" ? "" : "/" + ctx.action),
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: ctx.action,
  };
}

export function parseSubmitResponse(_ctx, response) {
  if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) throw new Error("Suno submission HTTP error");
  const body = object(response.body, "submission response");
  if (body.code !== 200) throw new Error("Suno submission failed");
  if (!Array.isArray(body.data) || body.data.length !== 1) throw new Error("Suno submission must return one task_id");
  const entry = object(body.data[0], "submitted task");
  const taskId = requiredText(entry.task_id, "task_id", 256);
  return { taskId: taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  const id = requiredText(ctx.taskId, "task_id", 256);
  return { url: ctx.baseUrl.replace(/\/$/, "") + "/v1/music/tasks/" + encodeURIComponent(id), method: "GET", headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey } };
}

export function parseTaskResult(_ctx, body, response) {
  if (response && response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) throw new Error("Suno query HTTP error");
  object(body, "task response");
  if (body.code !== undefined && body.code !== 200) throw new Error("Suno task query failed");
  const { envelope, payload } = taskPayload(body);
  const states = { submitted: "SUBMITTED", pending: "SUBMITTED", processing: "IN_PROGRESS", completed: "SUCCESS", failed: "FAILURE" };
  const status = states[envelope.status];
  if (!status) return { status: "UNKNOWN", reason: "unrecognized Suno task status" };
  const terminal = status === "SUCCESS" || status === "FAILURE";
  const progress = terminal ? "100%" : typeof envelope.progress === "number" && Number.isFinite(envelope.progress) && envelope.progress >= 0 && envelope.progress <= 100 ? String(envelope.progress) + "%" : "";
  return { status: status, progress: progress, reason: status === "FAILURE" ? publicMessage(payload.error && payload.error.message) || "Suno task failed" : "" };
}

const MEDIA_FIELDS = {
  audio_url: "audio", image_url: "image", image_large_url: "image", video_url: "video",
  midi_url: "file", zip_url: "file", wavUrl: "audio",
};

function artifactEntries(task) {
  const result = storedResult(task);
  const entries = [];
  const candidates = [{ value: result, path: "result" }];
  for (const field of ["music", "stems"]) {
    if (Array.isArray(result[field])) {
      if (result[field].length > MAX_TRACKS) throw new Error("too many Suno output tracks");
      result[field].forEach(function (value, index) { candidates.push({ value: object(value, "output track"), path: field + "." + index }); });
    }
  }
  for (const candidate of candidates) {
    for (const [field, type] of Object.entries(MEDIA_FIELDS)) {
      const url = candidate.value[field];
      if (!httpURL(url)) continue;
      if (field === "wavUrl" && Array.isArray(result.files) && result.files.some(function (file) { return file && file.url === url; })) continue;
      entries.push({ key: "asset-" + utils.hmacSHA256(candidate.path + "." + field + "\n" + url, "new-api:apimart-suno:artifact"), type: type, url: url });
    }
  }
  if (Array.isArray(result.files)) {
    if (result.files.length > MAX_TRACKS) throw new Error("too many Suno output files");
    result.files.forEach(function (file, index) {
      if (!file || !httpURL(file.url)) return;
      const type = ["mp3", "m4a", "wav"].includes(file.format) ? "audio" : file.format === "mp4" ? "video" : "file";
      entries.push({ key: "asset-" + utils.hmacSHA256("files." + index + "\n" + file.url, "new-api:apimart-suno:artifact"), type: type, url: file.url });
    });
  }
  if (entries.length > 64) throw new Error("too many Suno artifacts");
  return entries;
}

// Keep structured lyrics/analysis and media metadata, but strip private resource
// identifiers at every nesting level. Bound traversal of provider-controlled JSON.
function publicResult(value, depth = 0) {
  if (depth > 8) throw new Error("Suno result nesting exceeds limit");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length > 4096) throw new Error("Suno result array exceeds limit");
    return value.map(function (item) { return publicResult(item, depth + 1); });
  }
  const projected = {};
  for (const [key, item] of Object.entries(object(value, "Suno result"))) {
    if (/(?:^id$|_ids?$|Id$|Ids$|token|secret|authorization|api_key|^cost$|credits_cost|^__proto__$|^constructor$|^prototype$)/i.test(key)) continue;
    if (Object.hasOwn(MEDIA_FIELDS, key) || key === "url") {
      if (httpURL(item)) projected[key] = item;
      continue;
    }
    // Unknown URL-bearing fields are not published or used as download targets.
    if (/url/i.test(key)) continue;
    projected[key] = publicResult(item, depth + 1);
  }
  return projected;
}

export const native = {
  decodeSubmit: function (ctx) {
    const action = ctx.method === "POST" ? SUBMIT_ACTIONS.get(ctx.path) : undefined;
    if (!action) throw new Error("unsupported Suno route");
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = normalizedRequest(action, ctx.body.value);
    const ids = originIDs(action, body);
    const intent = { kind: "submit", model: "suno-am", action: action, requestBody: body };
    if (ids.length) intent.originTaskIds = ids;
    return intent;
  },
  renderSubmitted: function (_ctx, task) {
    return { code: 200, data: [{ status: "submitted", task_id: task.task_id }] };
  },
  renderTask: function (_ctx, task) {
    const status = { SUCCESS: "completed", FAILURE: "failed", IN_PROGRESS: "pending", SUBMITTED: "submitted", NOT_START: "submitted" }[task.status] || "pending";
    const progress = status === "completed" || status === "failed" ? 100 : Number(String(task.progress || "0").replace(/%$/, ""));
    const response = { task_id: task.task_id, status: status, progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0, data: {} };
    if (status === "completed") response.data.result = publicResult(storedResult(task));
    if (status === "failed") response.data.error = { message: publicMessage(task.fail_reason) || "Suno task failed" };
    return response;
  },
  error: function (_ctx, error) {
    return { code: error.code, message: publicMessage(error.message) };
  },
};

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  return artifactEntries(task).map(function (entry) { return { key: entry.key, type: entry.type }; });
}

export function buildContentRequest(ctx) {
  if (ctx.status !== "SUCCESS") throw new Error("artifact_not_found");
  const method = ctx.clientRequest && ctx.clientRequest.method || "GET";
  if (method !== "GET" && method !== "HEAD") throw new Error("unsupported artifact method");
  const entry = artifactEntries(ctx).find(function (artifact) { return artifact.key === ctx.artifactKey; });
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
  const status = taskPayload(body).envelope.status;
  return status === "completed" ? { requests: 1 } : null;
}

# APIMart Suno 任务插件

本地插件键为 `apimart-suno`，版本为 `0.1.0`，对外模型别名为 `suno-am`。它将 APIMart/APIB 的 Suno 音乐生成、编辑、分析与下载接入 New API 任务宿主。

本插件独立于 APIMart 图片插件、APIMart Midjourney 插件和内置 `sunoapi`；这些接口的请求与查询协议不同，不能仅替换基础地址后混用。

## 渠道配置

1. 在插件管理中上传并启用本目录的 `plugin.js`。
2. 创建类型为 `Task Plugin` 的渠道，选择本插件：

   ```text
   插件键：apimart-suno
   基础地址：https://api.apib.ai
   渠道模型：suno-am
   模型映射：留空，或 {"suno-am":"suno"}
   ```

3. 在渠道密钥配置中填写供应商 API Key，并配置允许使用的分组。
4. 为 **`suno-am`** 配置覆盖全部操作的任务计费表达式，再开放调用。

基础地址也可使用 `https://api.apimart.ai`，不要附加 `/v1/music`。客户端的 `model` 可省略或填写 `suno-am`；插件始终向上游发送 `model: "suno"`，拒绝其他模型映射。版本通过请求的 `version` 指定，不为每个 Suno 版本创建独立插件。

原生路由由插件声明，不要额外配置普通 OpenAI 音频或图片端点元数据。客户端使用 New API 令牌调用网关，不使用渠道的供应商密钥。

## 原生接口

```text
POST /apimart/suno/v1/generations
POST /apimart/suno/v1/generations/<操作后缀>
GET  /apimart/suno/v1/tasks/:task_id
```

上游对应 `/v1/music/generations`、`/v1/music/generations/<操作后缀>` 和 `/v1/music/tasks/:task_id`。后缀区分大小写，不能把文档页面的连字符名称直接当作 API 路径。

下表覆盖全部 31 个提交操作。`generation` 是基础生成接口的内部 action，**不追加 `/generation`**。

版本组：

- **全部**：`v3.5`、`v4`、`v4.5`、`v4.5+`、`v4.5-all`、`v5`、`v5.5`。
- **v4 起**：全部版本去掉 `v3.5`。
- **无**：请求不能携带 `version`，计费用量中的版本为 `none`。
- 基础生成必须显式传 `version`；其他有版本的操作缺省为 `v5.5`。

| action / 操作后缀 | 功能 | 支持版本 | 关键输入与来源要求 |
| --- | --- | --- | --- |
| `generation`（无后缀） | 生成歌曲 | 全部，必填 | `prompt`、`custom`、`instrumental`；自定义风格字段为 `style` |
| `lyrics` | 生成歌词 | 无 | 必填 `prompt`；`lyrics_model` 可为 `classic` / `remi` |
| `inspo` | 音频灵感创作 | v4 起 | 必填 `audio_urls`，1–4 个公开音频 URL |
| `sounds` | 生成音效 | `v5` / `v5.5` | 必填 `prompt`；`type` 为 `one-shot` / `loop`，可传 `bpm`、`key` |
| `upsampleTags` | 增强风格标签 | 无 | 必填 `tags` |
| `uploadTask` | 导入音频 | 无 | 必填 `audioFilePath`，公开音频直链，不是 multipart 文件上传 |
| `extend` | 续写 | 全部 | 音轨来源；必填 `continue_at`，自定义风格字段为 `tags` |
| `coverSong` | 风格翻唱 | 全部 | 音轨来源；`custom` / `prompt` / `gpt_description` / `tags` |
| `remaster` | 重制 | `v4.5+` / `v5` / `v5.5` | 音轨来源；`variation_category` 为 `subtle` / `normal` / `high` |
| `stems` | 提取单个分轨 | 无 | 音轨来源；`stem_type` 缺省为 `lead_vocal` |
| `stemsAll` | 全部分轨 | 无 | 音轨来源 |
| `addVocals` | 添加人声 | `v5` / `v5.5` | 来源必须是 `uploadTask` |
| `addInstrumental` | 添加伴奏 | `v5` / `v5.5` | 来源必须是 `uploadTask` |
| `addStem` | 叠加音轨 | `v5.5` | 音轨来源；使用 `tags` 等创作字段，不接受 `stem_type` |
| `vox` | 提取 Vox | 无 | 音轨来源；可传 `vocal_start_s` / `vocal_end_s` |
| `createVoice` | 从音频提取音色 | 无 | 必填 `audio_url`，内容须为 MP3 / WAV；格式由上游验证 |
| `persona` | 创建 Persona | 无 | 音轨来源及必填 `name`；可传 `describe`、`styles`、`vox_task_id` |
| `replaceMusic` | 替换片段 | `v4` / `v4.5+` / `v5` / `v5.5` | 音轨来源；必填 `start_s` / `end_s`，可传 `infill_lyrics` |
| `removeSection` | 删除片段 | 无 | 音轨来源；必填 `start_s` / `end_s` |
| `crop` | 裁剪 | 无 | 音轨来源；必填 `start_s` / `end_s` |
| `fadeIn` | 淡入 | 无 | 音轨来源；必填 `duration_s`，可传 `title` |
| `fadeOut` | 淡出 | 无 | 音轨来源；必填 `duration_s`，可传 `title` |
| `adjustSpeed` | 调整速度 | 无 | 音轨来源；必填 `speed`，可传 `keep_pitch`、`title` |
| `concat` | 拼接续写片段 | 无 | 来源必须是 `extend`，不是任意两个歌曲的拼接 |
| `mashup` | 混搭两首歌曲 | 全部 | 恰好两个 `task_ids`；可传平行数组 `audio_indexes` |
| `sample` | 音频采样创作 | 全部 | 音轨来源；必填 `start_s` / `end_s`，支持小数秒 |
| `midi` | 生成 MIDI | 无 | 音轨来源 |
| `alignedLyrics` | 获取时间对齐歌词 | 无 | 音轨来源 |
| `bpm` | 分析 BPM | 无 | 音轨来源 |
| `generateMp4` | 生成歌曲视频 | 无 | 音轨来源 |
| `download` | 下载音频文件 | 无 | 音轨来源；必填 `formats` 或 `format`，支持 MP3 / M4A / WAV |

旧 `/generations/wav` 路由不对外提供；统一使用 `/generations/download`。

## 请求模式与校验

请求必须为 JSON，仅接受对应操作声明的字段；未知字段、错误类型和不支持的版本会被拒绝。

### 灵感与自定义模式

- 基础生成：`custom=false` 或省略时，`prompt` 是必填的灵感描述；`custom=true` 时，`prompt` 是歌词，只有 `instrumental=true` 才允许省略。
- 基础生成的 `title`、`style`、`negative_tags`、`auto_lyrics`、Persona 和权重参数仅在自定义模式生效；错误模式下会被移除。`vocal_gender` 两种模式均可用。
- `coverSong`、`addVocals`、`addInstrumental`、`addStem`、`mashup`、`sample` 未传 `custom` 时，依次按非空 `prompt` → 自定义、非空 `gpt_description` → 灵感、非空 `tags` / `title` → 自定义推断；否则按灵感模式处理，并要求 `gpt_description`。
- `extend` 不强制传 `custom` 或灵感描述；自定义续写使用 `prompt`，灵感续写使用 `gpt_description`。
- 后续创作的自定义模式会移除 `gpt_description`；灵感模式会移除只在自定义模式生效的字段。

具体可用字段以对应操作为准，不是所有操作都支持同一组创作参数。

### 数值及资源边界

- `style_weight`、`weirdness_constraint`、`audio_weight` 为有限数值，范围 `0–1`，显式 `0` 会保留。支持 `weirdness` 别名的操作会将它归一到 `weirdness_constraint`；同时传入冲突值会被拒绝。
- 布尔字段必须是 JSON 布尔值，不能用字符串 `"false"`；显式 `false` 会保留。
- 时间参数的插件安全上限为 `3600` 秒；除 `sample` 的起止时间外，时间参数要求整数。片段终点必须大于起点；来源结果提供有效时长时，还会检查所请求的终点、续写位置或淡入淡出时长是否超出该音轨时长。
- `audio_index` 为 1-based 整数，插件上限为 `64`，还必须不超过源任务实际歌曲数量。
- `speed` 范围为 `0.25–4`；音效 `bpm` 范围为整数 `1–300`；音效调性使用升号写法，例如 `C#` / `C#m`，不接受 `Db`。
- `formats` 支持大小写归一、去重并保留顺序；最多接受 64 个输入项，归一后只有 `mp3` / `m4a` / `wav` 三种格式。不能与 `format` 同时使用。
- 输入媒体地址要求 HTTP(S) URL，不接受 URL 内嵌用户名或密码。`createVoice` 不根据 URL 扩展名猜测媒体格式，允许无扩展名的媒体直链。

这些插件安全上限不等于 Suno 模型的最大输出时长或供应商承诺。

## 公共任务与资源引用

所有客户端来源引用必须使用 **New API 返回的公共任务 ID**，不是供应商任务 ID：

- 单曲来源：`task_id` + `audio_index`，序号省略时取第 1 首。
- 双曲混搭：`task_ids` + `audio_indexes`，省略序号时都取第 1 首；允许引用同一任务的两首不同歌曲。
- Persona 风格：在自定义 `generation` / `extend` / `coverSong` / `mashup` 中传 `persona_task_id`，指向已完成的 `persona` 任务。
- 创建 Persona 时引用 Vox：传 `vox_task_id`，指向已完成的 `vox` 任务；若该结果含原始截取区间，插件会沿用并拒绝与它冲突的区间。未返回的区间不会被凭空补齐。

宿主检查当前用户归属、插件归属、来源渠道一致性及渠道可用性，并固定来源渠道；插件再检查完成状态、操作类型及歌曲索引。`addVocals` / `addInstrumental` 不能把普通生成任务当作上传任务使用，`concat` 不能使用非续写来源。

不要向客户端暴露或要求客户端提交 `persona_id`、`vox_audio_id` 等供应商私有资源 ID。插件在服务端从已解析的来源结果中取出它们。`createVoice` 是独立的 URL 输入接口，不能用它替代 `vox_task_id` 来源。

## 调用示例

以下请求体使用虚构内容。将请求发到自己的 New API 网关，并使用网关令牌；示例公共任务 ID 必须替换为真实提交响应中的 ID。

### 生成歌曲

`POST /apimart/suno/v1/generations`：

```json
{
  "model": "suno-am",
  "version": "v5",
  "custom": true,
  "instrumental": false,
  "prompt": "[Verse]\nRain taps softly on the glass",
  "style": "lo-fi piano",
  "style_weight": 0,
  "auto_lyrics": false
}
```

提交响应使用公共任务 ID：

```json
{
  "code": 200,
  "data": [{ "status": "submitted", "task_id": "task_public_song" }]
}
```

### 续写第 2 首歌曲

`POST /apimart/suno/v1/generations/extend`：

```json
{
  "task_id": "task_public_song",
  "audio_index": 2,
  "version": "v5",
  "continue_at": 60,
  "custom": false,
  "gpt_description": "finish with a quiet piano outro"
}
```

源任务必须已完成，第 2 首歌曲必须存在且时长允许从第 60 秒续写。

### 一次下载三种格式

`POST /apimart/suno/v1/generations/download`：

```json
{
  "task_id": "task_public_song",
  "audio_index": 2,
  "formats": ["mp3", "m4a", "wav"]
}
```

返回的是**新建下载任务**的公共 ID，后续应查询该下载任务，而不是继续查询源歌曲。一次请求只收取一次下载操作费用；再次提交相同歌曲、相同格式仍是一次新的收费操作。

## 查询、结果与产物

客户端查询 `GET /apimart/suno/v1/tasks/:task_id`，读取 `status`、数值型 `progress` 和 `data.result` / `data.error`。

- 正常状态为 `submitted` → `pending` → `completed` / `failed`。终态进度为 `100`。
- 插件支持上游概览文档的顶层状态结构，以及下载文档的 `code/data` 嵌套状态结构。
- HTTP 查询失败或上游查询错误不会被直接归一为任务失败，避免将暂时不可查询误判为应退款的终态。
- 音乐结果保留 `music[]` 中的多首歌曲，不只取第一首；标题、歌词、时长、封面、视频和有效媒体 URL 可返回客户端。
- 下载结果读取 `result.files[]`。上游可能附带旧 `wavUrl`；同一 WAV 文件不会在宿主产物列表中重复出现。
- 文本标签、时间对齐歌词、BPM、Persona/音色的非私有元数据会保留；私有资源 ID、费用和敏感字段会从原生查询结果中移除。
- 宿主产物接口支持音频、图片、视频、MIDI 和压缩包等产物，内容请求使用无渠道凭证的 GET/HEAD。临时媒体 URL 可能过期，应及时下载到自己的存储。

供应商建议普通音乐任务每 3–5 秒查询一次，常见耗时为 30–120 秒，不是完成时限保证。`upsampleTags` 文档称结果立即可用，但仍声明提交返回 `task_id` 并可查询；本插件统一使用该任务接口，不另造同步响应协议。

当前文档没有提供可接入的取消或回调端点，本插件不声明这些能力。

## 计费

插件不内置用户售价，不自动安装或覆盖管理员定价。任务用量字段为：

| 字段 | 类型 / 单位 | 含义 |
| --- | --- | --- |
| `requests` | number / count | 每次操作固定为 `1`，不按输出歌曲数或文件格式数增加 |
| `action` | enum | 上述 31 个 action，包括基础生成的 `generation` |
| `version` | enum | 已验证并归一的 Suno 版本，无版本操作为 `none` |

表达式读取 `u("字段")`，结果是**单次请求的美元金额，不除以一百万**。宿主处理预扣、结算、分组倍率及失败退款；成功完成时保留一次请求的用量。上游的 `cost` / `credits_cost` 不是可信的用户扣费输入，不用于覆盖用量。

### 公开价格快照

以下为 **2026-09-09** 查询[供应商公开定价接口](https://api.apib.ai/api/pricing/model?model=suno)得到的 USD/请求价格，不代表已安装的网关售价。该接口的 `billing_type` 为 `suno_action`；同一操作的已列出版本当前价格相同。

| 插件 action | USD/请求 |
| --- | ---: |
| `generation`、`extend`、`coverSong`、`remaster`、`addVocals`、`addInstrumental`、`addStem`、`replaceMusic`、`mashup`、`sample`、`midi` | 0.0625 |
| `inspo` | 0.085 |
| `sounds` | 0.012 |
| `lyrics`、`crop`、`removeSection`、`fadeIn`、`fadeOut` | 0.01 |
| `adjustSpeed` | 0.03 |
| `stems` | 0.125 |
| `stemsAll` | 0.3 |
| `createVoice` | 0.02 |
| `alignedLyrics`、`bpm` | 0.001 |
| `upsampleTags`、`uploadTask`、`vox`、`persona`、`concat`、`generateMp4` | 0.005 |
| `download` | 0.002 |

供应商价格键不总是等于插件 action，例如 `generation` 对应 `suno@music`、`coverSong` 对应 `suno@cover`、`replaceMusic` 对应 `suno@replace_section`、`generateMp4` 对应 `suno@generate_video`。

接口同时返回 `discount_percent: 20` 和 `discount_rate: 1`，含义不能据此一致确定；本插件不自动应用折扣。上线前应重新核对账户实际价格、利润和分组策略，并保留已有管理员覆盖。

### 完整表达式示例

如需按上述公开快照设置网关基础售价，在 **`suno-am`** 的任务定价中使用下列表达式。它覆盖当前全部操作，每个分支都有 `tier()`；最后分支为基础生成。此示例不会自动写入后台。

```text
u("action") == "lyrics" ? tier("lyrics", u("requests") * 0.01) :
u("action") == "inspo" ? tier("inspo", u("requests") * 0.085) :
u("action") == "sounds" ? tier("sounds", u("requests") * 0.012) :
u("action") == "upsampleTags" ? tier("upsampleTags", u("requests") * 0.005) :
u("action") == "uploadTask" ? tier("uploadTask", u("requests") * 0.005) :
u("action") == "extend" ? tier("extend", u("requests") * 0.0625) :
u("action") == "coverSong" ? tier("coverSong", u("requests") * 0.0625) :
u("action") == "remaster" ? tier("remaster", u("requests") * 0.0625) :
u("action") == "stems" ? tier("stems", u("requests") * 0.125) :
u("action") == "stemsAll" ? tier("stemsAll", u("requests") * 0.3) :
u("action") == "addVocals" ? tier("addVocals", u("requests") * 0.0625) :
u("action") == "addInstrumental" ? tier("addInstrumental", u("requests") * 0.0625) :
u("action") == "addStem" ? tier("addStem", u("requests") * 0.0625) :
u("action") == "vox" ? tier("vox", u("requests") * 0.005) :
u("action") == "createVoice" ? tier("createVoice", u("requests") * 0.02) :
u("action") == "persona" ? tier("persona", u("requests") * 0.005) :
u("action") == "replaceMusic" ? tier("replaceMusic", u("requests") * 0.0625) :
u("action") == "removeSection" ? tier("removeSection", u("requests") * 0.01) :
u("action") == "crop" ? tier("crop", u("requests") * 0.01) :
u("action") == "fadeIn" ? tier("fadeIn", u("requests") * 0.01) :
u("action") == "fadeOut" ? tier("fadeOut", u("requests") * 0.01) :
u("action") == "adjustSpeed" ? tier("adjustSpeed", u("requests") * 0.03) :
u("action") == "concat" ? tier("concat", u("requests") * 0.005) :
u("action") == "mashup" ? tier("mashup", u("requests") * 0.0625) :
u("action") == "sample" ? tier("sample", u("requests") * 0.0625) :
u("action") == "midi" ? tier("midi", u("requests") * 0.0625) :
u("action") == "alignedLyrics" ? tier("alignedLyrics", u("requests") * 0.001) :
u("action") == "bpm" ? tier("bpm", u("requests") * 0.001) :
u("action") == "generateMp4" ? tier("generateMp4", u("requests") * 0.005) :
u("action") == "download" ? tier("download", u("requests") * 0.002) :
tier("generation", u("requests") * 0.0625)
```

如果以后操作价格按版本分化，使用 `u("action") == "generation" && u("version") == "v5.5"` 这样的条件细分，并为其余支持组合保留明确价格。增加新操作时也必须同步更新完整表达式，不能让新操作无意落入基础生成价格。

## 本地校验与验证范围

从仓库根目录执行：

```bash
go run . plugin lint plugins/local/apimart-suno/plugin.js
go run . plugin test plugins/local/apimart-suno/plugin.js --fixture plugins/local/apimart-suno/apimart-suno.fixture.json
go test ./middleware -run 'TestApplyOriginTask' -count=1
```

当前实现已通过插件 lint、100 条契约 fixtures 及宿主源任务回归。本地 HTTP 上游配合真实 Go adaptor 的烟测覆盖了提交、轮询、双歌曲公共结果、第二首来源解析、三格式下载、用量计费、暂时查询错误与失败状态，以及混合媒体产物访问。

这些是本地契约验证，不是供应商线上验证：未部署、未调用真实收费接口，也未验证真实账户的端点可用性、所有资源结果字段或实际账单。Persona/Vox 等特殊资源响应仍需上线前联调确认。插件不自行修改核心服务、数据库结构或钱包逻辑。

不要把真实 API Key、用户提示词、供应商私有资源 ID、私人媒体 URL 或实际业务数据写入插件、fixture、文档和提交记录。修改插件行为时递增版本，不覆盖已上传版本的源码；部署与激活遵循测试服务器部署流程。

## 参考资料

- [Suno 通用约定与任务查询](https://docs.apib.ai/cn/api-reference/audios/suno/overview)
- [基础生成](https://docs.apib.ai/cn/api-reference/audios/suno/generation)
- [上传音频](https://docs.apib.ai/cn/api-reference/audios/suno/upload)
- [Persona](https://docs.apib.ai/cn/api-reference/audios/suno/persona)
- [Vox](https://docs.apib.ai/cn/api-reference/audios/suno/vox)
- [下载音频（文档仍使用 wav 页面地址）](https://docs.apib.ai/cn/api-reference/audios/suno/wav)
- [公开定价接口](https://api.apib.ai/api/pricing/model?model=suno)
- [本地定制治理](../../../docs/architecture/local-customization-governance.md)
- [任务计费表达式](../../../pkg/billingexpr/expr.md)

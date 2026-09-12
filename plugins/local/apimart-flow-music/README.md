# AM Flow Music 任务插件

本地插件键为 `am-flow-music`，版本为 `0.2.0`，对外模型为 `flowmusic-am`，上游模型固定为 `flowmusic`。插件通过 AM 提供 Flow Music 与 Lyria 3.5 音乐任务。

本插件独立于 APIMart 图片插件、APIMart Suno 插件及内置音频渠道。虽然使用相同的上游音乐 API 前缀，但请求字段、操作后缀、源音轨标识及结果结构不同，不能只替换 Suno 插件的模型名。

## 文件与安装

- `plugin.js`：上传到任务插件管理页面的源码。
- `apimart-flow-music.fixture.json`：本地契约验证数据，不需要上传。

在任务插件管理页面上传源码并激活对应版本，然后创建或配置渠道：

| 配置项 | 值 |
| --- | --- |
| 渠道类型 | Task Plugin |
| 插件键 | `apimart-flow-music` |
| 对外模型 | `flowmusic-am` |
| 上游基础地址 | `https://api.apib.ai` 或 `https://api.apimart.ai` |
| 模型映射 | 留空，或 `flowmusic-am` → `flowmusic` |
| 渠道密钥 | 供应商 API Key，仅存放在渠道配置中 |

基础地址不要附加 `/v1/music`。客户端使用 New API 令牌请求网关，不使用供应商渠道密钥。原生路由已由插件声明，不需要额外配置普通 OpenAI 音频或图片端点。

插件不自动安装模型售价。启用收费请求前，必须为 `flowmusic-am` 配置下文的任务计费表达式，并检查模型分组及分组倍率。

## 操作与原生路由

所有提交请求都是 JSON，所有操作均为异步任务。公共提交前缀为：

```text
POST /am/flow-music/v1/generations
```

下表中的后缀追加到该前缀；上游对应前缀为 `/v1/music/generations`，后缀保持相同。计费用的 `action` 与 URL 后缀不一定相同。

| 计费 action | 路由后缀 | 功能 | 必填参数 | 支持 `version` |
| --- | --- | --- | --- | --- |
| `generate` | 无后缀 | 生成一首音乐 | `sound_prompt`、`lyrics` 至少一个非空 | 是 |
| `lyrics` | `/lyricsFlowMusic` | 生成歌词 | `prompt` | 否 |
| `extend` | `/extendFlowMusic` | 从指定位置续写 | 来源、`extend_from_s`、`extend_s`、`instruction` | 是 |
| `replace` | `/replaceFlowMusic` | 替换指定片段，输出整首新音频 | 来源、`start_s`、`end_s`、`instruction` | 是 |
| `cover` | `/coverFlowMusic` | 整曲改编 | 来源、`instruction`、`strength` | 是 |
| `stems` | `/stemsFlowMusic` | 分离音轨，返回 ZIP 包 | 来源 | 否 |
| `upload_audio` | `/uploadAudioFlowMusic` | 导入外部音频 | `audio_url` | 否 |
| `download_audio` | `/downloadAudioFlowMusic` | 转出 MP3/WAV 文件 | 来源、`format` | 否 |
| `video_clip` | `/videoClipFlowMusic` | 按模板渲染音乐视频 | 来源 | 否 |

公共查询路由为：

```text
GET /am/flow-music/v1/tasks/:task_id
```

不要为基础生成追加 `/generate`，也不要用计费 action 替代上表中的大小写敏感后缀。

### 模型版本

仅 `generate`、`extend`、`replace`、`cover` 接受可选的 `version`：

- 省略：使用供应商默认版本；插件不自动补成 Lyria。
- 显式传 `"lyria-3.5"`：使用 Lyria 3.5。
- 其他值会被拒绝。

客户端 `model` 可省略或填写 `flowmusic-am`。不要将 `model` 改成 `lyria-3.5`；插件始终向上游发送 `model: "flowmusic"`。

同一动作的已列版本价格相同，`version` 仅用于请求选择，不在计费 `usageSchema` 中。可视化定价只有 9 个动作价格项，不展开动作与版本的组合。

### 来源任务与音轨

上表中的“来源”指：

- `task_id`：当前用户可访问的、已成功的本插件公开任务 ID。
- `audio_index`：可选，从 **1** 开始，缺省为 `1`，必须指向来源结果中实际存在的音轨。

客户端不得直接提交供应商 `clip_id`、私有上游任务 ID 或伪造的 `originTasks`。New API 宿主负责来源归属、插件及渠道边界检查，再将可信来源交给插件。插件从选中音轨的内部结果读取 `clip_id`，仅在上游请求中使用。

外部音频先通过 `upload_audio` 导入，等待成功后，再以该公开任务 ID 做续写、替换、改编等操作。已有兼容来源任务可以直接引用，无需重复上传。Suno 的来源任务不能直接作为 Flow Music 来源。

续写、替换与改编会生成新的音轨。继续编辑时应使用新任务的公开 ID，而不是继续引用旧任务。

### 参数校验

- `generate`：支持 `sound_prompt`、`lyrics`、`title`、`bpm`、`length`、`seed`。`length` 为 `1–240` 的整数秒；`bpm` 必须是数值字符串，例如 `"120"`，数值至少为 `1`。
- `lyrics`：`prompt` 必须非空，最多 3000 字符。
- `extend`：`extend_from_s` 非负；`extend_s` 大于 `0` 且最多 `164` 秒；可选 `title`、`seed`。
- `replace`：`start_s` 非负，`end_s > start_s`；可选 `title`、`seed`。
- `cover`：`strength` 在 `0–1` 之间，显式 `0` 会保留；可选 `title`、`seed`。
- `replace` 的 `seed` 是整数，其他支持种子的操作使用字符串。数值 `0` 和字符串 `"0"` 不会被当成缺省值丢弃。
- `upload_audio`：`audio_url` 必须为无内嵌用户名密码的 HTTP(S) 地址，文件需公网可访问。供应商要求常见音频后缀，例如 `.mp3`、`.wav`；插件不根据签名 URL 猜测文件内容或额外限制格式。
- `download_audio`：`format` 必须为 `mp3` 或 `wav`，一次请求选择一种格式。
- `video_clip`：`preset` 可选 `simple`、`modern`、`player`，缺省为 `simple`。

来源结果包含有效的 `duration_seconds` 时，续写起点和替换终点还会检查不能超过该时长。上传结果可能不包含时长，此时插件执行本地范围校验，供应商继续负责实际媒体边界检查。

插件另设保守安全上限，并非供应商宣称的能力范围：普通文本最多 65536 字符，来源时间点最多 3600 秒，音轨索引及输出音轨最多 64 项，URL 最多 8192 字符，整数种子必须处于 JavaScript 安全整数范围。仅接受各操作声明的字段，未知字段及错误类型会被拒绝。

## 调用示例

以下为请求体示例，所有文本、任务 ID 和媒体地址均为虚构数据，不可作为真实来源直接运行。

### 生成 Lyria 3.5 音乐

请求 `POST /am/flow-music/v1/generations`：

```json
{
  "model": "flowmusic-am",
  "version": "lyria-3.5",
  "title": "Piano Study",
  "sound_prompt": "gentle piano with a steady rhythm",
  "bpm": "120",
  "length": 60,
  "seed": "0"
}
```

使用默认版本时，删除 `version` 字段即可。

### 导入外部音频

请求 `POST /am/flow-music/v1/generations/uploadAudioFlowMusic`：

```json
{
  "model": "flowmusic-am",
  "audio_url": "https://media.example.test/input.wav"
}
```

### 改编已成功的来源音频

请求 `POST /am/flow-music/v1/generations/coverFlowMusic`：

```json
{
  "model": "flowmusic-am",
  "task_id": "task_public_upload_example",
  "audio_index": 1,
  "version": "lyria-3.5",
  "instruction": "change the arrangement to acoustic jazz",
  "strength": 0.5
}
```

### 下载 WAV

请求 `POST /am/flow-music/v1/generations/downloadAudioFlowMusic`：

```json
{
  "model": "flowmusic-am",
  "task_id": "task_public_music_example",
  "audio_index": 1,
  "format": "wav"
}
```

## 提交、查询与产物

提交成功后，公开任务 ID 位于 `data[0].task_id`：

```json
{
  "code": 200,
  "data": [
    {
      "status": "submitted",
      "task_id": "task_public_music_example"
    }
  ]
}
```

使用该 ID 查询公共路由。查询状态为 `pending`、`processing`、`completed` 或 `failed`。查询返回的公开任务 ID 位于 **`data.id`**，与提交响应的字段位置不同。

- 音乐及其他媒体结果：`data.result.music`。
- 歌词结果：`data.result.lyrics`。
- 常见媒体字段：`audio_url`、`wav_url`、`image_url`、`video_url`、`file_url`。
- `stems` 的 `file_url` 为 ZIP 包，不是可直接播放的音频。
- `duration_seconds` 在供应商结果中可能是字符串，客户端不能假设始终是数值。

公开结果保留歌词、时间标记、媒体地址及制作元数据，但移除私有 `clip_id`、`lyrics_id`、上游任务 ID、敏感字段和上游成本。后续操作通过公开来源任务引用，不依赖这些私有字段。

插件同时实现宿主产物接口，支持音频、图片、视频和文件的 GET/HEAD 访问。产物请求不携带供应商凭据；目标地址仍接受宿主安全校验。歌词任务没有下载产物，未成功的任务不会暴露产物。

未知状态及查询接口的 HTTP/API 错误不会直接伪装成任务失败，避免错误触发退款。真实 `failed` 状态交由宿主处理失败和退款。没有已文档化、可接入的取消或回调接口，因此本插件不声明这些能力。上游轮询使用默认查询语言，不提供按单次公开查询切换上游语言的功能。

## 计费配置

插件不内置或覆盖管理员售价。计费用量只包含：

| 字段 | 类型 / 单位 | 含义 |
| --- | --- | --- |
| `requests` | number / count | 调用次数，每个任务固定为 `1` |
| `action` | enum | 上表中的 9 个计费动作 |

`requests` 不是用户填写的数量，也不是累计调用次数。一次上传后再改编是两个独立任务，各按对应动作计费一次。

以下采用用户于 **2026-09-10** 提供的折后美元价，不是插件自动安装的网关售价：

| action | USD/次 |
| --- | ---: |
| `generate` | 0.06 |
| `lyrics` | 0.02 |
| `extend` | 0.06 |
| `replace` | 0.06 |
| `cover` | 0.06 |
| `stems` | 0.06 |
| `upload_audio` | 0.01 |
| `download_audio` | 0.02 |
| `video_clip` | 0.02 |

为 `flowmusic-am` 配置完整任务表达式：

```text
u("action") == "lyrics" ? tier("lyrics", u("requests") * 0.02) :
u("action") == "extend" ? tier("extend", u("requests") * 0.06) :
u("action") == "replace" ? tier("replace", u("requests") * 0.06) :
u("action") == "cover" ? tier("cover", u("requests") * 0.06) :
u("action") == "stems" ? tier("stems", u("requests") * 0.06) :
u("action") == "upload_audio" ? tier("upload_audio", u("requests") * 0.01) :
u("action") == "download_audio" ? tier("download_audio", u("requests") * 0.02) :
u("action") == "video_clip" ? tier("video_clip", u("requests") * 0.02) :
tier("generate", u("requests") * 0.06)
```

表达式返回单次任务美元金额：**不要除以一百万，也不要再乘一次 0.8**。所有已支持的非生成动作都已显式列出，最后一档用于基础生成；增加新动作时必须同步补充其价格。

宿主负责安全额度转换、预扣、分组倍率、结算和失败退款。插件忽略供应商结果中的 `cost`、`credits_cost`，不把这些不可信值直接作为用户扣费依据。成功完成时保留 `requests = 1`，不按音频格式或产物数量增加收费。

## 本地验证

从 New API 仓库根目录执行：

```bash
go run . plugin lint plugins/local/apimart-flow-music/plugin.js
go run . plugin test plugins/local/apimart-flow-music/plugin.js --fixture plugins/local/apimart-flow-music/apimart-flow-music.fixture.json
go test ./middleware -run 'TestApplyOriginTask' -count=1
```

`0.1.0` 交付时已验证：

- 插件 lint、98/98 契约 fixtures、JavaScript lint 与格式检查通过。
- 真实 Go adaptor 配合本地模拟上游，覆盖 9 个动作的提交、查询及基于用量事实的额度计算；完成阶段上游成本不改变已配置价格。
- 3 个无来源操作经过完整原生路由准备中间件；来源权限使用已有宿主回归验证。
- 40 次本地媒体 GET/HEAD 请求通过，未携带供应商凭据。
- 实际前端矩阵解析生成 9 个动作价格项，无版本维度。

Go adaptor 集成验证使用一次性本地 smoke 程序，完成后已删除；持久保留的回归数据为同目录 fixture 文件。上述结果不能代替真实供应商联调，也不证明已完成线上钱包扣款或退款验证。

当前未通过本次插件开发执行上传、激活、部署或真实收费请求。不得把真实 API Key、用户提示词、私有素材地址、签名链接或实际业务数据写入源码、fixture、README 和提交记录。

修改插件行为时递增版本，不覆盖已上传版本的源码。上传和激活应遵循测试服务器部署流程，并在获得授权后执行。

## 参考资料

以下均为 APIMart/APIB 的上游 API 文档，不是 Google Lyria 第一方 API 契约：

- [生成音乐](https://docs.apib.ai/cn/api-reference/audios/flow-music/music)
- [Lyria 3.5 生成音乐](https://docs.apib.ai/cn/api-reference/audios/flow-music/music-lyria-3-5)
- [生成歌词](https://docs.apib.ai/cn/api-reference/audios/flow-music/lyrics)
- [音乐延伸](https://docs.apib.ai/cn/api-reference/audios/flow-music/extend)
- [Lyria 3.5 音乐延伸](https://docs.apib.ai/cn/api-reference/audios/flow-music/extend-lyria-3-5)
- [片段替换](https://docs.apib.ai/cn/api-reference/audios/flow-music/replace)
- [Lyria 3.5 片段替换](https://docs.apib.ai/cn/api-reference/audios/flow-music/replace-lyria-3-5)
- [Cover 改编](https://docs.apib.ai/cn/api-reference/audios/flow-music/cover)
- [Lyria 3.5 Cover 改编](https://docs.apib.ai/cn/api-reference/audios/flow-music/cover-lyria-3-5)
- [词曲分离](https://docs.apib.ai/cn/api-reference/audios/flow-music/stems)
- [上传音频](https://docs.apib.ai/cn/api-reference/audios/flow-music/upload-audio)
- [下载音频](https://docs.apib.ai/cn/api-reference/audios/flow-music/download-audio)
- [音乐视频渲染](https://docs.apib.ai/cn/api-reference/audios/flow-music/video-clip)
- [查询任务](https://docs.apib.ai/cn/api-reference/audios/flow-music/query)
- [本地定制治理](../../../docs/architecture/local-customization-governance.md)
- [任务计费表达式](../../../pkg/billingexpr/expr.md)

# APIMart 异步图片任务插件

这是一个本地、可上传的 Task Plugin；不进入 `plugins/tasks/`，因此不会改动或覆盖上游内置插件。

当前源码版本：`0.8.15`。本次在现有 Nano Banana `ext` 按张模型之外增加四个非 `ext` 实际 Credits 结算模型；未部署、上传或激活插件，也未修改管理员已有定价。

## 对外接口

插件创建以下鉴权后的原生任务接口：

```text
POST /apimart/v1/images/generations
GET  /apimart/v1/tasks/{task_id}
```

创建接口接收 APIMart 的图片请求字段，例如 `model`、`prompt`、`image_urls`、`size`、`resolution`、`quality`、`n`。它立即返回 New API 的公共 `task_id`。查询接口使用这个公共 ID，永不暴露上游 `task_id`。

插件将请求提交到 APIMart 的 `/v1/images/generations`，并轮询 `/v1/tasks/{upstream_task_id}`。完成后的图片 URL 可从查询结果的 `data.result.images[*].url[*]` 获取，也会作为 New API 的任务产物提供。

## 支持范围

插件的异步图片别名全部经由 `https://api.apib.ai/v1/images/generations` 提交，查询经由 `/v1/tasks/{upstream_task_id}`。对外永远只返回 New API 公共 `task_id` 和包装后的查询结果；上游任务 ID、Bearer Token 均不进入响应。

| 网关别名 | 配置的上游模型 | 已验证字段契约 |
| --- | --- | --- |
| `seedream-5-0-lite-am` | `seedream-5-0-lite` | `prompt`、比例或 `auto`、`resolution` `2K/3K/4K`、`n` `1..15`，并强制 `image_urls.length + n ≤ 15`；`image_urls`、`output_format` `jpeg/png`、`watermark`。 |
| `seedream-5-0-pro-am` | `seedream-5-0-pro` | 固定 `n=1`、最多 10 个 `image_urls`、`resolution` `1K/1.5K/2K`、比例/`auto` 或合法像素尺寸、`output_format` `jpeg/png`；透明背景要求单输入图和 PNG，分层要求单图和 `auto/1K/1.5K/2K`。 |
| `z-image-turbo-am` | `z-image-turbo` | 固定一张，`prompt` 最多 800 字符，7 个文档比例、`resolution` `1K/2K`、`prompt_extend`。 |
| `nano-banana-ext-am` | `gemini-2.5-flash-image-preview` | 固定 `n=1`、`resolution=1k`，`prompt` 最多 1000 字符，最多 14 张参考图。 |
| `nano-banana-2-ext-am` | `gemini-3.1-flash-image-preview` | 固定 `n=1`，`resolution` `0.5k/1k/2k/4k`，支持极端比例，最多 14 张参考图。 |
| `nano-banana-pro-ext-am` | `gemini-3-pro-image-preview` | 固定 `n=1`，`resolution` `1k/2k/4k`，最多 14 张参考图。 |
| `nano-banana-2-lite-ext-am` | `gemini-3.1-flash-lite-image-ext` | `n` `1..4`，仅输出 `1k`；请求 `0.5k/2k/4k` 也归一为 `1k`，最多 14 张参考图。 |
| `nano-banana-am` | `gemini-2.5-flash-image-preview-official` | 与对应 `ext` 模型相同的请求规格；按任务实际 Credits 结算。 |
| `nano-banana-2-am` | `gemini-3.1-flash-image-preview-official` | 与对应 `ext` 模型相同的请求规格；按任务实际 Credits 结算。 |
| `nano-banana-pro-am` | `gemini-3-pro-image-preview-official` | 与对应 `ext` 模型相同的请求规格；按任务实际 Credits 结算。 |
| `nano-banana-2-lite-am` | `gemini-3.1-flash-lite-image` | 与对应 `ext` 模型相同的请求规格；`n` `1..4`，分辨率归一为 `1k`，按任务实际 Credits 结算。 |

每个新增别名执行严格模型级字段白名单，不支持的字段不会静默透传。Seedream 和 Z Image Turbo 仍拒绝 `nsfw_check` 等表外字段；`gpt-image-2-am` 和 `gpt-image-2-official-am` 保持已有兼容契约。

八个 Nano Banana 别名使用 `model`、`prompt`、`n`、`size`、`resolution`、可选 `image_urls`：提示词去除首尾空白，缺省规格固定为 `n=1`、`size="1:1"`、`resolution="1k"`，分辨率统一小写。`n` 必须是数字整数，不能用字符串。通用比例为 `auto`、`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`；只有 Nano Banana 2（含 `ext` 和非 `ext`）额外支持 `1:4`、`4:1`、`1:8`、`8:1`，不支持任意像素尺寸。

Nano Banana 的 `nsfw_check`、`google_search`、`google_image_search` 仅允许省略或显式 `false`（保留传入的 `false`）；`true` 和非布尔值均拒绝。`ext` 的 `official_fallback` 同样只允许省略或 `false`；非 `ext` 的 `official_fallback` 完全不支持，任何传值（包括 `false` 或 `null`）均拒绝。这些收费或未支持选项没有启用，避免额外审核、官方兜底和搜索改变计费契约。`metadata`、`extra`、`mask_url`、`webhook` 等白名单外字段同样拒绝。

## 上传与校验

```bash
go run . plugin lint plugins/local/apimart/plugin.js
go run . plugin test plugins/local/apimart/plugin.js --fixture plugins/local/apimart/apimart.fixture.json
```

在 New API 的“任务插件”页面上传 `plugin.js` 后，创建类型为 `Task Plugin` 的渠道：

```text
插件键：apimart
基础地址：https://api.apib.ai
密钥：APIMart Bearer Token
模型映射：gpt-image-2-am → gpt-image-2
```

新增模型映射：

```text
seedream-5-0-lite-am → seedream-5-0-lite
seedream-5-0-pro-am  → seedream-5-0-pro
z-image-turbo-am     → z-image-turbo
nano-banana-ext-am        → gemini-2.5-flash-image-preview
nano-banana-2-ext-am      → gemini-3.1-flash-image-preview
nano-banana-pro-ext-am    → gemini-3-pro-image-preview
nano-banana-2-lite-ext-am → gemini-3.1-flash-lite-image-ext
nano-banana-am             → gemini-2.5-flash-image-preview-official
nano-banana-2-am           → gemini-3.1-flash-image-preview-official
nano-banana-pro-am         → gemini-3-pro-image-preview-official
nano-banana-2-lite-am      → gemini-3.1-flash-lite-image
```

每个 Nano Banana 模型也允许映射到对应供应商别名（即公共别名去掉 `-am`）；未配置映射或宿主传入与公共别名相同的 `upstreamModel` 时自动采用上表 canonical 名称。映射必须与公共别名一一对应：`ext` 不能映射到官方/非 `ext` 模型，非 `ext` 也不能映射到 `ext` 或其他 Nano Banana 型号。非 `ext` 的不匹配映射报错为 `upstream model must match the Nano Banana credit alias`。

不要把真实 token 放进插件源码、fixtures 或 Git。

## 计费与素材保存

为每个渠道模型在 New API 中配置自己的定价。`gpt-image-2-am` 向表达式提供以下已校验的任务计费用量：

- `u("images")`：固定为 `1`；APIMart GPT-Image-2 每个任务只允许生成一张图；
- `u("resolution")`：`default`、`1k`、`2k`、`4k`。未提供或无法识别时为 `default`。
- `u("input_images")`：参考图和遮罩图数量，没有输入图时为 `0`。

`gpt-image-2-official-am` 只提供 `u("upstream_credits")`：提交时预估，完成后由上游 `credits_cost` 覆盖。

三项新增别名需要在渠道模型定价中配置表达式。`seedream-5-0-pro-am` 使用 `u("resolution")`（`1k`、`1.5k`、`2k`）作为矩阵行，`u("standard_images")` 和 `u("layer_images")` 作为输出价格列：

| `resolution` | `standard_images` | `layer_images` | `reference_images` |
| --- | --- | --- | --- |
| `1k` | 标准 1K：1 | 图层 1K：预扣 17、按完成 URL 数结算 | 输入参考图总数 |
| `1.5k` | 标准 1.5K：1 | 图层 1.5K：预扣 17、按完成 URL 数结算；单价与图层 1K 相同 | 输入参考图总数 |
| `2k` | 标准 2K：1 | 图层 2K：预扣 17、按完成 URL 数结算 | 输入参考图总数 |

标准生成只产生 `standard_images=1`，并从 `image_urls` 提取 `reference_images=0..10`；图层拆分只产生 `layer_images=17` 且固定 `reference_images=1`。提交时插件会把这些已验证、非敏感的计费事实写入跨轮次 `PluginState`，轮询即使覆盖任务响应数据也能在完成时恢复图层档位。图层 `size="1.5k"` 的 billing UI 档位为 `resolution="1.5k"`，即使上游请求为遵守接口契约同时携带 `size="1.5k"` 与 `resolution="1k"` 也不改变该档位，`auto` 映射到 `resolution="2k"`。轮询将上游 `success` 和 `completed` 都映射为成功；图层完成时从 `result.images` 和可选 `result.layers` 的去重 URL 计数覆盖预扣 `layer_images`（最多 17），标准任务保持提交时的参考图总数；失败或取消时三个计数量均为零。

管理员可使用现有结构化矩阵配置此模型；`reference_images` 按输入参考图总数计费，第一张也收费，图层固定为 1，因此也产生一笔参考图费用。

Raw expression 的三个分支都用 `tier()` 包裹：

```text
u("resolution") == "1k"
  ? tier("1k", u("standard_images") * 0.02925 + u("layer_images") * 0.014625 + u("reference_images") * 0.00195)
  : u("resolution") == "1.5k"
    ? tier("1.5k", u("standard_images") * 0.02925 + u("layer_images") * 0.014625 + u("reference_images") * 0.00195)
    : tier("2k", u("standard_images") * 0.0585 + u("layer_images") * 0.02925 + u("reference_images") * 0.00195)
```

任务表达式输出单次请求的美元金额，不按百万 Token 或 credit 再转换。`seedream-5-0-lite-am` 继续提供 `u("images")`、`u("resolution")`（`2k/3k/4k`）、`u("input_images")`；`z-image-turbo-am` 继续提供 `u("images")`、`u("resolution")`（`1k/2k`）、`u("prompt_extend")`。

`gpt-image-2-am` 的当前上游成本可用下面的表达式配置：

```text
u("resolution") == "4k"
  ? tier("4k", u("images") * 0.021)
  : (u("resolution") == "2k"
    ? tier("2k", u("images") * 0.014)
    : (u("resolution") == "1k"
      ? tier("1k", u("images") * 0.0085)
      : tier("default", u("images") * 0.0085)))
```

这是每张图片的美元成本；任务表达式不会按百万 Token 换算。若要对外加价，直接将上述单价替换为目标售价即可。对于 `gpt-image-2-am`，APIMart 响应里的 `cost` 只用于上游对账，不作为用户扣费输入；Nano Banana 非 `ext` 的实际费用契约见下文。

`gpt-image-2-official-am` 使用上游完成任务返回的 `credits_cost` 结算。提交时插件按 `n`、`resolution`、`quality`、参考图和遮罩图数量预估并预扣；完成后以 `credits_cost` 覆盖预估值，失败时结算为零。页面展示低、中、高质量 × 1K、2K、4K 的完整九档预估价，最终仍以实际 `upstream_credits` 结算；因此定价档位会显示 `$0.1 / credit`，而不是把预估价误当成固定单价。配置渠道映射：

```text
gpt-image-2-official-am → gpt-image-2-official
```

模型定价选择“表达式”，填写：

```text
tier("upstream_actual", u("upstream_credits") * 0.1)
```

这表示 1 Credit = $0.1。若需加价，调整乘数，例如 20% 加价使用 `* 0.1 * 1.2`。页面应提示“预计费用基于所选规格计算；任务完成后按上游实际 Credits 结算，多退少补”。

### Nano Banana ext：按实际成功图片计费

上表四个 `ext` 模型继续按实际成功图片张数结算，与下文非 `ext` 的实际 Credits 契约隔离；它们不读取 `cost` 或 `credits_cost` 作为结算用量。

四个模型只提供 `u("images")` 和 `u("resolution")`：提交时按经过校验的请求张数预扣，并把这两项写入持久 `PluginState.billing_usage`。完成结算优先恢复已验证的持久状态，无状态时才回退到请求体；因此轮询上下文缺少请求体也不会丢失原始张数或分辨率。Lite 请求 `4k`、`n=4` 时，预扣事实是 `images=4`、`resolution="1k"`，实际成功两张则结算两张。

上游 `completed`/`success` 的 `result.images` 使用有效图片 URL 去重计数，且不能超过请求张数；明确的空数组结算零张。缺失、格式错误、非法 URL 或超出请求数量时不覆盖预扣事实，不能把不可信响应当成零成本。`failed`/`failure`/`cancelled`/`canceled` 结算零张，未完成状态不覆盖预扣值。该规则兼容 `data` 包装和未包装的任务响应。

以下美元单价来自用户提供的价格截图，已经包含折扣，不再乘第二次 `80%`。它们是所选 `ext` 渠道的每张成功输出图片价格，不是官方 token 单价：

| 公共别名 | `0.5k` | `1k` | `2k` | `4k` |
| --- | --- | --- | --- | --- |
| `nano-banana-ext-am` | 不支持 | $0.0125 | 不支持 | 不支持 |
| `nano-banana-2-ext-am` | $0.015 | $0.015 | $0.02 | $0.025 |
| `nano-banana-pro-ext-am` | 不支持 | $0.03 | $0.03 | $0.04 |
| `nano-banana-2-lite-ext-am` | 归一为 1k | $0.0125 | 归一为 1k | 归一为 1k |

管理员在各公共别名的模型定价中配置任务表达式；插件不硬编码这些价格，不覆盖已有定价。所有分支都使用 `tier()`，结果直接为本次任务的美元金额，不再除以一百万：

`nano-banana-ext-am` 和 `nano-banana-2-lite-ext-am` 分别配置：

```text
tier("1k", u("images") * 0.0125)
```

`nano-banana-2-ext-am`：

```text
u("resolution") == "4k"
  ? tier("4k", u("images") * 0.025)
  : u("resolution") == "2k"
    ? tier("2k", u("images") * 0.02)
    : u("resolution") == "0.5k"
      ? tier("0.5k", u("images") * 0.015)
      : tier("1k", u("images") * 0.015)
```

`nano-banana-pro-ext-am`：

```text
u("resolution") == "4k"
  ? tier("4k", u("images") * 0.04)
  : u("resolution") == "2k"
    ? tier("2k", u("images") * 0.03)
    : tier("1k", u("images") * 0.03)
```

字段与任务协议来源：[Nano Banana](https://docs.apib.ai/cn/api-reference/images/gemini-2.5-flash/generation)、[Nano Banana 2](https://docs.apib.ai/cn/api-reference/images/gemini-3.1-flash/generation)、[Nano Banana Pro](https://docs.apib.ai/cn/api-reference/images/gemini-3-pro/generation)、[Nano Banana Lite](https://docs.apib.ai/cn/api-reference/images/gemini-3.1-flash/generation-lite)、[任务状态](https://docs.apib.ai/cn/api-reference/tasks/status)。价格采用上述截图确认的 ext 渠道价格，不能从混合介绍官方/token 模式的文档推算替代。

### Nano Banana 非 ext：先预扣，完成后按实际 Credits 多退少补

四个非 `ext` 别名仅提供 `u("upstream_credits")`，不混入 `images`、`resolution` 或输入/输出 Token 字段。下面是用户提供的每张预估 Credits；它们已经包含所选价格折扣，不再乘第二次 `80%`，不是固定最终费用：

| 公共别名 | `0.5k` | `1k`（缺省） | `2k` | `4k` |
| --- | --- | --- | --- | --- |
| `nano-banana-am` | 不支持 | 0.312 Credits / $0.0312 | 不支持 | 不支持 |
| `nano-banana-2-am` | 0.536 Credits / $0.0536 | 0.536 Credits / $0.0536 | 0.808 Credits / $0.0808 | 1.208 Credits / $0.1208 |
| `nano-banana-pro-am` | 不支持 | 1.072 Credits / $0.1072 | 1.072 Credits / $0.1072 | 1.92 Credits / $0.192 |
| `nano-banana-2-lite-am` | 归一为 1k | 0.32 Credits / $0.032 | 归一为 1k | 归一为 1k |

提交前根据已校验的型号、分辨率和 `n` 提取预估用量；前三个型号固定一张，Lite 按 `0.32 * n` 预估。例如 Lite 请求 `n=4`、`resolution="4K"`，上游请求归一为 `1k`，预扣 `1.28` Credits（$0.128）。成功提交后，插件将唯一计费事实保存为 `PluginState.billing_usage = {"upstream_credits": 预估值}`；宿主同时冻结预扣用量和表达式。

完成时采用用户提供的[任务状态接口](https://docs.apib.ai/cn/api-reference/tasks/status)实际费用字段，不从单张价格重构或猜测 Token 用量，也不要求输入/输出 Token 拆分：

- 接受 `data` 包装或未包装的任务对象；只有 `completed`/`success` 才读取实际费用。外层 `code` 一旦存在且不为数字 `200`，不覆盖预扣。
- 优先采用 `credits_cost`：必须是有限、非负的数字，范围 `0..64` Credits（含端点）。它是整个任务的实际总额，不再乘 `n`，也不再打折。
- 仅在 `credits_cost` 字段缺失时，才回退到 `cost` 美元金额：必须是有限、非负数字，范围 `$0..$6.4`（含端点），以 `cost * 10` 转成 Credits。例如 `cost=0.15` 结算为 `1.5` Credits。
- `credits_cost` 存在但为 `null`、字符串、布尔值、负数、非有限数或超过 64 时，不使用 `cost` 兜底。有效 `credits_cost` 始终权威，即使 `cost` 相矛盾或格式错误也不影响结算。
- 两种费用都缺失、费用格式错误、`data=null`、响应结构无效或任务未完成时，完成钩子返回 `null`；宿主保留原预扣金额，不把未知费用推断成零。64 Credits 上限沿用已有 GPT 实际 Credits 的运行时安全上限，不代表供应商固定报价。
- 明确的 `credits_cost=0` 或仅有 `cost=0` 可以结算零；`failed`/`failure`/`cancelled`/`canceled` 也结算为零，退回预扣。

管理员对这四个公共别名分别配置下式，表达式输出为本次任务美元金额，不除以一百万：

```text
tier("upstream_actual", u("upstream_credits") * 0.1)
```

1 Credit = $0.1；额外加价由管理员调整系数，例如 20% 加价使用 `* 0.12`，不改写上游实际 Credits，也不修改服务端已有定价。无加价、分组倍率为 1 时，Pro 缺省预扣 `1.072` Credits（$0.1072）：完成返回 `credits_cost=0.5`，最终为 $0.05，退回 $0.0572；返回 `credits_cost=2.5`，最终为 $0.25，补扣 $0.1428。同一个冻结表达式用于预扣和最终结算。

APIMart 产物 URL 会过期；Tapcomfy 在任务成功后应立即下载并持久化到自己的对象存储。

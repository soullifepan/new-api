# APIMart 异步图片任务插件

这是一个本地、可上传的 Task Plugin；不进入 `plugins/tasks/`，因此不会改动或覆盖上游内置插件。

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

每个别名执行严格模型级字段白名单；不在表中的字段（包括会产生未声明成本的 `nsfw_check`）被拒绝，不会静默透传。`gpt-image-2-am` 和 `gpt-image-2-official-am` 保持已有兼容契约。

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
```

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

这是每张图片的美元成本；任务表达式不会按百万 Token 换算。若要对外加价，直接将上述单价替换为目标售价即可。APIMart 响应里的 `cost` 只用于上游对账，不作为用户扣费输入。

`gpt-image-2-official-am` 使用上游完成任务返回的 `credits_cost` 结算。提交时插件按 `n`、`resolution`、`quality`、参考图和遮罩图数量预估并预扣；完成后以 `credits_cost` 覆盖预估值，失败时结算为零。页面展示低、中、高质量 × 1K、2K、4K 的完整九档预估价，最终仍以实际 `upstream_credits` 结算；因此定价档位会显示 `$0.1 / credit`，而不是把预估价误当成固定单价。配置渠道映射：

```text
gpt-image-2-official-am → gpt-image-2-official
```

模型定价选择“表达式”，填写：

```text
tier("upstream_actual", u("upstream_credits") * 0.1)
```

这表示 1 Credit = $0.1。若需加价，调整乘数，例如 20% 加价使用 `* 0.1 * 1.2`。页面应提示“预计费用基于所选规格计算；任务完成后按上游实际 Credits 结算，多退少补”。

APIMart 产物 URL 会过期；Tapcomfy 在任务成功后应立即下载并持久化到自己的对象存储。

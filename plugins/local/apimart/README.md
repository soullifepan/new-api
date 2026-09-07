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

当前清单覆盖已验证为相同 APIMart 异步图片协议的模型和别名，包括 GPT-Image-2、Nano Banana 2、Flux 2、Flux Kontext、Seedream 与 Grok Imagine。对外提供 `gpt-image-2-am`，用于和同步 `gpt-image-2` 区分。

新增同协议模型时：

1. 在 `plugin.js` 的 `meta.models` 添加规范模型名；
2. 上传新的语义化插件版本；
3. 在测试环境创建或更新 `Task Plugin` 渠道，绑定 `apimart`，并配置渠道模型、模型映射、分组与定价；
4. 为新增模型补充一个低成本的请求验证。

协议或结果结构不同的模型不应直接加入清单；应先为其增加独立的适配分支或单独插件。

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

不要把真实 token 放进插件源码、fixtures 或 Git。

## 计费与素材保存

为每个渠道模型在 New API 中配置自己的定价。插件向表达式提供以下已校验的任务计费用量：

- `u("images")`：请求的 `n`，未提供时为 `1`；
- `u("resolution")`：`default`、`1k`、`2k`、`4k`。未提供或无法识别时为 `default`。
- `u("quality")`：`low`、`medium`、`high`。未提供时为 `low`。
- `u("input_images")`：参考图和遮罩图数量，没有输入图时为 `0`。
- `u("upstream_credits")`：官方积分模型在完成任务后由上游 `credits_cost` 覆盖；其他模型不提供此字段。

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

`gpt-image-2-official-am` 使用上游完成任务返回的 `credits_cost` 结算。提交时插件按 `n`、`resolution`、`quality`、参考图和遮罩图数量预估并预扣；完成后以 `credits_cost` 覆盖预估值，失败时结算为零。页面中的分辨率价格示例是预估值，最终以实际 `upstream_credits` 结算；因此定价档位会显示 `$0.1 / credit`，而不是把预估价误当成固定单价。配置渠道映射：

```text
gpt-image-2-official-am → gpt-image-2-official
```

模型定价选择“表达式”，填写：

```text
tier("upstream_actual", u("upstream_credits") * 0.1)
```

这表示 1 Credit = $0.1。若需加价，调整乘数，例如 20% 加价使用 `* 0.1 * 1.2`。页面应提示“预计费用基于所选规格计算；任务完成后按上游实际 Credits 结算，多退少补”。

APIMart 产物 URL 会过期；Tapcomfy 在任务成功后应立即下载并持久化到自己的对象存储。

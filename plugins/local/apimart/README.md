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

为每个渠道模型在 New API 中配置自己的定价。APIMart 响应里的 `cost` 只用于上游对账，不作为用户扣费输入。

APIMart 产物 URL 会过期；Tapcomfy 在任务成功后应立即下载并持久化到自己的对象存储。

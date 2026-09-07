# APIMart Midjourney 任务插件

本地插件键为 `apimart-midjourney`，对外模型别名为 `midjourney-am`。它把 APIMart Midjourney 的异步工作流统一为 New API 任务，并保留来源任务的归属校验。

## 已支持的原生接口

```text
POST /apimart/midjourney/v1/generations
POST /apimart/midjourney/v1/generations/blend
POST /apimart/midjourney/v1/generations/edits
POST /apimart/midjourney/v1/generations/{upscale,variation,high-variation,low-variation,reroll,zoom,pan}
POST /apimart/midjourney/v1/generations/{remix-strong,remix-subtle,video}
GET  /apimart/midjourney/v1/tasks/{task_id}
```

绘图、融合、编辑、后续操作和图生视频共用同一个插件、同一个模型别名与统一任务查询。后续操作所带的 `task_id` 必须是当前用户通过本插件创建的公共任务 ID；插件会在服务端替换为上游 ID，客户端不会得到上游任务 ID。

`describe` 是同步识图接口，不属于异步任务插件；`inpaint` / `modal` 是同一上游任务的两阶段续填流程，当前版本暂未暴露，避免把等待 `MODAL` 的父任务错误地计为已完成或长期占用。

## 渠道配置

创建类型为 `Task Plugin` 的渠道：

```text
插件键：apimart-midjourney
基础地址：https://api.apib.ai
渠道模型：midjourney-am
模型映射：留空
```

上游的新路由会自行注入 `model=midjourney`，插件不会把对外别名传给上游。轮询使用 `/v1/midjourney/{task_id}`，以取得 Midjourney 的图片结果和后续操作信息。不要把实际 API Key 写进插件、fixture 或仓库。

## 计费

APIMart 的任务查询不返回可信的实际成本，因此插件按已提供的 APIMart 公开价目表固定预扣；失败任务由宿主退款。插件输出 `u("documented_usd")`，它已经是本次任务的美元金额：

- Imagine：Relax `$0.04504`、Fast `$0.05504`、Turbo `$0.10`；
- Blend、Edits、放大、变体、重绘、Zoom、Pan、Remix：Relax / Fast `$0.05504`、Turbo `$0.10`；
- Video：480p `$0.20`、720p `$0.40`，乘以 `batch_size`（1 / 2 / 4）。

模型定价选择“表达式”并填写：

```text
tier("documented_rate", u("documented_usd"))
```

无需 Credit 换算。分组倍率和用户折扣由 New API 在此基础上处理。定价示例覆盖当前插件支持的所有操作与速度档位；`describe`、`inpaint` / `modal` 仍因未开放而不在示例中。APIMart 以后若调整价目表，必须上传新的插件版本；不要修改已上传版本的源码。

## 本地校验

```bash
go run . plugin lint plugins/local/apimart-midjourney/plugin.js
go run . plugin test plugins/local/apimart-midjourney/plugin.js --fixture plugins/local/apimart-midjourney/apimart-midjourney.fixture.json
```

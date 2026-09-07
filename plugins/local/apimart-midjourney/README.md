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
基础地址：https://api.apimart.ai
渠道模型：midjourney-am
模型映射：midjourney-am → midjourney
```

上游的新路由会自行注入 `model=midjourney`，插件不会把对外别名传给上游。不要把实际 API Key 写进插件、fixture 或仓库。

## 计费

APIMart 的 Midjourney 价格按操作、版本、速度和视频批次组合匹配，官方文档要求以控制台当前价格为准。本版本不猜测或硬编码价格，因此也不声明任务计费表达式字段；在确认每个计费键的价格表后，再以独立插件版本增加经过校验的预估与最终结算规则。

## 本地校验

```bash
go run . plugin lint plugins/local/apimart-midjourney/plugin.js
go run . plugin test plugins/local/apimart-midjourney/plugin.js --fixture plugins/local/apimart-midjourney/apimart-midjourney.fixture.json
```

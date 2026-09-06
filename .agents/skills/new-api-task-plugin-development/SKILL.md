---
name: new-api-task-plugin-development
description: 开发或维护 New API 本地 Task Plugin（异步图片、视频、音频、素材等），包含原生任务路由、模型映射、计费用量与插件测试；不用于标准渠道配置。
---

# New API 本地 Task Plugin 开发

用于供应商具有非标准异步任务、资产或查询接口，且不能只靠渠道类型、模型映射和标准端点配置完成的场景。开始前必须阅读 `docs/architecture/local-customization-governance.md`；涉及动态计费时还必须完整阅读 `pkg/billingexpr/expr.md`。

## 边界与设计

- 标准 OpenAI、Claude、Gemini 等协议优先使用现有渠道和模型映射，不创建插件。
- 本地供应商实现放在 `plugins/local/<provider>/`，不修改内置 `plugins/tasks/`，除非能力已具备通用、稳定的上游价值。
- 一个插件表示稳定的供应商协议或任务类别，不是单一模型。只有请求与结果协议一致的模型才能共用插件。
- 使用语义化版本。任何变更插件行为、模型清单、计费字段或路由的改动都递增版本；已上传版本的源码不可修改。
- 不把 API Key、真实用户数据、上游素材 URL 或可识别信息写入源码、fixture、文档和提交记录。

## 实现闭环

1. 先记录创建、查询、取消/回调、产物访问和错误结构；定义只暴露给客户端的公共任务 ID，不能泄露上游任务 ID。
2. 在 `meta` 声明 `key`、`version`、`allowedHosts`、模型和原生 `routes`。模型别名也必须出现在 `meta.models`，因为原生路由解码发生在渠道模型映射之前。
3. 实现提交、轮询、状态转换、失败原因和产物访问。任务和产物必须按当前用户/API Key 的授权边界隔离。
4. 异步图片/视频等按请求规格收费时，在 `meta.usageSchema` 声明经过验证的数值/枚举事实，并用 `extractUsage` 从请求提取。任务表达式使用 `u("field")`，输出值是单次请求的美元金额，**不除以一百万**。
5. 对上游回传的成本仅作对账；不要将不可信的上游费用直接作为用户扣费输入。完成时只有可靠、已验证的实测值才能通过 `extractUsageOnComplete` 覆盖预估值。
6. 对所有会影响费用的请求参数先限制范围。复用现有上限或设定明确、保守的插件级校验；缺省规格必须映射到一个确定的计费档位。

## 别名、渠道与定价

- 对外别名（如 `gpt-image-2-am`）与上游模型（如 `gpt-image-2`）分离：渠道模型公开别名，模型映射指向上游名。
- 定价记录优先绑定对外别名；插件的 `usageSchema` 会让模型定价页切换为任务用量编辑器。
- 任务表达式每个分支都必须包裹 `tier("name", value)`。枚举规格使用嵌套三元表达式，例如：

```text
u("resolution") == "4k"
  ? tier("4k", u("images") * 0.021)
  : tier("default", u("images") * 0.0085)
```

- 不在插件原生端点上额外配置普通 `openai` 或 `image-generation` 端点元数据；原生端点由插件路由定义。

## 验证与交付

1. 先为新增行为补充或更新 `<provider>.fixture.json`，覆盖成功、映射、缺省计费规格和费用参数边界。
2. 运行：

```bash
go run . plugin lint plugins/local/<provider>/plugin.js
go run . plugin test plugins/local/<provider>/plugin.js --fixture plugins/local/<provider>/<provider>.fixture.json
```

3. 更新同目录 README：对外路由、渠道配置、模型映射、计费字段和不应存放的敏感数据。
4. 以独立、可回滚的提交保存插件变更。部署和激活使用 `new-api-test-server-deployment` skill。

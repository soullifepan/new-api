---
name: new-api-task-plugin-development
description: 开发或维护 New API 本地 Task Plugin（异步图片、视频、音频、素材等），包含原生任务路由、模型映射、计费用量与插件测试；不用于标准渠道配置。
---

# New API 本地 Task Plugin 开发

用于供应商具有非标准异步任务、资产或查询接口，且不能只靠渠道类型、模型映射和标准端点配置完成的场景。开始前必须阅读 `docs/architecture/local-customization-governance.md`；涉及动态计费时还必须完整阅读 `pkg/billingexpr/expr.md`。

实现、修改或审查插件及其运行时前，完整阅读当前 `docs/plugin-api/v1.md`，不要把本技能当作协议副本。修改宿主契约时同时核对 `v1.schema.json` 和 `v1.d.ts`。API v1 也有新增字段；使用 `usageProfiles`、`unitLabel`、`enumLabels` 或新 capability 前先确认部署宿主支持，按先宿主、后插件的顺序发布。

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
5. 默认用已验证的实测用量结算，上游成本仅作对账。用户明确选择按上游实际成本收费时，可通过已验证的 `cost` / `credits_cost` 实现该合同：明确币种和换算，校验类型、有限性、非负值、合理上限及两字段一致性，不重复折扣或叠加用量收费。缺失值不得强转为零；在提交成功终态前处理结算延迟或异常，不能将保留预扣冒称实际结算。
6. 对所有会影响费用的请求参数先限制范围。复用现有上限或设定明确、保守的插件级校验；缺省规格必须映射到一个确定的计费档位。

## 别名、渠道与定价

- 对外别名（如 `gpt-image-2-am`）与上游模型（如 `gpt-image-2`）分离：渠道模型公开别名，模型映射指向上游名。
- 定价记录优先绑定对外别名；插件的 `usageSchema` 会让模型定价页切换为任务用量编辑器。
- 同一插件的模型需要不同计费字段时优先使用上游 `usageProfiles`，不要新增本地 `byModel` 宿主契约。每个 profile 的 schema/examples 完整替换默认值，不合并继承；验证公开别名映射、最终上游模型及历史任务轮询选择一致。已有表达式不会自动迁移。
- 多插件共享模型时核对 `<pluginKey>::<model>` 的提供方定价覆盖；不能只检查模型级表达式。计费事实按 `ctx.upstreamModel || ctx.model` 选择供应商规格，对外回显仍保留 `ctx.model`。
- 数值字段 description 写“计费对象 + 单价”，单位放 `unit`；计数对象可用 `unitLabel`，枚举展示名用 `enumLabels`。中英文短语含义一致，不夹带价格、默认值或协议限制。布尔字段描述 true 的肯定状态。逐项人工核对文案，lint 通过不代表文案合格。
- 任务表达式每个分支都必须包裹 `tier("name", value)`。枚举规格使用嵌套三元表达式，例如：

```text
u("resolution") == "4k"
  ? tier("4k", u("images") * 0.021)
  : tier("default", u("images") * 0.0085)
```

- 不在插件原生端点上额外配置普通 `openai` 或 `image-generation` 端点元数据；原生端点由插件路由定义。

## 验证与交付

### 第一步：开发与价格示例

计费表达式、用量 schema、展示示例是三个独立交付项。`usageExamples` / profile `examples` 保存规格标签与完整 facts，不单独保存售价；页面将 facts 代入生效表达式计算价格。不能只写模型 description 代替示例。

- 固定规格覆盖所有对外售价档位，例如版本 × 分辨率；样例通常使用一张/一次。
- 动态成本模型覆盖主要分辨率和质量档位，说明参考比例、数量、是否包含输入费用。仅输出成本必须明确标成“仅输出预估”，不能冒称整单总价或提交预扣金额。
- 不把 `auto` 的最高档预扣标成实际价格；不为展示 Token 单价伪造实际 Token facts。
- 在本地核对样例计算值，发布后检查公开接口的模型级及 provider 级 `billing_usage_examples`，并验证实际价格页面。只有一个示例不等于规格覆盖完成。

1. 先为新增行为补充或更新 `<provider>.fixture.json`，覆盖成功、映射、缺省计费规格和费用参数边界。
2. 运行：

```bash
go run . plugin lint plugins/local/<provider>/plugin.js
go run . plugin test plugins/local/<provider>/plugin.js --fixture plugins/local/<provider>/<provider>.fixture.json
```

3. 涉及定价时验证普通/特殊规格（如 Max）、缺省值、显式零/false、预扣和完成事实覆盖。检查公开 `/api/pricing` 的实际 schema、提供方覆盖和表达式，并用真实页面验收价格表/估算器；仅表达式计算与 fixture 通过不能证明展示正常。出现原始公式兜底时先核对页面版本、接口数据和缓存，不直接推断为布尔条件不支持。
4. 不在 `plugins/` 下创建 README、变更日志等文档；将路由、配置、映射及验证结果写入提交说明和交付消息。仓库规则禁止时也不新增 `docs/` 文件。
5. 以独立、可回滚的提交保存插件变更。部署和激活使用 `new-api-test-server-deployment` skill。

### 第二步：部署与运行时验收

用户授权发布后使用部署技能。分别确认版本已保存、已启用、已激活、运行时已加载，渠道模型与映射、模型级及 provider 级定价生效；最后检查 schema、examples 和页面。保留旧版本和配置回滚点。仅插件/config 变化不重打镜像；是否需要重启由同步结果决定。

### 第三步：指导 Tapcomfy 并主审

仅在用户要求客户端对接时执行。使用 `orchestration` 技能启动用户指定的 provider/model/effort；沿用指定目录，不擅自开 worktree。任务说明必须包括：两个仓库的准确路径、已激活插件版本、公开模型名与网关路由、逐型号上游文档 URL、字段及默认值差异、价格与预扣/结算口径、公开任务 ID、轮询和恢复约束。文档 URL 不得只给模型概览而遗漏具体端点。

worker 负责实现和测试，协调员负责收件、review、回派和独立验收。采用工具要求的收件确认与任务收尾机制，不让用户转发报告。未完成实现/测试不能作为成功交付；报告分别列明服务器状态、客户端代码状态、实机验收状态。没有重启或实机证据时不能说运行中的应用已修复。

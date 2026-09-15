---
name: new-api-test-server-deployment
description: 发布、更新或排查 Tapcomfy New API 测试服务器，包括 Docker/Caddy、任务插件激活、定价缓存和健康验证；不用于生产环境变更。
---

# New API 测试服务器发布

用于 Tapcomfy 的 New API 测试环境：`root@47.99.98.76`、服务域名 `llm-test.tapcomfy.com`、主容器 `tapcomfy-newapi-test`、Caddy 容器 `tapcomfy-newapi-caddy`、PostgreSQL 容器 `tapcomfy-newapi-postgres`。所有连接均不得在输出中泄露密钥。

## 安全边界

- 每次变更前先确认目标是测试环境，检查当前容器、镜像和工作目录；保留 PostgreSQL 与 Redis 数据卷。
- 仅在用户已授权的部署范围内进行写操作。插件上传、激活、数据库修改、容器重启都属于变更；说明影响并在执行前获得相应授权。
- 默认用管理界面或应用 API 变更任务插件。用户明确要求直接数据库更新时可使用受限 SQL 事务，不必先要求后台登录；未指定方式时，API/UI 不可用也可采用此兜底。必须断言目标环境和当前版本，备份受影响的非敏感配置，只修改授权插件、渠道模型/映射/能力及定价，保留旧版本；随后等待同步或按需重启并验证运行时。数据库写入成功不等于发布验收完成。
- 不导出、不显示、不复制渠道 `key`、`other`、环境变量或完整请求日志；排查时只选择模型、版本、状态、映射和安全的统计字段。

## 普通应用发布

测试环境的 Compose 位于 `/opt/tapcomfy/newapi`，日常运行使用
`compose.yaml` 与 `compose.test-runtime.yaml`。覆盖文件把宿主机
`./current/new-api` 只读挂载为容器内 `/new-api`，因此普通代码升级默认发布
包含 Web 静态资源的 Linux Go 二进制，不重建基础镜像。

1. 本地先构建和验证改动，确认提交和部署包不含密钥。
2. 发布前必须读取实际生效的 Compose 文件或用 `docker compose config` 核对覆盖关系；不得只根据基础 `compose.yaml` 的 `build`/`image` 推断发布方式。
3. 若 `compose.test-runtime.yaml` 仍挂载 `./current/new-api:/new-api:ro`：
   - 先运行 Web 生产构建；Go 二进制会嵌入 `web/dist`。
   - 使用 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOWORK=off` 编译当前已提交版本，并设置与 `VERSION` 一致的版本链接参数。
   - 上传为新文件，校验 SHA-256 和可执行权限后，再原子替换 `current/new-api`；保留带时间或提交号的旧二进制作为回滚。
   - 只重启 `tapcomfy-newapi-test`，不得重建或重启 PostgreSQL、Redis、Caddy。
4. 仅当运行时不再挂载二进制、基础系统依赖或 Dockerfile 确实变化，才重建 `tapcomfy/newapi:test` 镜像。仅 Task Plugin 源码或后台定价变动不需要重建主镜像。
5. 通过 HTTPS 域名确认主页和 API 可达，检查应用容器启动日志只包含正常迁移、插件同步与监听信息，并确认 PostgreSQL、Redis、Caddy 未被替换。
6. 发生失败时，先保留日志和当前数据，再恢复上一个已验证二进制或镜像；不要用破坏性命令重置持久化数据。

## Task Plugin 发布与计费验收

1. 使用 `new-api-task-plugin-development` 的本地校验结果和递增后的插件版本上传插件。
2. 在“任务插件”确认新版本不仅已上传，而且处于**已激活**状态；同一 `key` 只能有一个激活版本。
3. 渠道必须启用，插件键正确，公开模型与模型映射一致。不要读取或改写渠道凭据来做此检查。
4. 插件激活后等待插件同步与定价缓存刷新（最长约一分钟）；必要时重启主容器以重新载入运行时。
5. 查询公开 `/api/pricing`，检查目标模型及 provider 变体是否返回预期的 `billing_usage_schema`、`billing_expr`、`billing_usage_examples`，逐档计算并在页面确认展示；不能用 description 或数据库行代替运行时证据。任务规格表达式中 `u(...)` 只有在该 schema 出现后才可保存和估算。
6. 以最低成本的真实请求验证提交、异步查询、状态、预扣费和完成结算；检查日志时只读取请求 ID、渠道 ID、模型、状态和扣费结果。

## 已知故障特征

- 定价页显示“Token 估算器”并报 `u is not defined`：该模型未从运行时获得 `billing_usage_schema`。依次检查活跃插件版本、渠道别名/映射、插件同步和一分钟定价缓存。
- 任务请求报模型不存在：检查渠道映射后的上游模型名，不要把公开别名直接传给上游。
- 提交后自动退款：检查上游状态码和插件错误映射；保留任务及消费日志用于排查。

## 交付信息

报告部署版本、是否重启、验证过的公开端点和结果；若做了插件切换，报告活动版本。不得在报告中出现密钥、请求授权头或用户数据。

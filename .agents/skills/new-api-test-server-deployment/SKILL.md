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

## TapComfy OSS、STS 与模型目录

TapComfy 相关配置只属于 `new-api` 服务。远端部署根使用独立的
`/opt/tapcomfy/newapi/tapcomfy-oss.env`：文件必须为 `root` 所有且权限为
`0600`，并仅通过 `compose.yaml` 中 `new-api.env_file` 引用。不要将这些变量
写入 Compose、Git、shell 历史或命令输出。

- `TAPCOMFY_OSS_BUCKET` 是 STS 发给桌面端的普通客户端上传桶。
- `TAPCOMFY_OSS_ASSETS_BUCKET` 是管理台 3D 素材上传、素材引用校验和默认公开
  URL 使用的模型素材桶；未设置时服务端回退到 `TAPCOMFY_OSS_BUCKET`，以兼容
  单桶部署。
- 其余必需变量为 `TAPCOMFY_OSS_ACCESS_KEY_ID`、
  `TAPCOMFY_OSS_ACCESS_KEY_SECRET`、`TAPCOMFY_OSS_REGION`、
  `TAPCOMFY_STS_ROLE_ARN`、`TAPCOMFY_OSS_ENDPOINT`、
  `TAPCOMFY_STS_ENDPOINT`。OSS endpoint 应从 region 规范化为
  `https://oss-<region>.aliyuncs.com`，STS endpoint 为
  `https://sts.aliyuncs.com`。不要猜测或设置 `TAPCOMFY_OSS_PUBLIC_BASE_URL`。

变更此配置时，先为 `/opt/tapcomfy/newapi/compose.yaml` 建立带时间戳的备份，
以临时同目录文件原子替换 secrets env 文件；完成后仅将合并 Compose 配置重定向
到文件或 `/dev/null` 以验证语法，例如：

```sh
docker compose -f compose.yaml -f compose.test-runtime.yaml config >/dev/null
```

`docker compose config` 会解析环境变量，不能把它的输出显示或写入可访问日志。容器
内验证只能逐个检查变量是否存在（输出 `present`/`missing`），不可执行 `env`、
`printenv` 无参数或显示变量值。发布后检查 `/api/status`，可对公开
`/api/tapcomfy/v1/models` 做状态码及 `data`、`page`、`limit`、`total` 结构检查；
不要调用会签发凭据的 STS 端点，也不要用真实素材探测上传。

### 一次性旧目录导入

将旧 Supabase 目录迁入测试环境需要用户对源与目标的单独授权，绝不能作为普通
`deploy-test.sh` 发布的一部分。导入前备份 PostgreSQL 的 `tap_comfy_models` 表并
记录行数；导入失败时保留备份和诊断信息，不自动恢复数据库或删除 OSS 对象。

优先在可信本地从旧源导出**仅元数据** JSON，以 `0600` 临时文件传入远端
`/opt/tapcomfy/newapi/data/`，运行容器内的 `tapcomfy-import-models`。若旧源不是
HTTPS，或未明确授权将 Supabase service-role 凭据放入远端，不得将该凭据写入
`env_file`；使用 `TAPCOMFY_LEGACY_MODELS_FILE` 传递临时 JSON，并在导入后删除。
先执行 `--dry-run`，再执行正式导入。旧目录的公开资产位于不符合新固定前缀的扁平
路径时，使用 `--preserve-legacy-assets` 可保留已验证的 HTTPS 引用，保证桌面端无缝
切换；新管理台上传仍必须写入当前服务的固定安全目录。

导入以旧稳定 ID 幂等，完成后核对表行数、已发布条目数和公开模型目录响应。对迁移
条目进行管理员更新时，未改变的旧引用可以保留；一旦替换文件，新的 URL 和 object key
必须通过当前素材桶及固定目录校验。

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

---
name: new-api-test-server-troubleshooting
description: 排查 Tapcomfy New API 测试服务器的任务、插件、计费、退款和容器运行问题；以远程 PostgreSQL 与服务容器日志为事实来源，不用于生产环境或部署变更。
---

# New API 测试服务器排查

用于只读定位 `llm-test.tapcomfy.com` 的运行时问题。测试环境拓扑固定为：

- SSH：`root@47.99.98.76`
- 应用容器：`tapcomfy-newapi-test`
- PostgreSQL 容器：`tapcomfy-newapi-postgres`
- PostgreSQL 用户及数据库：`newapi` / `newapi`
- Caddy 容器：`tapcomfy-newapi-caddy`

## 数据源硬性规则

- 服务器真实业务数据在远程 PostgreSQL 容器中。不得把本地仓库的 `one-api.db`、其他 SQLite 文件或宿主机猜测路径当作测试服务器数据库。
- 先确认容器存在并在运行，再查询 PostgreSQL。若容器名或数据库配置发生变化，通过 `docker ps` 和容器的 `POSTGRES_USER`、`POSTGRES_DB` 环境项重新发现；不得输出 `POSTGRES_PASSWORD`、连接串或任何密钥。
- “最新日志”默认同时核对数据库 `logs`、`tasks` 与应用容器日志，不能只看其中一处就判断扣费或退款结果。
- 只读取目标任务所需的安全字段。不得输出渠道 key、Authorization、完整请求体、用户图片内容、环境变量全集或其他秘密。

## 标准排查顺序

1. 确认目标确实是测试环境，并检查三个固定容器的运行状态。
2. 从远程 PostgreSQL 获取最新目标模型任务和消费日志，记录任务主键、公开任务 ID、状态、插件版本、预扣额度、完成额度及安全的 usage facts。
3. 用公开任务 ID 或数据库主键关联 `tasks` 与 `logs`。退款必须以差额结算记录和最终额度变化共同证明；仅看到任务成功或图片返回不代表已经退款。
4. 查看应用容器相同时间窗口的日志，搜索任务 ID、结算、退款、usage hook、插件拒绝及状态映射消息。
5. 对照当前激活插件版本与本地插件版本。不要因为本地代码已修复就推断服务器运行时已更新。
6. 给出数据库事实、容器日志事实、代码路径推断，并明确区分“已证实”和“待验证”。

## 只读命令模板

先确认拓扑：

```bash
ssh root@47.99.98.76 \
  'docker ps --format "{{.Names}}\t{{.Status}}" | grep -E "^(tapcomfy-newapi-test|tapcomfy-newapi-postgres|tapcomfy-newapi-caddy)\b"'
```

通过 PostgreSQL 容器查询，而不是寻找 SQLite：

```bash
ssh root@47.99.98.76 \
  "docker exec tapcomfy-newapi-postgres psql -U newapi -d newapi -P pager=off -c '<只读 SQL>'"
```

常用发现查询应先用 `information_schema.columns` 确认字段，再选择明确列；不要使用 `SELECT *`。最新记录用数据库主键倒序并限制行数，例如：

```sql
SELECT id, task_id, status, properties->>'origin_model_name' AS model,
       quota, created_at, updated_at
FROM tasks
ORDER BY id DESC
LIMIT 10;
```

列名应以当前 schema 为准。查询 JSON 时只提取所需路径或数组长度，不打印完整 `private_data`、请求体或响应体。若要验证实际出图数量，优先用 PostgreSQL JSON 运算提取 `result.images[*].url` 的元素数量。

查看同一时间窗口的应用日志：

```bash
ssh root@47.99.98.76 \
  'docker logs --since 30m tapcomfy-newapi-test 2>&1 | grep -E "<任务ID>|结算|退款|usage|plugin"'
```

控制输出范围；若日志行包含请求正文、URL 查询密钥或认证头，先收窄搜索或脱敏后再报告。

## 计费与退款判定

- 预扣事实通常记录在消费日志或任务计费上下文中；完成 facts 必须由完成 hook 写入并进入结算路径。
- 图层拆分返回成功后，应把预扣最大张数替换为实际输出数量。若任务成功、返回数量正确，但任务额度和日志 facts 仍保持预扣值，优先检查完成 hook 的真实参数、facts 覆盖以及结算调用，而不是上游出图。
- “预扣费准确”日志只能证明系统认为完成额度等于预扣额度，不能证明实际张数正确。
- 退款完成至少需要看到：最终 usage facts、预扣与最终额度差、差额结算/退款日志，以及任务或用户额度对应变化。缺少任一项时报告为未完全验证。

## 权限边界

本技能默认只授权只读诊断。插件上传、激活、SQL 更新、容器重启、缓存清理和部署都属于外部变更，必须由用户另行明确授权。需要实施修复时，使用 `new-api-task-plugin-development`；获准部署后再使用 `new-api-test-server-deployment`。

## 交付格式

简明报告：查询的数据源、任务 ID、时间、运行插件版本、任务状态、预扣值、最终值、是否存在差额日志、容器日志关键结论和下一步。不得声称“已退款”或“已修复”，除非数据库和运行日志均能证明。

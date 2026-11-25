---
name: cines-server-deployment
description: 部署、更新、迁移和排查 cines 的 New API 服务器及 llm.cines.ai，管理独立 PostgreSQL、Redis、AWS S3、CloudFront、SES、备份与回滚；不用于 TapComfy 源测试实例发布。
---

# cines 服务器部署

## 多环境发布门禁

本仓库同一份 `new-api` 代码服务两套完全独立的服务器环境，严禁混用：

- **cines 独立服（本技能适用）**：`llm.cines.ai`（`admin@54.169.139.235`，`/opt/cines/newapi`），独立 PostgreSQL / Redis / AWS S3 / CloudFront / SES。
- **TapComfy 源测试服（见 [new-api-test-server-deployment](../new-api-test-server-deployment/SKILL.md)）**：`llm.tapcomfy.com`（`root@47.99.98.76`，`/opt/tapcomfy/newapi`），本技能不得用于发布或修改该实例。

**硬规则**：若调用方未显式指明目标实例（`cines` / `llm.cines.ai` 或 `TapComfy 测试服` / `llm.tapcomfy.com`），**禁止执行任何发布、配置修改、数据库变更或容器操作**，必须先向调用方确认目标环境后再继续。

## 入口与边界

```sh
ssh -i /Users/panrui/.ssh/cines.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes admin@54.169.139.235
```

目标 Debian 13.4 x86_64，admin 可 sudo -n；私钥0400，known_hosts 已登记。根目录 `/opt/cines/newapi`。不得输出完整 compose/env、docker inspect、数据库秘密或临时凭据；私有目录0700、敏感文件0600。用户决定保持现有EC2公网IP，不申请EIP、不停止再启动EC2。浏览器/GUI另需明确同意。

源 `root@47.99.98.76:/opt/tapcomfy/newapi`、`llm.tapcomfy.com`，只读核对与一致性导出，不停服、不修改源数据。源Compose `compose.yaml` + `compose.test-runtime.yaml`；不能以源release目录名称推定实际代码版本。保留 new-api、QuantumNous及第三方版权。

## 2026-11-11 已验证状态

- 目标4容器已运行：`cines-newapi`、`cines-newapi-caddy`、`cines-newapi-postgres`、`cines-newapi-redis`；PG/Redis健康。Docker26.1.5、Compose2.26.1、PG16.15、Redis7.4.11、Caddy2.11.4。
- 两份配置 `compose.infrastructure.yaml` + `compose.application.yaml`；应用通过 `cines-aws.env` 启用S3；PG/Redis独立认证，不连接源数据库。PG/Redis无宿主映射端口，内部网 `cines-newapi-net`；应用/Caddy另有 `cines-public` 出口网。
- `current` 指向 `releases/35df3b45e8-cines-s3-20261111`，二进制SHA256 `1b43596dd0bcc8b35998c5495b11564043db347a82dc9a9b4402b7540cdd1946`，版本 `35df3b45e8+cines-s3.20261111`。基于仓库35df3b45e8及未提交S3/日志/占位渠道保护改动构建，不把版本标记当成已提交版本。
- 原定制二进制保存于 `releases/source-c9d4ff28a0/new-api`，SHA256 `c9d4ff28a0b956ff5a88e8fc14f5b2a44066c5b045d76fd0a911b58ff53a1efc`；原版本不支持新增S3配置，不能仅切回二进制就宣称完整回滚。
- **唯一最终恢复基准**：PG只读repeatable-read导出快照 `2026-11-11 08:03:55.222713 UTC`，60表36,855行逐表匹配；用户19、tokens32、user_sessions22、channels18、plugins68、models104。旧07:01快照的18/31/21身份统计已过时。
- 最终dump SHA256 `5732dee7d65bf2b100465ee57d04f915a20444acef5495552940a709542031d4`，在 `backups/ready-20261111T080355Z/`。快照无非终态生成任务或待支付订单，目标未重复生成/扣费。
- Redis原一致性RDB20键，2键自然TTL到期后18个auth:user:version键；保留认证记录，不清理旧用户会话或API令牌。PG、Redis、文件分别快照，不宣称跨存储原子一致性。
- assets业务桶2421对象45,510,452,600字节全部复制，保留key/元数据并逐对象SHA256及长度验证，0失败，GLTF依赖问题0；迁移证据在 `backups/asset-migration-20261111/`。104模型208引用已映射新CDN，历史记录其他字段保留。旧uploads临时桶按用户决定不迁移。
- 内部只读 `/api/status` 成功且SystemName=cines，`/api/pricing`124项，公开素材目录正常。不能将内部HTTP验收称为公网HTTPS验收。

## 外部隔离与当前限制

详细资源与边界见 [隔离清单](references/isolation-checklist.md)。已按用户决定将18渠道实际key置为字符串1，保留模型、价格、状态、用户令牌；`CHANNEL_KEY_PLACEHOLDER=1` 在取key阶段503并跳过重试，避免后台探测/轮换调用旧供应商。用户需自行配置独立供应商凭据后恢复真实生成能力，不得沿用源key。

支付按用户决定延后，`AlipayNativeEnabled=false`、旧商户认证清空，历史订单保留。SMTP已换独立SES，尚未发送测试邮件。

2026-11-12 已核对权威DNS及公共解析：`llm.cines.ai -> 54.169.139.235`，DNS服务商代理保护已关闭。Caddy已取得Let’s Encrypt正式可信证书并配置自动续期；使用域名/SNI直连源IP的HTTPS `/api/status`返回200（未跳过证书校验）。此前DNS失败使Caddy进入长退避等待，本次仅重启Caddy后签发成功；不要无界重启重试。SES身份cines.ai、DKIM及MAIL FROM `bounce.cines.ai`均SUCCESS，原mail.cines.ai保留旧邮箱CNAME，不能与SES的MX/TXT混用。账号仍sandbox，正式发信权限和真实邮件验收未完成。

## 日常操作

更新、备份与回滚见 [维护步骤](references/operations.md)。更改配置前保留受限备份；只对新建临时验证库做销毁，不覆盖运行库。涉及收费、功能关闭/恢复、外部凭据及源实例变更需按当前授权边界确认，已明确授权事项不反复询问。

只读验收使用SSH/HTTP/CLI；不得发真实生成、测试邮件或在未授权情况下签发STS。本次后续经协调器明确解除受控STS限制，已用临时普通用户及最小storage:read PAT通过私网完成一次STS、38字节上传、CDN可信HTTPS哈希核验、日志202及CloudWatch1条核验；临时用户/PAT和对象全部版本已清理，19用户/0 PAT/32 API tokens/22会话恢复基线。证据在服务器backups/e2e-verification.json。以后重做仍须符合当轮授权，不得搜取现有用户token或伪造会话。

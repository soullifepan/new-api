# 更新、备份、恢复与回滚

所有服务器命令使用SKILL.md规定SSH，sudo -n，umask077。先读状态和当前授权，禁止直接打印含秘密的compose/env/docker inspect。

## 运行

在 `/opt/cines/newapi`：

```sh
sudo docker compose -f compose.infrastructure.yaml -f compose.application.yaml config --quiet
sudo docker compose -f compose.infrastructure.yaml -f compose.application.yaml ps
```

容器运行不代表域名TLS完成。PG/Redis内部健康正常后检查应用内部/api/status、/api/pricing和/api/tapcomfy/v1/models；输出只取成功标志、版本、数量。公网验收必须用系统信任的HTTPS，不使用-k。域名DNS缺失时记录阻塞。

## 更新

保留用户工作区改动，不自动commit/push。先确认当前版本、git基线及二进制hash；新版本必须保留S3、日志和占位渠道保护能力。仓库web使用bun run build，Go按go.mod版本构建CGO_ENABLED=0 GOOS=linux GOARCH=amd64二进制，保留new-api第三方版权。把新binary放到独立releases/<version>/new-api，核对两端SHA256，保存current旧symlink和配置私有备份，再原子替换current并仅重建new-api服务。不要单纯docker restart：bind mount旧inode可能仍在。完成只读健康验收，不调用付费生成。

## 备份

脚本 `/opt/cines/newapi/backup-cines.py`，systemd `cines-newapi-backup.service` + `cines-newapi-backup.timer`，每日03:15UTC加最多300秒随机延迟。首次运行Result=success、ExecMainStatus=0，已启用timer。脚本分别pg_dump -Fc、Redis复制协议RDB、current/data/logs/compose/AWS环境/Caddy文件归档；各文件SHA256上传S3验证后移除本次临时daily目录，不删除初始快照。运行中日志归档不是跨系统原子快照。

私有桶 `cines-backups-554269191760-ap-southeast-1`：daily/<UTCstamp>/有30天生命周期及非当前版本保留30天；`migration-20261111/`保留初始、最终和隔离回滚材料，不套用daily删除规则。初始26文件上传后HEAD checksum核验，服务器记录 `backups/initial-s3-manifest.json`。

本地备份目录（0700，敏感文件0600）：
- `backups/migration-20261111`：初始dump/运行镜像/文件归档/Redis，**不是最终数据基准**。
- `backups/ready-20261111T080355Z`：最终无在途任务一致性PG快照与逐表计数，60表36855行。
- `backups/isolation-20261111`：渠道/选项变更前保密记录、isolate-runtime.sql/rollback-runtime.sql、模型URL映射与rollback-model-assets.sql；含源秘密，绝不输出。
- `backups/asset-migration-20261111`：逐对象hash、summary与迁移清单；manifest含限时源只读签名URL，也按秘密管理。

已实测从S3下载最终dump，SHA256匹配，恢复到新建cines_restore_verification临时库，60表36855行全部匹配；随后只删除该新建验证库，未覆盖运行库。

恢复必须先下载备份验证SHA256，并优先恢复到新命名临时数据库，用pg_restore --no-owner --no-acl、逐表行数比对验证；不可直接覆盖已有新业务。生产恢复/回退前保留当前目标快照，明确数据丢失范围和用户决定。当前实例继续运行时不得执行dropdb cines或删除卷。

Redis有AOF时优先加载AOF，不会自动使用放入的RDB。只对已授权停用且无新写入的目标：停止Redis、归档现有AOF、在停止后安装备份RDB，用appendonly=no加载验证，再CONFIG SET appendonly yes，确认rewrite成功后恢复正式Compose。不要flushall或清除用户会话。

## 回滚边界

保留原binary `releases/source-c9d4ff28a0`，但它只支持旧OSS，不能单独切回它并继续宣称S3可用。优先回滚到已验证支持新AWS契约的上一个release；第一次上线尚无这种前版本。若需退回旧软件/配置，必须用户决定外部依赖能力，不得恢复旧供应商/支付认证或让目标使用源数据库。

目标已改业务字段时回滚SQL含条件防止覆盖并发修改；其内有旧凭据，不能盲目执行。临时迁移IAM策略已移除，重跑复制需明确当前授权并限期恢复最小权限。

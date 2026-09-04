# 本地与测试环境部署

本文档约定：本地开发使用 Podman，测试环境使用 Docker、PostgreSQL、Redis 与 Caddy。两套环境的数据彼此隔离；测试环境发布仅更新 `new-api` 应用容器，不重建或删除数据库、缓存和证书数据。

## 本地开发（Podman）

### 前置条件

- Podman 与 `podman compose`
- Go 1.22+
- Bun

首次启动 API、PostgreSQL 与 Redis：

```bash
make dev-api
```

前端开发服务器在另一终端启动：

```bash
make dev-web
```

浏览器访问 `http://localhost:5173`。前端开发服务器会将 API 请求代理到 `http://localhost:3000`。

### 日常更新

后端源码通过挂载目录在容器内运行，并且 Go 编译缓存和模块缓存都保存在 Podman volume 中。因此通常不需要重建镜像：

```bash
# Go 代码修改后，快速重启 API
make dev-api-restart

# 仅在 Go 版本、go.mod、Dockerfile.dev 或开发基础镜像变更后执行
make dev-api-rebuild
```

常用检查命令：

```bash
podman compose -f docker-compose.dev.yml ps
podman compose -f docker-compose.dev.yml logs -f new-api
```

### 本地数据

本地 PostgreSQL、应用数据、Redis 和 Go 缓存分别位于以下具名 volume：

- `dev_pg_data`：本地 PostgreSQL 数据
- `dev_data`：应用数据目录
- `dev_go_build_cache`、`dev_go_module_cache`：Go 编译与依赖缓存

`podman compose -f docker-compose.dev.yml down` 只停止容器，不删除这些数据。`down -v` 会删除上述本地 volume，等同于重置本地开发数据；执行前应确认不再需要其中的数据。

## 测试环境发布

### 架构与原则

测试服务器目录为 `/opt/tapcomfy/newapi`，应用使用 `llm-test.tapcomfy.com` 对外提供 HTTPS 服务。

发布流程如下：

1. 本机使用 Bun 构建前端；前端资源被嵌入 Linux AMD64 的 Go 二进制。
2. 本机将二进制、许可证和版本信息打成发布包并通过 SSH/rsync 上传。
3. 服务器解压到 `releases/<发布标识>`，更新 `current` 软链接。
4. Docker 仅重新创建 `new-api` 容器，并将 `current/new-api` 只读挂载为容器启动程序。
5. 脚本探测 `/api/status`；启动或健康检查失败时，恢复前一个 `current` 版本并重新创建应用容器。

服务器不会执行 Go、Bun、npm 或镜像构建，避免受服务器内存和外网镜像访问影响。PostgreSQL、Redis、Caddy、证书目录、应用数据和日志目录均不会在发布中变更。

### 发布前检查

- 本机已安装 Go、Bun、SSH 和 rsync。
- 本机对测试服务器的 SSH 免密登录可用。
- 先确认当前改动与测试范围；发布脚本会使用当前工作区源码构建，不要求工作区必须干净。
- 如需修改目标，使用环境变量覆盖默认值：

```bash
TEST_DEPLOY_HOST=root@example.com \
TEST_DEPLOY_ROOT=/opt/tapcomfy/newapi \
make deploy-test
```

### 发布

在仓库根目录执行：

```bash
make deploy-test
```

默认目标是 `root@47.99.98.76:/opt/tapcomfy/newapi`。发布完成后应看到 `Deployment <发布标识> is healthy`。随后可访问：

```text
https://llm-test.tapcomfy.com/
```

### 服务器检查

```bash
ssh root@47.99.98.76
cd /opt/tapcomfy/newapi

docker compose -f compose.yaml -f compose.test-runtime.yaml ps new-api
docker compose -f compose.yaml -f compose.test-runtime.yaml logs --tail=100 new-api
docker exec tapcomfy-newapi-test wget -q -O /dev/null http://127.0.0.1:3000/api/status
readlink -f current
```

`compose.test-runtime.yaml` 是发布脚本上传的 Compose 覆盖文件；它负责把 `./current/new-api` 以只读方式挂载到 `/new-api`。检查或手动重建应用容器时，必须同时带上这个覆盖文件，避免丢失二进制挂载。

### 回滚

发布脚本会在应用无法启动或健康检查超时后自动回滚。若需要人工回滚，先找出上一版本目录，再切换 `current` 并仅重建应用容器：

```bash
ssh root@47.99.98.76
cd /opt/tapcomfy/newapi
ls -1 releases
ln -sfn /opt/tapcomfy/newapi/releases/<上一发布标识> current
docker compose -f compose.yaml -f compose.test-runtime.yaml up -d --no-build --force-recreate new-api
```

完成后再次执行健康检查。不要使用 `down -v`、不要删除 `postgres`、`redis`、`data`、`caddy-data` 或 `caddy-config`，这些目录保存测试环境的业务数据、缓存与 TLS 证书状态。

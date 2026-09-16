# 支付宝当面付余额充值

## 范围与分支

- 分支：`codex/feature/alipay-native-topup`，原目录开发，不新建 worktree。
- New API 直接对接支付宝；复用现有 TopUp 和钱包账务。
- 仅余额充值，不涉及订阅、TapComfy 客户端、旧 FC 修改或部署。
- 默认关闭，测试使用独立沙箱；不读取或复用生产密钥。

## 实现边界

1. 独立支付宝配置、协议客户端、控制器和结算文件；现有文件仅接线。
2. 不改变现有 Epay 行为，不泛化所有支付提供商，不新增数据库表或列。
3. 服务端定价，持久化订单后下单；订单绑定支付环境与商户身份。
4. 查单、回调共用事务幂等结算，核验金额、订单、应用、收款方及签名。
5. 私钥不回显、不记录日志；管理配置原子保存，公共 option 写入不得绕过验证。
6. 网页复用现有支付设置、钱包和弹窗组件，支持七语言及沙箱提示。

## 分工与依赖

- 后端：`task_03809f432c39`，仅 Go、依赖及后端测试。
- 前端：`task_cd1b4fd1e07d`，仅 `web/`；依据以下接口并行实现。
- 总控：协议协调、独立源码审查、验证结果核实及沙箱操作说明。
- worker 完成后保留，不自动提交、合并、推送或发布。

## 接口约定

- `POST /api/user/alipay/amount`：`{amount}`，现有 `message/data` 金额格式。
- `POST /api/user/alipay/pay`：`{amount}`，成功 data 包含 `trade_no, qr_code, amount, currency, sandbox`。
- `GET /api/user/alipay/order/:trade_no`：仅本人订单，data 包含 `trade_no,status`。
- `POST /api/alipay/notify`：支付宝表单回调；验签和入账成功后才确认。
- `GET/POST /api/option/alipay-native/config`：现有 root 权限，`success/data/message` 格式。
- 配置键：`AlipayNativeEnabled/Sandbox/AppID/SellerID/PrivateKey/PublicKey/AppCert/AlipayCert/RootCert/UnitPrice/MinTopUp`。
- GET 不返回 PrivateKey，仅返回 `AlipayNativePrivateKeyConfigured`；保存空私钥保留现有值。
- AppCert 非空选择证书模式（三证书必填），否则选择支付宝公钥模式。
- TopUpInfo 增加 `enable_alipay_native, alipay_native_min_topup, alipay_native_sandbox`。
- 新支付方式 `alipay_native`，不覆盖 Epay 的 `alipay`。

## 验证检查点

- [ ] 下单失败、签名错误、金额/商户/环境不匹配、越权查单测试。
- [x] 共享结算入口的重复/并发入账幂等、钱包上限与事务回滚测试（SQLite）。
- [ ] 真实 SQLite、MySQL、PostgreSQL 隔离数据库回归；记录版本和命令。
- [x] Go 定向测试与编译；前端类型检查、相关测试、构建。
- [ ] 模拟接口浏览器验证：二维码、关闭停止轮询、成功刷新、沙箱提示。
- [ ] 独立审查并解决付款/到账阻塞问题。
- [ ] 用户配置沙箱后联调下单、扫码、回调、余额与充值记录（当前未授权部署）。

后端先用 `go test ./controller ./model ./service ./setting` 的定向用例验证；前端在 `web/` 使用 Bun 执行现有测试、typecheck 与 build 脚本。代码遵循根目录及 web/AGENTS.md，不改认证体系或绕过其权限。

## 当前外部依赖

- 用户需准备支付宝沙箱应用及测试买家；私钥仅填写受保护的后台配置。
- 本机有 Podman 但虚拟机未运行；矩阵只能使用隔离测试实例，不操作业务数据库。
- 未完成沙箱或三数据库验证前，不宣称可上线。

## 第一轮审查与返工

- 初版未通过验收：配置前后端字段/成功响应不一致、金额字符串误当数字、旧订单结算依赖启用开关、TOKENS 换算截断、通用配置写入旁路、查单误用登录敏感限流桶。
- 后端返工任务 `task_6b2957374949`，当前重试 `ctx_796c92e682a7`；前一次未完成已明确失败，旧 worker 保留且不再编辑。
- 前端返工任务 `task_bf341b0bc25d`，当前重试 `ctx_0547cbee2a68`；前次补了部分回归，但配置错误态及模式切换仍未完成。
- 配置变更采用最小范围约束：存在待处理订单时禁止更换支付环境、应用、商户或验签凭据；停用新支付不阻断旧订单结算。配置变更与建单必须跨实例串行验证，不只依赖进程锁。
- 同一个订单的并发回调/查单必须幂等。两个不同订单分别实际付款并分别到账不是超发，不以金额相同为由禁止合理重复充值。
- 支付宝未确认关闭前，不因本地超时拒绝已付款订单；预下单结果未知必须保留订单号供查询。
- `smartwalle/alipay` 是第三方 Go SDK，不是支付宝官方 SDK。
- 隔离数据库准备任务 `task_184a4200f6fa` 已失败：两次 `podman machine start podman-machine-default` 报启动成功后立即停止，连接 `127.0.0.1:60739` 被拒绝。没有创建临时容器或接触业务数据库；MySQL/PostgreSQL 实测阻塞，不能视为通过。
- 第二轮后端基础测试及构建通过，但总控未接受为最终完成：继续 `task_6ba31447bd8e` 补真实验签入口测试、MySQL RR 锁快照和闭单幂等。
- 第二轮网页 4 文件 / 9 项组件测试、typecheck、定向 lint 通过；真实浏览器启动仍受阻。继续 `task_51513519bef3` 对齐未知预下单响应及失败/过期终态，不再反复启动浏览器。

## 沙箱联调准备（不修改现有 FC）

2026-09-16 本轮收尾：代码已落在功能分支，未提交或部署。总控独立运行 Go 五包测试和 `go build ./...` 通过；前端四文件 15 项测试、`bun run typecheck`、`bun run build` 通过。最终复查修正正常 pending 被误当网络错误的轮询问题。真实浏览器、MySQL/PostgreSQL、支付宝沙箱端到端仍未验收，不能宣称可上线。所有 worker 保留。

运行限制：待处理订单存在时禁止更换应用/环境/商户/验签凭据；需先通过查单/通知确认订单终态，不可直接删除订单或强行切换。

1. 登录 https://open.alipay.com/develop/sandbox/app 获取沙箱应用及测试账户。
2. 配置 RSA2 应用公钥；应用私钥只保存到测试服务的受保护配置，不发送到聊天或提交 Git。
3. 准备沙箱 APPID、沙箱商家用户 ID、应用私钥与支付宝公钥；如使用证书模式则准备对应三证书，不混用两种模式。
4. 使用控制台提供的沙箱钱包/测试买家完成扫码，不使用生产收款应用密钥。
5. 待测试服务发布获准后配置测试站点公网 HTTPS 回调地址 `/api/alipay/notify`，开启沙箱并小额虚拟充值。
6. 核对订单、回调、余额和充值记录；关闭弹窗后到账、重复通知不重复加余额、错金额/错商户拒绝也须验证。

官方当面付沙箱接入说明：https://open.alipay.com/paymentServicer/paymentProvider.htm

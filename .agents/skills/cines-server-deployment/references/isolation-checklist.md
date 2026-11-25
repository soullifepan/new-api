# 已实施隔离与AWS资源

2026-11-11，AWS账号554269191760，新加坡ap-southeast-1；EC2 i-023e6524f045ec649/t2.medium，安全组sg-095c46d0b8714b8c3放行22/80/443，IMDSv2 required hop2。没有申请EIP。AWS CLI本机profile cines供已授权管理；服务器只使用实例角色，禁止复制本机root凭据。

- 实例角色/配置文件 `cines-newapi-instance-role` / `cines-newapi-instance-profile`；上传子角色 `cines-client-upload-role`。子角色仅uploads/temp/* PutObject，应用每次session policy收窄到temp/<已鉴权用户ID>/*，不授予list/delete/public ACL。用于全资产复制的临时cines-assets-migration inline policy已删除。
- S3桶 `cines-uploads-554269191760-ap-southeast-1`、`cines-assets-554269191760-ap-southeast-1`、`cines-backups-554269191760-ap-southeast-1`。全部BlockPublicAccess、BucketOwnerEnforced、SSE-S3、拒绝非TLS。assets/backups开启versioning。
- uploads temp/到期7天（生命周期异步执行，不保证精确到秒）；临时对象缓存最长60秒；客户端缓存TTL590400秒，STS凭据3600秒，与对象7天生命周期不同。
- assets为持久业务目录，不应用7天删除规则。2421对象全量复制；旧132个临时uploads对象按用户决定不迁。
- CloudFront E1SSHQR7Y0OO14，`https://dvfxqchyso38y.cloudfront.net`，OAC访问私有S3；默认assets全部keys，temp/*映射uploads。无收费WAF、OriginShield或LambdaEdge。S3匿名GET403、CloudFront合成小对象HTTPS200与内容hash已实测，后续受控临时身份已实际通过网关STS签发、上传、CDN哈希与日志入CloudWatch验收，临时身份及对象已清理。
- CloudWatch `/cines/client-errors`，stream `application-errors`，保留14天。网关日志接口POST /api/tapcomfy/v1/client-logs，UserAuth、PAT storage:read、每用户30/60秒、16KiB整请求限制、字段白名单和脱敏；不记录凭据。
- SES身份cines.ai及DKIM已验证（2026-11-12）；MAILFROM已改为bounce.cines.ai，其MX/TXT权威解析正确，AWS验证状态SUCCESS（2026-11-12）；SMTP email-smtp.ap-southeast-1.amazonaws.com:465 TLS，From noreply@cines.ai。独立IAM SMTP user cines-newapi-ses-smtp，限该域身份及From；秘密只在目标DB及受限备份。SES sandbox，未发邮件。
- 18渠道实际认证key为1，other/header_override/param_override为空，setting/settings无嵌套认证；保留全部原模型/价格/渠道状态。新供应商key由用户提供，不能从源恢复来绕过隔离。
- 支付明确延后：目标关闭支付宝且旧认证清空。保留历史订单、不修改源、不删除用户/会话/token。新PG/Redis/session秘密已与源分离，使用最新轮换值；旧PG/Redis认证实测被拒绝。

DNS待用户完成父域委派、llm A、SES DKIM和MAILFROM MX/TXT；确切SES记录从AWS SES identity只读查询获取，不在此伪造记录。无Route53入口时不可擅自购买域名。

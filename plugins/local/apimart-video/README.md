# AM Video Task Plugin

AM 异步视频生成的本地 Task Plugin。插件统一处理任务提交、轮询、公共任务 ID 和视频产物访问；每个型号仍使用独立的字段白名单、默认值、参数组合校验和计费用量结构。

## 原生路由

```text
POST /am/video/v1/videos/generations
GET  /am/video/v1/tasks/{task_id}
```

查询接口只接受 New API 返回的公共 `task_id`，不会把 AM 上游任务 ID 暴露给客户端。

## 渠道配置

- 渠道类型：Task Plugin
- 插件：`am-video`
- Base URL：`https://api.apib.ai`
- 密钥：仅配置在渠道中，不要写入插件、fixture 或仓库文件

公开模型使用 `-am` 后缀。建议配置以下模型映射：

| 公开模型 | AM 上游模型 |
| --- | --- |
| `grok-imagine-1.5-video-am` | `grok-imagine-1.5-video-ext` |
| `kling-3.0-turbo-am` | `kling-3.0-turbo` |
| `minimax-hailuo-2.3-am` | `MiniMax-Hailuo-2.3` |
| `minimax-hailuo-2.3-fast-am` | `MiniMax-Hailuo-2.3-Fast` |
| `pixverse-v6-am` | `pixverse-v6` |
| `viduq3-am` | `viduq3` |
| `viduq3-pro-am` | `viduq3-pro` |
| `viduq3-turbo-am` | `viduq3-turbo` |
| `wan2.7-am` | `wan2.7` |
| `happyhorse-1.0-am` | `happyhorse-1.0` |
| `skyreels-v4-fast-am` | `skyreels-v4-fast` |
| `veo3.1-fast-am` | `veo3.1-fast` |
| `veo3.1-quality-am` | `veo3.1-quality` |
| `veo3.1-lite-am` | `veo3.1-lite` |

## 计费字段

按秒计费型号声明 `seconds` 和 `resolution`；Pixverse 额外声明 `audio=on|off`。Veo 3.1 按次计费，声明 `requests` 和 `resolution`。表达式输出是单次任务的美元金额，不除以一百万，每个分支都应使用 `tier()`。

示例：

```text
u("resolution") == "720p"
  ? tier("720p", u("seconds") * 0.01912)
  : tier("480p", u("seconds") * 0.0102)
```

价格属于管理员配置，不固化在插件中。激活前应重新核对 AM 定价并保留管理员已有覆盖。

### 已核对价格快照

下表为 2026-09-12 从 AM 定价接口核对的优惠后美元价格，仅用于管理员录入和复核：

| 公开模型 | 档位价格 |
| --- | --- |
| `grok-imagine-1.5-video-am` | 480p `$0.0102/s`；720p `$0.01912/s` |
| `kling-3.0-turbo-am` | 720p `$0.1144/s`；1080p `$0.1432/s` |
| `minimax-hailuo-2.3-am` | 768p `$0.0488/s`；1080p `$0.072/s` |
| `minimax-hailuo-2.3-fast-am` | 768p `$0.0248/s`；1080p `$0.0424/s` |
| `pixverse-v6-am` | 无音频 360/540/720/1080p：`$0.016/$0.024/$0.032/$0.064/s`；有音频：`$0.024/$0.032/$0.04/$0.08/s` |
| `viduq3-am` | 540/720/1080p：`$0.04/$0.08/$0.10/s` |
| `viduq3-pro-am` | 540/720/1080p：`$0.056/$0.12/$0.128/s` |
| `viduq3-turbo-am` | 540/720/1080p：`$0.032/$0.048/$0.056/s` |
| `wan2.7-am` | 720p `$0.0664/s`；1080p `$0.1096/s` |
| `happyhorse-1.0-am` | 720p `$0.13/s`；1080p `$0.23/s` |
| `skyreels-v4-fast-am` | 480/720/1080p：`$0.064/$0.088/$0.22/s` |
| `veo3.1-fast-am` | 720/1080p `$0.14/次`；4K `$0.64/次` |
| `veo3.1-quality-am` | 720/1080p `$1.00/次`；4K `$1.50/次` |
| `veo3.1-lite-am` | 720/1080p `$0.07/次`；4K `$0.57/次` |

## 首版边界

- 不包含 Sora、Kling 4.0、Wan 3.0 和旧代际型号。
- HappyHorse 首版支持文生、首帧和参考图生成。视频编辑的实际输出时长由源视频决定，在无法可靠提取结算时长前不开放，避免错误预扣费。
- SkyReels 首版只开放基础文生/图生字段，高级 Omni、参考视频、拼贴和声纹功能待单独核对字段互斥及计费后再加入。
- Seedance 2.x、Kling V3/Omni/O1、Gemini Omni 和 FLUX 3 属于第二批复杂模型，不在此版本中。

## 验证

```bash
go run . plugin lint plugins/local/apimart-video/plugin.js
go run . plugin test plugins/local/apimart-video/plugin.js --fixture plugins/local/apimart-video/apimart-video.fixture.json
```

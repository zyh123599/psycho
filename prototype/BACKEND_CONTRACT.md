# 心潮未来生产后端契约草案

状态：未来生产目标，不代表当前已实现接口。当前 V0.5 实际实现为
`POST /api/v1/profiles/analyze` 与 `POST /api/v1/companion/respond`，完整可调用契约见
[`../backend/docs/API.md`](../backend/docs/API.md)。本文保留 SSE、云端日报、地区危机资源和持久化分域等后续设计。
适用范围：情绪陪伴聊天、今日潮汐日报、最小化画像信号、危机支持路由。
不适用范围：心理诊断、治疗方案、医疗建议、真人危机干预或模型训练数据采购。

本文使用“必须 / 不得”表示上线前的硬性要求，“建议”表示可在技术选型后调整的默认值。正式生产前还需完成心理专业、隐私合规、未成年人保护、网络安全和目标地区法律评审。

## 1. 总体原则

1. **陪伴而非治疗**：聊天服务可以倾听、澄清和帮助拆小现实压力，不得自称治疗师，不得诊断或保证效果。
2. **原文与画像分离**：聊天、闪念和自定义主题属于原始敏感文本；日报画像只能使用经授权、可解释、低粒度的派生信号。
3. **最小上下文**：章节聊天只发送完成开场所需的已确认主题和结构化汇总，不发送全部闪念、完整选择轨迹或隐藏潮位。
4. **授权不捆绑**：提供服务所需处理、跨会话保存、日报个性化、人工质检和模型训练必须分别授权。一个授权不得推导出另一个授权。
5. **安全路由确定性**：地区危机资源来自人工维护并定期核验的配置，不由语言模型临时生成电话号码、机构名或营业时间。
6. **可退出与可删除**：用户可随时停止聊天；不保存也能完成章节；删除不以继续使用、订阅或解释原因为前提。
7. **不做隐性心理评分**：后端可以有内容排序权重，但不得向前端返回心理健康分数、人格结论、疗效分、风险保证或四维精确值。

## 2. API 约定

- 基础路径：`/v1`
- 编码：UTF-8 JSON；流式聊天使用 `text/event-stream`
- 时间：ISO 8601 UTC，例如 `2026-07-18T02:30:00Z`
- 标识符：客户端可生成不含个人信息的 `client_request_id` 和 `client_message_id` 用于去重；服务端生成不可猜测的 `request_id`、`session_id`、`message_id`。不得把手机号、邮箱或设备广告标识符放进 ID
- 幂等：生成日报、发送反馈和删除操作应支持 `Idempotency-Key`
- 鉴权：可匿名体验时使用短期匿名令牌；登录账号使用正常会话令牌。匿名令牌不得跨应用追踪用户
- 日志：请求体、SSE `delta`、Authorization、原始文本和地区资源联系方式不得进入普通访问日志
- 错误响应统一包含 `request_id`、稳定的 `code`、可本地化的 `message`、`retryable`，不得回显用户原文

## 3. 情绪陪伴聊天

### 3.1 创建或发送消息

`POST /v1/chat/stream`

浏览器端使用 `fetch` 发送 POST 并读取 SSE 响应。请求示例：

```json
{
  "client_request_id": "creq_01",
  "session_id": null,
  "message": {
    "client_message_id": "cm_01",
    "text": "我现在有点累，不知道从哪里开始。"
  },
  "mode": "chapter",
  "locale": "zh-CN",
  "region_code": "HK",
  "preferences": {
    "support_mode": "listen_first",
    "allow_suggestions": true
  },
  "context": {
    "confirmed_theme": "我想知道，为什么明明很累却不敢停下来",
    "choice_summary": {
      "pause_or_small_step_bucket": "some"
    },
    "report_id": null
  },
  "consent": {
    "service_processing": true,
    "use_chapter_context": true,
    "retain_conversation": false,
    "use_for_profile": false,
    "use_for_training": false,
    "policy_version": "2026-07-18"
  }
}
```

字段规则：

| 字段 | 要求 |
| --- | --- |
| `client_request_id` | 每次发送唯一，用于网络重试去重；不得包含用户内容或身份信息 |
| `session_id` | 首条消息可为 `null`；后续消息复用 `meta` 返回的服务端 ID |
| `message.text` | 必填，去除首尾空白后 1–400 字符；服务端再次校验，不因超长而截断后静默发送 |
| `mode` | `standalone`、`chapter` 或 `report` |
| `region_code` | 仅国家或地区级代码；优先使用用户明确选择或系统地区，不上传精确位置 |
| `preferences.support_mode` | `listen_first`、`help_me_break_it_down` 或 `balanced`；模型必须尊重“不需要建议” |
| `context.confirmed_theme` | 仅 `chapter` 且 `use_chapter_context=true` 时允许；不得用原始闪念替代 |
| `choice_summary` | 只能发送白名单化的桶化信号，不发送每张卡答案、四维数值或后台分数 |
| `context.report_id` | 仅从日报进入聊天时使用；服务端按 ID 获取已生成日报，不让客户端重复提交整份报告 |
| `consent` | 是当次权限快照，服务端必须与同版本授权账本核对；客户端字段不能自行扩大已有授权 |

`retain_conversation=false` 时，服务端仍可在当前会话的短期加密缓存中保存上下文，但不得写入长期会话历史、画像或训练队列。

### 3.2 SSE 事件

事件顺序通常为 `meta` → `delta`（零到多条）→ `done`。检测到需暂停普通陪聊的风险时，可发送 `safety` 并直接 `done`；流中失败发送 `error` 后结束。

```text
event: meta
data: {"request_id":"req_01","session_id":"chat_01","assistant_message_id":"am_01","session_expires_at":"2026-07-19T02:30:00Z"}

event: delta
data: {"assistant_message_id":"am_01","text":"听起来你已经撑了一段时间。"}

event: delta
data: {"assistant_message_id":"am_01","text":"此刻更需要先被听见，还是一起把眼前的事拆小一点？"}

event: done
data: {"assistant_message_id":"am_01","finish_reason":"stop","safety_level":"none"}
```

安全路由示例：

```text
event: safety
data: {"safety_level":"urgent","action":"pause_and_show_resources","resource_set_id":"hk.zh-Hant.v3","support_copy":"我们先把安全放在最前面。"}

event: done
data: {"assistant_message_id":"am_02","finish_reason":"safety_redirect","safety_level":"urgent"}
```

事件字段：

| 事件 | 必填字段 | 客户端行为 |
| --- | --- | --- |
| `meta` | `request_id`、`session_id`、`assistant_message_id`、`session_expires_at` | 建立本次流状态；不显示为消息 |
| `delta` | `assistant_message_id`、`text` | 按顺序追加；不得把 Markdown HTML 直接当作可信 HTML 注入 |
| `safety` | `safety_level`、`action`、`resource_set_id`、`support_copy` | 立即停止普通输入与奖励反馈，丢弃同一消息尚未展示的普通 `delta`，进入安全面板 |
| `done` | `finish_reason`、`safety_level` | 结束加载态；`safety_level` 不展示为用户分数 |
| `error` | `code`、`message`、`retryable` | 结束加载态；提供重试或退出，不伪造“机器人回复” |

允许的 `finish_reason`：`stop`、`safety_redirect`、`content_blocked`、`length`、`server_error`、`client_cancelled`。

`support_copy` 必须来自已审校、版本化的安全内容库，不得由对话模型临时生成。若 `error` 出现在部分 `delta` 之后，客户端需把已显示内容标记为“回复未完成”，不能当作完整建议。

### 3.3 流式安全要求

- 服务端必须在生成前做一次风险路由，避免明确的即时危险文本先收到普通建议，再被后置检测打断。
- 生成过程中仍需做增量输出检查。若风险升级，发送 `safety`，停止剩余模型输出并以 `safety_redirect` 结束。
- 前端点击“我现在需要紧急帮助”不需要等待模型判断，可直接进入 `urgent` 路径并请求地区资源。
- 模型或分类器超时不能当作“无风险”。无法完成安全检查时，聊天应温和失败并保留显式紧急帮助入口。
- 不得在危机路径展示满潮、奖励、连续签到、付费墙、抽卡次数或“恭喜完成”。
- 自动分类无法证明用户安全；`none` 仅表示本次文本未检测到相关信号。

### 3.4 `safety_level`

| 级别 | 含义（仅作路由，不是诊断） | 产品动作 |
| --- | --- | --- |
| `none` | 未检测到需要特殊路由的信号 | 继续普通陪伴；仍保留紧急帮助入口 |
| `elevated` | 明显痛苦、绝望或含糊风险，但没有足够信息判断即时危险 | 使用简短、非评判的支持语气；可邀请联系可信任对象；避免大量建议 |
| `urgent` | 可能涉及当前自伤、伤人或无法保证当下安全 | 暂停普通陪聊，显示经核验的地区资源和“联系身边的人”路径 |
| `imminent` | 明确表达正在发生、近期计划、手段或时间点等即时危险线索 | 立即停止普通生成，优先当地紧急服务；界面保持简短清晰 |

不确定但可能为高风险时，路由应选择更保护性的界面，同时避免向用户宣称“系统判断你处于某种状态”。

### 3.5 地区危机资源

`GET /v1/safety/resources?region_code=HK&locale=zh-Hant`

响应至少包含：

```json
{
  "resource_set_id": "hk.zh-Hant.v3",
  "region_code": "HK",
  "locale": "zh-Hant",
  "region_source": "user_selected",
  "resources": [
    {
      "resource_id": "local_emergency",
      "kind": "emergency_service",
      "label": "当地紧急服务",
      "action": {
        "type": "call",
        "value": "<verified-region-number>"
      },
      "availability": "由人工核验配置提供"
    }
  ],
  "fallback_copy": "如果你或他人正处于即时危险，请联系当地紧急服务，或请一位可信任的人立即来到身边。",
  "verified_at": "2026-07-01T00:00:00Z",
  "expires_at": "2026-10-01T00:00:00Z"
}
```

示例中的联系方式是占位符，不得用于生产。资源服务必须满足：

- 号码、机构、服务语言、开放时间和适用人群均来自版本化人工配置；应用资源服务按地区与语言选择 `resource_set_id`，模型既不能选择资源集，也不能编写资源内容。
- 资源配置必须有负责人、核验日期和到期时间；过期配置进入告警，不能无声继续使用。
- 地区未知时不猜测号码，也不通过精确定位解决；先显示通用安全行动，并允许用户手动选择国家或地区。
- 客户端可缓存已签名配置以应对聊天服务故障，但必须遵循 `expires_at`。
- 资源页面不要求登录、不计次数、不含广告和付费转化。

### 3.6 失败状态

| HTTP / 流错误码 | 场景 | `retryable` | 前端处理 |
| --- | --- | --- | --- |
| `400 invalid_request` | 字段或枚举无效 | 否 | 保留输入供用户修改，不回显到日志 |
| `403 consent_required` | 缺少服务处理授权或权限快照不一致 | 否 | 解释所需用途；不默认勾选额外授权 |
| `413 message_too_long` | 超过长度限制 | 否 | 提示缩短，不静默截断 |
| `422 context_rejected` | 上下文含非白名单字段或疑似原始批量数据 | 否 | 降级为不带上下文的聊天，需用户确认后重发 |
| `429 rate_limited` | 请求过快 | 是 | 显示等待时间；紧急资源入口不受限流阻挡 |
| `503 model_unavailable` | 模型或供应商不可用 | 是 | 明确“暂时无法回应”，允许退出；不伪造回复 |
| `503 safety_check_unavailable` | 安全路由不可用 | 是 | 不进入普通模型生成；显示通用支持与紧急入口 |
| `504 stream_timeout` | 流式超时 | 是 | 停止加载并允许手动重试；不得自动重复上传原文 |

客户端取消流时必须关闭服务端生成任务；取消不应被记录为用户拒绝支持。

## 4. 今日潮汐日报

### 4.1 生成日报

`POST /v1/daily-reports:generate`

基础版请求：

```json
{
  "report_date": "2026-07-18",
  "timezone": "Asia/Hong_Kong",
  "locale": "zh-CN",
  "mode": "basic",
  "signal_source": "none",
  "signals": null,
  "consent": {
    "personalized_report": false,
    "policy_version": "2026-07-18"
  }
}
```

个性化版可从本机卡槽上传最小快照，或由服务端画像仓读取已授权信号：

```json
{
  "report_date": "2026-07-18",
  "timezone": "Asia/Hong_Kong",
  "locale": "zh-CN",
  "mode": "auto",
  "signal_source": "local_tide_cards",
  "signals": {
    "tide_cards": [
      {"card_id": "insight-0", "collected_at": "2026-07-17T08:00:00Z"},
      {"card_id": "grounding-1", "collected_at": "2026-07-18T01:20:00Z"}
    ]
  },
  "consent": {
    "personalized_report": true,
    "policy_version": "2026-07-18"
  }
}
```

约束：

- `signals` 只允许有效内置卡片 ID 与收藏时间，或画像仓中的等价聚合；不得包含短句副本、闪念、主题、聊天原文、文本嵌入、危机表达或四维章节分数。
- `mode=auto` 但授权关闭、信号不足、信号过期或来源不可解释时，必须降级为 `basic`。
- 生产版应定义“近期”窗口，建议使用滚动 30 天并做时间衰减；窗口必须写入响应的 `provenance`。
- 同一用户、日期、时区和信号版本的生成应幂等，避免刷新页面得到互相矛盾的“今日判断”。

响应示例：

```json
{
  "report_id": "report_01",
  "report_date": "2026-07-18",
  "mode": "personalized",
  "headline": "今天适合把步子放稳一点，先照顾身体和边界。",
  "basis": [
    {"code": "recent_grounding_cards", "label": "近期更常为暂停留位置"},
    {"code": "grounding_cards_more_frequent", "label": "安住潮笺出现较多"}
  ],
  "summary": "这份日报把建议放在减速、边界和身体信号上；它不是对你的固定定义。",
  "suggestions": [
    {"category": "节奏", "text": "给今天安排一个明确停点，到了就先离开正在做的事。"},
    {"category": "身体", "text": "喝水、松开肩膀，再确认自己是否真的需要继续硬撑。"},
    {"category": "边界", "text": "面对临时请求，先说“让我看一下安排”，不必立刻答应。"}
  ],
  "quote": "先让脚底找到地面，答案可以晚一点来。",
  "provenance": {
    "signal_window_days": 30,
    "used_signal_types": ["tide_card_type"],
    "excluded_signal_types": ["notes", "chat_text", "hidden_tide_values", "safety_events"],
    "content_version": "daily.zh-CN.v4"
  },
  "feedback_token": "feedback_01",
  "expires_at": "2026-07-20T00:00:00Z"
}
```

响应不得包含：内部权重、置信百分比、心理风险分、人格标签、诊断语言、四维精确值或“系统比用户更了解自己”的表述。

### 4.2 日报反馈

`POST /v1/daily-reports/{report_id}/feedback`

```json
{
  "feedback_token": "feedback_01",
  "value": "not_me",
  "consent": {
    "use_for_report_tuning": true,
    "policy_version": "2026-07-18"
  }
}
```

`value` 只能是 `helpful`、`not_me` 或 `dismissed`。规则如下：

- `not_me` 只降低对应内容来源或表达方式的权重，不得推断用户否认问题、不配合或存在某种心理特征。
- 未授权调优时，前端仍可显示“已收到”，但反馈不得写入画像；可以只保留当前页面状态。
- 反馈不改变四股潮向、不触发奖励、不用于危机判定、不用于广告定向。

## 5. 原始文本与画像分离

生产数据至少拆成下列逻辑与访问域；不得只靠同一张表中的布尔字段模拟隔离。

| 数据域 | 内容 | 允许用途 | 禁止用途 |
| --- | --- | --- | --- |
| 会话原文域 | 当前聊天消息、经授权传入的确认主题 | 当前会话回复与安全路由 | 默认长期画像、日报、广告、训练 |
| 短期上下文域 | 白名单化章节摘要、会话内摘要或临时嵌入 | 当前会话连贯性 | 跨会话追踪、固定人格标签 |
| 画像信号域 | 潮笺类型、明确偏好、日报反馈的低粒度权重 | 经授权的日报个性化 | 保存原文片段、诊断标签、危机内容 |
| 内容域 | 预审的日报建议、原创短句、回复策略 | 生成与版本管理 | 混入用户原文 |
| 安全配置域 | 地区资源、路由规则版本 | 危机支持界面 | 营销、用户分群 |
| 运维日志域 | 请求 ID、耗时、状态码、模型版本 | 可靠性与安全监控 | 记录消息体、SSE 文本或联系方式 |
| 授权账本域 | 授权项、版本、时间、撤回记录 | 证明和执行用户选择 | 个性化内容或模型训练样本 |

额外要求：

- 所有域均视为个人数据或潜在敏感数据，采用传输与静态加密、最小权限和访问审计。
- 画像信号必须带 `source_type`、`source_version`、`created_at`、`expires_at` 和授权版本，支持解释、过期和删除。
- 不建立“抑郁、焦虑、依恋类型、治疗依从性”等诊断或准诊断标签。
- 不把危机表达、紧急帮助点击或安全等级用于日报、推荐、奖励、定价、留存运营或广告。
- 如果供应商需要接收聊天原文，合同与技术配置必须保证不用于供应商训练、不开启跨客户日志，并遵循本产品更短的保留期限。

## 6. 默认保留策略

以下是 V0.4 上线前应采用的隐私优先默认值。若目标地区法律要求不同，只能缩短或在充分说明后调整；不得通过模糊“改善服务”无限期保存。

| 数据 | 默认保留 | 用户控制 |
| --- | --- | --- |
| 未选择保存的聊天原文 | 会话短期加密缓存；用户结束并删除时立即清除，异常断开时最迟 24 小时自动过期；不进入备份 | 结束对话、删除会话 |
| 经授权保存的会话 | 默认关闭；开启后由产品明确显示期限，建议不超过 30 天 | 查看、导出、单条或全部删除、关闭后续保存 |
| 临时摘要或嵌入 | 与来源会话同寿命或更短 | 删除来源会话时同步删除 |
| 云端潮笺类型与日报画像信号 | 默认本地；用户开启个性化同步后使用滚动 30 天窗口 | 关闭个性化、查看来源、删除全部画像信号 |
| 生成的当日日报 | 服务端缓存最多 48 小时；V0.4 不提供历史日报 | 删除当日日报或全部数据 |
| 日报反馈 | 未授权时不持久化；授权调优后最多 30 天 | 撤回调优授权并删除反馈 |
| 不含原文的安全路由与运维元数据 | 最多 30 天；高层聚合可去标识后另行评审 | 随账号数据删除；法定安全记录除外并单独说明 |
| 未来回响 | 当前原型仅本机，保留至用户删除 | 单条或全部删除；清理网站数据 |
| 授权账本 | 仅保留证明授权与撤回所需的最小记录，期限按地区法规配置 | 可查看；不得用于画像或训练 |

服务端不得把“删除”解释为仅隐藏。主存储和缓存建议在 24 小时内完成删除；不可在线恢复的加密备份最迟 30 天自然淘汰，并保证删除后不会从备份重新写回生产画像。

## 7. 删除、导出与撤回

建议端点：

- `DELETE /v1/chat/sessions/{session_id}`：删除会话原文、临时摘要和嵌入。
- `DELETE /v1/me/profile-signals`：删除日报个性化信号和反馈权重，不删除本机卡槽。
- `DELETE /v1/daily-reports/{report_id}`：删除服务端日报缓存。
- `POST /v1/me/data-deletions`：提交 `chat`、`profile`、`reports` 或 `all` 范围的幂等删除任务。
- `GET /v1/me/data-export`：导出用户可读的数据、来源、授权和到期时间，不导出模型内部安全规则。

删除任务返回 `deletion_job_id`、范围和预计完成时间。撤回个性化或训练授权后，新的请求立即停止相关用途；历史数据按对应删除流程清除。服务端删除不能代替本机 `localStorage` 清理，客户端必须同时提供清空卡槽和未来回响的入口。

## 8. 训练、质检与第三方模型授权

- `service_processing` 只允许为用户生成当次回复，不等于保存、人工查看、画像、训练或供应商训练。
- `use_for_training` 默认 `false`，必须是与服务使用分离、未预选、可撤回的明确选择；拒绝不影响聊天、危机资源或基础日报。
- “改进服务”“个性化体验”不能作为模型训练的替代授权文案。人工质检也需与训练分开说明和授权。
- 即使用户选择训练，危机表达、紧急帮助会话、未成年人数据、直接身份信息、精确位置和第三方私密信息默认排除。
- 入选训练前必须完成去标识、自动与人工敏感信息检查、来源与授权版本记录，并允许按用户撤回追踪删除尚未固化的样本。
- 第三方模型供应商必须配置零训练和最短保留；若供应商无法提供相应合同与技术保证，不得向其发送聊天原文。
- 训练授权不得通过奖励潮笺、解锁功能、连续签到、折扣或危机支持制造压力。

## 9. 上线前验收清单

### 聊天

- 流式取消、超时、重复请求和供应商故障不会生成重复消息或伪造回复。
- “只想被听见”会抑制建议；章节上下文关闭后请求中确实不含主题与选择汇总。
- 会话结束和 24 小时异常过期均能验证原文、摘要和嵌入已删除。
- 访问日志、错误追踪和分析平台中检索不到聊天原文。

### 安全

- `none` 不被展示成“安全认证”；`urgent` 与 `imminent` 会在模型普通输出前进入安全路径。
- 地区未知、配置过期、资源 API 故障和客户端离线均有不编造号码的降级方案。
- 紧急资源不受登录、限流、订阅、次数或章节进度阻挡。
- 每个目标地区的资源均有负责人、最近核验时间和下次到期提醒。

### 日报与画像

- 无授权、无信号和信号不足时稳定降级为基础日报。
- 响应能解释使用了哪些信号类型，也能证明没有使用聊天原文、隐藏潮位和安全事件。
- `not_me` 只调整内容权重；前端和数据仓均不产生负面人格标签。
- 删除画像后，下一份日报不再继承旧信号。

### 授权与供应商

- 服务处理、保存、个性化、人工质检和训练五类授权可分别开关与撤回。
- 第三方模型、分析和错误追踪服务均完成数据流审计，默认不接收无关原文。
- 产品内说明与真实保留期限一致；不能继续使用“本地、不上传”文案后再静默接入后端。

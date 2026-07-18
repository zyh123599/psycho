# 心潮心理画像 API v1

本文档面向 App/网页前端开发。服务端运行后，Swagger、ReDoc 和 OpenAPI JSON 分别位于
`/docs`、`/redoc` 和 `/openapi.json`。

## 1. 约定

- 本地 Base URL：`http://127.0.0.1:8000`
- API 前缀：`/api/v1`
- 分析请求：`multipart/form-data`
- 普通响应：`application/json; charset=utf-8`
- 日期时间：ISO 8601，服务端返回 UTC，例如 `2026-07-18T08:30:00Z`
- 每个响应都有 `X-Request-ID`；前端报错时应连同它一起上报。
- `payload` 未知字段会被拒绝，前端应按 `schema_version` 做兼容。

如果服务端配置了 `APP_API_KEYS`，所有分析请求还必须带：

```http
X-API-Key: <backend app api key>
```

这里不能使用上游 `OPENAI_API_KEY`。上游密钥永远只能保存在后端。正式移动 App 不应长期内置共享
API key，应由登录会话/JWT 或 API 网关完成用户级认证。

## 2. 端点一览

| 方法 | 路径 | 鉴权 | 是否调用模型 | 用途 |
| --- | --- | --- | --- | --- |
| `GET` | `/` | 否 | 否 | 服务和文档入口 |
| `GET` | `/api/v1/health/live` | 否 | 否 | 进程存活检查 |
| `GET` | `/api/v1/health/ready` | 否 | 否 | 本地模型配置就绪检查 |
| `GET` | `/api/v1/capabilities` | 否 | 否 | 前端查询模态、格式和大小限制 |
| `POST` | `/api/v1/profiles/analyze` | 按配置 | 是 | 生成一次性反思画像 |

`health/ready` 不访问中转站，因此不会产生模型费用；它只证明本地配置完整，不证明上游当前可用。

## 3. 查询能力

```http
GET /api/v1/capabilities
```

示例响应：

```json
{
  "schema_version": "1.0",
  "supported_modalities": ["text", "image", "app_signal", "voice_transcript"],
  "accepted_image_types": ["image/jpeg", "image/png", "image/webp"],
  "raw_audio_upload_supported": false,
  "max_images": 4,
  "max_image_bytes": 8388608,
  "max_text_chars": 30000,
  "max_request_bytes": 26214400
}
```

`voice_transcript` 表示由 App/其他合规转写服务生成的文本，不是原始音频。GPT-5.6 画像链路当前只直接接收
文本和图片，所以本 API v1 不接收音频文件。

## 4. 生成画像

```http
POST /api/v1/profiles/analyze
Content-Type: multipart/form-data; boundary=...
```

### 4.1 multipart 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `payload` | JSON 字符串 | 是 | `ProfileAnalyzePayload`，见下文 |
| `images` | File，可重复 0–4 次 | 否 | 顺序对应 `image_contexts.index`；JPEG/PNG/WebP |

不要手动设置带 boundary 的 `Content-Type`。浏览器或 Capacitor 的 `fetch` 会在发送 `FormData` 时自动生成。

### 4.2 完整 payload 示例（对应当前 V0.2 flow）

```json
{
  "consent": {
    "profile_generation": true,
    "ai_processing": true,
    "subject_is_requester": true,
    "media_rights_confirmed": true
  },
  "locale": "zh-CN",
  "client_request_id": "session-20260718-001",
  "analysis_focus": "梳理我在不确定和休息之间反复拉扯的模式",
  "texts": [
    {
      "source_id": "note:1",
      "source": "note",
      "content": "刚才又担心自己做得不够好",
      "observed_at": "2026-07-18T08:20:00Z"
    },
    {
      "source_id": "theme:1",
      "source": "theme",
      "content": "我想看看，为什么总担心自己做得不够好",
      "observed_at": null
    },
    {
      "source_id": "response:1",
      "source": "response",
      "content": "我其实已经很努力了",
      "observed_at": null
    }
  ],
  "signals": [
    {
      "source_id": "choice:1",
      "source": "card_choice",
      "name": "card_1_choice",
      "value": "先交出够用版",
      "context": "direction=right; 用户允许任务在够用处停止",
      "observed_at": null
    },
    {
      "source_id": "signal:rest",
      "source": "aggregated_signal",
      "name": "rest",
      "value": 3,
      "context": "V0.2 本次会话的隐藏聚合信号，不是心理量表分数",
      "observed_at": null
    },
    {
      "source_id": "action:1",
      "source": "selected_action",
      "name": "selected_action",
      "value": "release",
      "context": "离开屏幕两分钟，松开肩膀",
      "observed_at": null
    }
  ],
  "image_contexts": [
    {
      "index": 0,
      "source_id": "image:1",
      "description": "用户主动上传的一页手写日记，希望模型只读取文字和版面内容"
    }
  ]
}
```

### 4.3 payload 字段

#### ProfileAnalyzePayload

| 字段 | 类型 | 必填 | 限制/语义 |
| --- | --- | --- | --- |
| `consent` | `Consent` | 是 | 三个必需同意项必须为 `true` |
| `locale` | string | 否 | 默认 `zh-CN`，2–20 个字母/数字/连字符 |
| `client_request_id` | string/null | 否 | 1–64 字符；只用于客户端去重，不发送模型 |
| `analysis_focus` | string/null | 否 | 最多 1000 字符 |
| `texts` | `TextEntry[]` | 否 | 最多 30 项 |
| `signals` | `AppSignal[]` | 否 | 最多 100 项 |
| `image_contexts` | `ImageContext[]` | 否 | 图片语境；索引不能重复 |

`texts`、`signals`、`images` 至少存在一种。所有 `source_id` 必须在一次请求内唯一。

#### Consent

| 字段 | 类型 | 必填值 | 说明 |
| --- | --- | --- | --- |
| `profile_generation` | boolean | `true` | 用户同意生成本次画像 |
| `ai_processing` | boolean | `true` | 用户同意材料发往第三方 AI 端点 |
| `subject_is_requester` | boolean | `true` | 只允许用户分析自己 |
| `media_rights_confirmed` | boolean | 图片请求为 `true` | 用户确认有权处理图片内容 |

#### TextEntry

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source_id` | string | 是 | 证据 ID，建议 `note:1`、`response:1` |
| `source` | enum | 是 | `note`、`theme`、`response`、`journal`、`check_in`、`voice_transcript`、`other` |
| `content` | string | 是 | 1–6000 字符 |
| `observed_at` | ISO 8601/null | 否 | 输入产生时间 |

#### AppSignal

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source_id` | string | 是 | 建议 `choice:1`、`signal:rest` |
| `source` | enum | 是 | `card_choice`、`aggregated_signal`、`selected_action`、`check_in`、`questionnaire`、`app_interaction`、`other` |
| `name` | string | 是 | 1–100 字符 |
| `value` | string/number/boolean | 是 | 字符串最多 1000 字符，数值必须有限 |
| `context` | string/null | 否 | 最多 1000 字符；解释信号语义，避免模型把内部值当量表 |
| `observed_at` | ISO 8601/null | 否 | 信号产生时间 |

V0.2 的 `certainty/rest/connection/agency` 是叙事节奏信号，不是心理测评分数，必须在 `context` 中明确这一点。

#### ImageContext

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `index` | integer | 是 | `images` 文件数组的零基索引 |
| `source_id` | string | 是 | 建议 `image:1` |
| `description` | string | 是 | 1–1000 字符，说明用户希望图片提供什么语境 |

若未为某张图片提供 context，服务会分配 `image:N` 并注明“未提供额外图片语境”。提供 context 时，
其 `index` 必须存在。服务不接受图片 URL，避免后端请求任意网络地址。

### 4.4 图片处理

- 接受 JPEG、PNG、WebP；以 Pillow 检出的真实格式为准，不只信任文件名或 MIME。
- 默认最多 4 张、单张 8 MiB、单张最多 2000 万像素、整个请求 25 MiB。
- 动图拒绝处理。
- 图片自动纠正 EXIF 方向、限制最长边为 2048、转为 JPEG 并清除原始元数据。
- 系统提示禁止根据面部、身体、表情、穿着或人口特征推断情绪、人格、疾病或危险性。

### 4.5 curl 示例

仅文本：

```bash
curl --request POST 'http://127.0.0.1:8000/api/v1/profiles/analyze' \
  --header 'X-Request-ID: demo-text-001' \
  --form 'payload={"consent":{"profile_generation":true,"ai_processing":true,"subject_is_requester":true,"media_rights_confirmed":false},"locale":"zh-CN","texts":[{"source_id":"note:1","source":"note","content":"我反复检查同一件事，已经很累了","observed_at":null}],"signals":[],"image_contexts":[]}'
```

文本加图片（配置了后端鉴权时再加入 `--header 'X-API-Key: ...'`）：

```bash
curl --request POST 'http://127.0.0.1:8000/api/v1/profiles/analyze' \
  --header 'X-Request-ID: demo-image-001' \
  --form 'payload={"consent":{"profile_generation":true,"ai_processing":true,"subject_is_requester":true,"media_rights_confirmed":true},"locale":"zh-CN","texts":[{"source_id":"note:1","source":"note","content":"这页记录了我最近反复出现的想法","observed_at":null}],"signals":[],"image_contexts":[{"index":0,"source_id":"image:1","description":"用户自己的手写日记，只读取文字内容"}]}' \
  --form 'images=@./journal.jpg;type=image/jpeg'
```

## 5. 成功响应

HTTP `200`：

```json
{
  "schema_version": "1.0",
  "profile_id": "18db117e-25ca-4b26-88dc-8fbd8f3a846b",
  "request_id": "demo-text-001",
  "client_request_id": "session-20260718-001",
  "generated_at": "2026-07-18T08:30:00Z",
  "model": "gpt-5.6-sol",
  "modalities_used": ["text", "app_signal", "image"],
  "profile": {
    "analysis_status": "complete",
    "headline": "在高标准与休息需要之间寻找一个够用的停点",
    "summary": "本次材料显示，用户在不确定出现时倾向通过继续检查换取控制感，同时也开始为身体和休息留出位置。这个观察只适用于本次情境。",
    "current_state": [
      {
        "title": "当前有明显的耗竭感",
        "description": "用户直接描述了疲惫，并把休息作为本次想梳理的重点。",
        "evidence": [
          {"source_id": "note:1", "observation": "用户自述反复检查且已经很累"}
        ],
        "confidence": "high",
        "uncertainty": "尚不知道这种感受持续了多久，也不能由此推断临床状况。"
      }
    ],
    "recurring_patterns": [],
    "strengths_and_resources": [],
    "needs_and_preferences": [],
    "communication_preferences": ["先被具体理解，再讨论可行的一小步"],
    "gentle_actions": [
      {
        "title": "设定一次可见的停点",
        "action": "为当前任务预先写下最后一次检查的时间，之后暂停两分钟。",
        "rationale": "把“够用”变成可观察的边界，同时不要求一次改变整个习惯。"
      }
    ],
    "reflection_questions": ["当你决定再检查一次时，你最担心失去的是什么？"],
    "uncertainties": ["材料来自一次短会话，不能代表跨情境的稳定人格。"],
    "safety_notice": {
      "level": "not_indicated",
      "evidence": [],
      "message": "本次文字中没有出现明确的即时危险表达；这不等同于完成了安全评估。",
      "recommended_actions": []
    }
  },
  "usage": {
    "input_tokens": 1320,
    "output_tokens": 760,
    "total_tokens": 2080
  },
  "disclaimer": "此画像仅是基于本次用户主动提供材料的暂时性反思总结，不是心理测评、医疗诊断、治疗建议或危机评估，也不得用于就业、教育、保险、信贷、司法等高影响决策。"
}
```

### 5.1 枚举语义

`analysis_status`：

- `complete`：模型有足够材料形成有限、可引用的反思总结。
- `limited_by_evidence`：材料过少或相互矛盾；前端应突出 `uncertainties`，不要把空列表显示为结论。
- `safety_first`：存在明确危险用语或模型返回紧急支持提示；前端应优先显示 `safety_notice`。

`confidence` 只表示“当前结论被本次材料支持的程度”，不是统计概率或心理测量信度。
服务端会再次校验每条洞察中的 `evidence.source_id`；模型若引用请求中不存在的证据编号，整个响应会以
`502 invalid_model_output` 拒绝，不会把伪造证据交给前端。

`safety_notice.level`：

- `not_indicated`：未见明确即时危险表述，不等于安全评估通过。
- `check_in_recommended`：材料值得前端温和确认用户当前是否安全。
- `urgent_support_recommended`：前端应立即优先展示本地紧急/危机支持入口，不要等待画像动画结束。

## 6. 错误响应

统一格式：

```json
{
  "error": {
    "code": "invalid_payload",
    "message": "payload JSON 字段校验失败",
    "request_id": "demo-001",
    "details": [
      {
        "location": "consent.ai_processing",
        "message": "Input should be True",
        "error_type": "literal_error"
      }
    ]
  }
}
```

| HTTP | 常见 code | 前端处理 |
| --- | --- | --- |
| `401` | `unauthorized` | 清理无效会话/密钥，重新认证；不要自动重试 |
| `413` | `request_too_large`、`image_too_large`、`text_too_large` | 提示用户减少图片或文本 |
| `415` | `unsupported_image_type`、`animated_image_not_supported` | 要求换 JPEG/PNG/WebP 静态图 |
| `422` | `invalid_payload`、`media_consent_required`、`analysis_refused` | 定位字段或重新获取明确同意；不要静默修改同意值 |
| `429` | `model_rate_limited` | 读取界面状态后指数退避；避免重复点击 |
| `502` | `model_unavailable`、`model_request_failed`、`invalid_model_output` | 告知暂时不可用，可由用户主动重试 |
| `503` | `model_not_configured` | 开发/运维配置问题 |
| `504` | `model_timeout` | 保留本地输入，允许用户主动重试 |
| `500` | `internal_error` | 上报 `request_id`，不要展示服务器内部细节 |

画像 POST 可能已经产生上游费用。前端不应在连接中断后无限自动重试；建议只对 `429/502/504` 提供
显式“重试”按钮，并使用新的 `X-Request-ID`。生产环境若需要强幂等，应在网关/持久化任务层增加
`Idempotency-Key`，当前单进程 API 不宣称幂等。

## 7. 当前 V0.2 flow 到 API 的映射

| 前端字段 | API 字段 |
| --- | --- |
| `flow.notes[]` | `texts[]`, `source=note` |
| `flow.selectedTheme` | `texts[]`, `source=theme`，并可作为 `analysis_focus` |
| `flow.choices[]` | `signals[]`, `source=card_choice` |
| `flow.signals.certainty/rest/connection/agency` | `signals[]`, `source=aggregated_signal`；context 明确“不是量表分数” |
| `flow.responseAnswers[]` | `texts[]`, `source=response`；跳过项不发送 |
| `flow.selectedAction` | `signals[]`, `source=selected_action` |
| 语音转写 | `texts[]`, `source=voice_transcript` |
| 用户选取图片 | multipart `images` + `image_contexts[]` |

[`../examples/xinchao-api-client.js`](../examples/xinchao-api-client.js) 已实现上述转换和 `FormData` 请求。

## 8. 前端交互要求

1. 在上传前展示第三方 AI 处理说明，只有用户主动同意后才把三个必需同意字段设为 `true`。
2. 图片选择界面应让用户确认其中没有未获同意的第三方敏感内容，并填写用途语境。
3. 请求期间保留本地输入；失败后不要丢失文本，也不要后台无限重试。
4. 成功页先看 `analysis_status` 和 `safety_notice.level`，再渲染普通画像内容。
5. 每条洞察应展示 `confidence`、`uncertainty` 和可展开的 `evidence`，允许用户标记“不符合我”。
6. 不把画像保存为不可修改的永久人格标签，不基于结果做排序、定价、资格或其他高影响决策。
7. 不记录完整响应到分析 SDK、崩溃平台或普通访问日志。

## 9. CORS、网络与上线

- 本地浏览器原型默认允许 `http://localhost:4173` 和 `http://localhost:4174`。
- Capacitor 默认来源已包含 `capacitor://localhost`、`https://localhost`；实际发布 scheme/host 变化时同步修改
  `CORS_ORIGINS`。
- Android 已声明 `INTERNET` 权限，但生产服务器和上游中转站都必须使用 HTTPS。
- 当前配置中的远程 HTTP 中转站仅适合受控测试：明文链路会暴露模型密钥和心理数据。
- 在公网入口增加用户认证、速率限制、请求体限制、TLS、审计与告警；多 worker/多实例的限流和幂等应放在
  Redis/API 网关等共享基础设施中。
- 上线前确认中转站的数据留存、训练使用、跨境传输和删除政策，并在 App 隐私说明中披露。

## 10. 版本策略

- URL 主版本为 `/api/v1`。
- 响应 `schema_version` 当前为 `1.0`。
- v1 内新增可选字段属于兼容变化；删除字段、改变枚举语义或修改必填项需要升级 URL 主版本。
- 前端对未知可选字段应忽略，对未知 `analysis_status`/`safety_notice.level` 应走保守的通用提示。

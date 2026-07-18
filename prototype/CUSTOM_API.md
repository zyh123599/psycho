# 自定义模型 API 完整兼容契约

本文件描述心潮 V0.6 前端对用户自定义模型服务商的要求。它不是心潮自建的业务 API；当前应用没有后端。

## 1. 配置

「我的」页面保存以下结构到 `localStorage` 的 `xinchao.custom-api.v1`：

```json
{
  "baseUrl": "https://provider.example/v1",
  "apiKey": "由用户在本机填写",
  "model": "gpt-5.6-sol",
  "imageDetail": "high"
}
```

`imageDetail` 支持 `auto`、`low`、`high`。Base URL 不得带查询参数、URL fragment、用户名或密码。API Key 不应写入仓库、截图、日志或错误信息。

## 2. HTTP 端点

### `GET {baseUrl}/models`

用于「测试当前表单」，不会调用生成模型。

请求头：

```http
Accept: application/json
Authorization: Bearer <API_KEY>
```

兼容响应：

```json
{
  "object": "list",
  "data": [
    { "id": "gpt-5.6-sol", "object": "model" }
  ]
}
```

若 `data` 为空，前端只确认连接成功；若非空，会检查当前模型名是否存在。

### `POST {baseUrl}/chat/completions`

画像、陪伴对话与叙事生成都使用此端点。

请求头：

```http
Accept: application/json
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

共同请求骨架：

```json
{
  "model": "gpt-5.6-sol",
  "messages": [
    { "role": "system", "content": "任务边界与安全规则" },
    { "role": "user", "content": "任务内容或多模态内容数组" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "任务名称",
      "strict": true,
      "schema": { "type": "object", "additionalProperties": false }
    }
  }
}
```

服务商必须支持 OpenAI Chat Completions 风格的严格 JSON Schema。响应中的结构化 JSON 放在 `choices[0].message.content` 字符串中：

```json
{
  "id": "chatcmpl_example",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"reply\":\"…\"}"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 80
  }
}
```

前端也能解析 `message.content` 为 text parts 数组的兼容实现，以及完整包裹 JSON 的 Markdown code fence；仍建议直接返回纯 JSON 字符串。

## 3. 多模态画像任务

画像请求的第二条 message 使用内容数组：

```json
[
  {
    "type": "text",
    "text": "{\"fresh_evidence\":{\"texts\":[],\"signals\":[],\"image_contexts\":[]},\"previous_profile_context\":null}"
  },
  {
    "type": "image_url",
    "image_url": {
      "url": "data:image/png;base64,...",
      "detail": "high"
    }
  }
]
```

`fresh_evidence` 与 `previous_profile_context` 必须保持语义分离。图片存在时，模型结果至少要有一条 `multimodal_observations` 引用本次图片 source ID，否则客户端拒绝保存该画像。

画像 JSON：

```json
{
  "analysis_status": "sufficient",
  "headline": "一句可修正标题",
  "summary": "简短暂时性总结",
  "current_state": [
    {
      "title": "观察标题",
      "description": "观察说明",
      "confidence": "medium",
      "uncertainty": "不确定性",
      "evidence_source_ids": ["note:1"]
    }
  ],
  "recurring_patterns": [],
  "strengths_and_resources": [],
  "needs_and_preferences": [],
  "multimodal_observations": [
    {
      "source_ids": ["image:stable-id", "note:1"],
      "modality": "cross_modal",
      "observation": "只描述图片和文字中明确可见的内容",
      "contribution_to_profile": "该内容怎样温和地修正画像",
      "uncertainty": "不能由材料确定的部分"
    }
  ],
  "communication_preferences": ["偏好简洁回应"],
  "gentle_actions": [
    {
      "title": "一小步",
      "action": "一个具体低负担动作",
      "rationale": "为什么它与当前材料相符"
    }
  ],
  "reflection_questions": ["一个开放问题？"],
  "uncertainties": ["整体不确定性"],
  "safety_notice": {
    "level": "not_indicated",
    "message": ""
  }
}
```

约束：

- 四类 insight 数组各最多 4 项；
- `confidence` 为 `low`、`medium`、`high`；
- `multimodal_observations` 最多 8 项，`modality` 为 `image` 或 `cross_modal`；
- 不读取或推断人脸、表情、身体、衣着、年龄、性别、诊断或人格；
- `safety_notice.level` 为 `not_indicated`、`urgent_support_recommended` 或 `immediate_danger`。

## 4. 支持性对话任务

前端发送最近最多 10 条 `user` / `assistant` 消息，并在 system message 中附上经过压缩的可选画像上下文。模型返回：

```json
{
  "reply": "简洁、支持性回应",
  "suggested_prompts": ["可选的下一句"],
  "safety_notice": {
    "level": "not_indicated",
    "message": ""
  }
}
```

`suggested_prompts` 最多 3 条。出现自伤、伤人、计划、手段或即时危险时，必须停止普通陪聊并返回相应安全级别；心潮前端会显示真人支持路径。

## 5. 画像混合叙事任务

输入包含用户确认主题、可选文字画像上下文和六张卡的固定本地语义方向。模型返回：

```json
{
  "title": "章节标题",
  "intro": "章节引导",
  "cards": [
    {
      "speaker": "叙事向导 · 林岚",
      "role": "陪你换一个角度",
      "portrait": "岚",
      "tone": "guide",
      "prompt": "一个具体时刻的问题",
      "whisper": "不评判的补充句",
      "left": { "label": "左侧选择", "result": "中性结果描述" },
      "right": { "label": "右侧选择", "result": "中性结果描述" }
    }
  ]
}
```

`cards` 必须正好 6 项。`tone` 为 `guide`、`body`、`friend`、`standard`、`future`、`self`。模型只生成文案；潮位、信号、满潮阈值和收藏逻辑不发送给模型控制。

## 6. 错误格式

建议使用 OpenAI 风格错误：

```json
{
  "error": {
    "message": "Readable provider error",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

前端把 408、425、429 和 5xx 标为可重试；模型请求默认 130 秒超时，连接测试默认 15 秒。超时、取消、无效 JSON、模型 refusal、图片未形成观察都会显示明确错误并保留本地降级流程。

## 7. CORS 与 HTTPS

浏览器会先发送预检。服务商至少应返回：

```http
Access-Control-Allow-Origin: https://your-frontend.example
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Vary: Origin
```

本地开发可按需允许 `http://localhost:<port>`。若使用凭据头，不要在生产环境无条件反射任意 Origin。HTTPS 页面不能通过浏览器调用 HTTP API；这属于浏览器安全边界，纯前端代码无法绕过。

## 8. 数据与日志

- Key 只从本机配置读取并发给配置的 origin；请求使用 `credentials: omit`、`cache: no-store`、`referrerPolicy: no-referrer`；
- 心潮不保存原图和聊天原文，但模型服务商是否记录请求由服务商政策决定；
- 生产服务商应关闭不必要的正文日志、训练复用和长期保留，并提供 Key 撤销与用量限制；
- 不要把 Authorization、base64 图片、用户文本或完整模型响应写入浏览器控制台和服务日志。

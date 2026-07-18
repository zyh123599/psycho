# 心潮多模态画像与陪伴后端

独立的 FastAPI 服务，把 App 用户本人主动提供的文本、图片和结构化交互信号发送给
OpenAI 兼容的多模态模型，并返回经过 Pydantic v2 严格校验的非诊断性反思画像。
同时提供无会话存储的支持性对话端点，可按模式生成普通回复、章节卡或结构化反思报告。

本服务当前不使用数据库，不持久化原始输入，也不会把上游模型 API key 发给 App。

## 技术栈

- Python 3.12（由 `.python-version` 固定）
- uv（环境、依赖和锁文件管理）
- FastAPI
- Pydantic v2 / pydantic-settings
- OpenAI Python SDK（支持自定义 `base_url`）
- Pillow（图片格式校验、缩放、重编码和 EXIF 清除）

## 快速启动

```bash
cd backend
cp .env.example .env
# 编辑 .env，至少填写 OPENAI_BASE_URL、OPENAI_API_KEY、OPENAI_MODEL
uv sync --all-groups
uv run uvicorn psycho_backend.main:app --reload --host 127.0.0.1 --port 8000
```

打开：

- Swagger UI：<http://127.0.0.1:8000/docs>
- ReDoc：<http://127.0.0.1:8000/redoc>
- OpenAPI JSON：<http://127.0.0.1:8000/openapi.json>
- 存活检查：<http://127.0.0.1:8000/api/v1/health/live>
- 支持性对话：`POST http://127.0.0.1:8000/api/v1/companion/respond`

完整的请求字段、响应结构、错误码和前端接入说明见 [`docs/API.md`](docs/API.md)。
可直接复用的 V0.2 原型适配器见 [`examples/xinchao-api-client.js`](examples/xinchao-api-client.js)。

## 常用 uv 命令

```bash
uv sync --all-groups
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run uvicorn psycho_backend.main:app --host 127.0.0.1 --port 8000
```

`uv.lock` 应提交到版本库；`.venv/` 和包含真实密钥的 `.env` 已被忽略。

## 核心环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容端点，结尾 `/` 会自动移除 |
| `OPENAI_API_KEY` | 空 | 只保存在服务端 |
| `OPENAI_MODEL` | `gpt-5.6-sol` | 实际模型 ID，不使用不存在的 `gpt-5.6` 裸名称 |
| `OPENAI_API_MODE` | `chat_completions` | `chat_completions` 或 `responses` |
| `OPENAI_TIMEOUT_SECONDS` | `120` | 单次上游调用超时 |
| `OPENAI_MAX_RETRIES` | `2` | SDK 对可重试上游错误的重试次数 |
| `APP_API_KEYS` | 空 | 逗号分隔；非空时要求 `X-API-Key` |
| `CORS_ORIGINS` | 本地与 Capacitor 来源 | 逗号分隔的精确来源列表 |
| `MAX_IMAGES` | `4` | 每次最多图片数 |
| `MAX_IMAGE_BYTES` | `8388608` | 单张原始图片上限 |
| `MAX_TEXT_CHARS` | `30000` | 文本与信号的合计字符上限 |
| `MAX_CONCURRENT_ANALYSES` | `8` | 单进程并发上游调用上限 |

全部配置和示例值见 [`.env.example`](.env.example)。

## 安全与隐私边界

- 请求必须明确确认用户本人同意画像生成和第三方 AI 处理；禁止用本接口分析未同意的第三方。
- 对话请求必须单独确认本次 `ai_processing`；画像上下文是可选项，不能从服务处理授权推导出画像授权。
- 图片不接受远程 URL，避免 SSRF；文件会验证实际格式、限制像素、缩放并重编码，原 EXIF 不会传给模型。
- 请求体会按实际接收字节计数，未提供 `Content-Length` 的分块上传也受总大小限制。
- 系统提示禁止从脸、身体、表情、穿着或人口特征推断人格、心理疾病或危险性。
- 输出是当前材料的可修正假设，不是诊断、治疗、危机评估或永久人格标签。
- 日志只记录方法、路径、状态、耗时和请求 ID，不记录原始文本、图片、模型输出或 API key。
- 当前收到的中转站地址是明文 HTTP。开发配置可显式允许，但真实心理数据和密钥会缺少传输加密；
  上线前必须在中转站或受信任反向代理前配置 HTTPS，并核实第三方的数据保留政策。
- `APP_API_KEYS` 适合内部开发或服务间调用，不应作为发布到移动端后的唯一用户认证；正式 App 应使用
  用户会话/JWT、网关限流和服务端授权。
- 高精度关键词规则只负责在明确危险用语出现时升级前端提示，不是临床风险检测。正式上线仍需心理、
  安全、隐私合规和危机流程评审。

## 目录

```text
backend/
├── docs/API.md
├── examples/xinchao-api-client.js
├── src/psycho_backend/
│   ├── api.py
│   ├── companion_api.py
│   ├── companion_llm.py
│   ├── companion_prompts.py
│   ├── companion_schemas.py
│   ├── companion_service.py
│   ├── config.py
│   ├── image_processing.py
│   ├── llm.py
│   ├── main.py
│   ├── prompts.py
│   ├── safety.py
│   ├── schemas.py
│   └── service.py
└── tests/
```

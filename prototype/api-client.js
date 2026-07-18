/**
 * Direct browser client for a user-provided OpenAI-compatible endpoint.
 *
 * The endpoint, model name and API key are stored only in this browser's
 * localStorage. They are never bundled into the application source.
 */

export const API_SETTINGS_STORAGE_KEY = "xinchao.custom-api.v1"

export const DEFAULT_API_SETTINGS = Object.freeze({
  baseUrl: "",
  apiKey: "",
  model: "gpt-5.6-sol",
  imageDetail: "high"
})

const DEFAULT_MODEL_TIMEOUT_MS = 130_000
const DEFAULT_METADATA_TIMEOUT_MS = 15_000
const IMAGE_DETAILS = new Set(["auto", "low", "high"])

export class ApiError extends Error {
  constructor(message, {
    code = "api_error",
    status = null,
    retryable = false,
    requestId = null,
    details = null,
    cause
  } = {}) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.retryable = retryable
    this.requestId = requestId
    this.details = details
    if (cause !== undefined) this.cause = cause
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) {
    throw new ApiError("请先在“我的”中填写自定义 API 地址", {
      code: "api_settings_required"
    })
  }
  if (/[?#]/.test(raw)) {
    throw new ApiError("API 地址不能包含查询参数或片段", {
      code: "invalid_api_base_url"
    })
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch (cause) {
    throw new ApiError("API 地址格式无效", {
      code: "invalid_api_base_url",
      cause
    })
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new ApiError("API 地址必须是未内嵌凭据的 HTTP(S) 地址", {
      code: "invalid_api_base_url"
    })
  }
  return raw.replace(/\/+$/, "")
}

function normalizeModel(value) {
  const model = typeof value === "string" ? value.trim() : ""
  if (!model || model.length > 120 || /[\r\n]/.test(model)) {
    throw new ApiError("请填写有效的模型名称", { code: "invalid_model" })
  }
  return model
}

function normalizeSettings(value, { requireKey = true } = {}) {
  if (!isRecord(value)) {
    throw new ApiError("请先在“我的”中配置自定义 API", {
      code: "api_settings_required"
    })
  }
  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : ""
  if (requireKey && !apiKey) {
    throw new ApiError("请先在“我的”中填写 API Key", {
      code: "api_settings_required"
    })
  }
  return {
    baseUrl: normalizeBaseUrl(value.baseUrl),
    apiKey,
    model: normalizeModel(value.model),
    imageDetail: IMAGE_DETAILS.has(value.imageDetail) ? value.imageDetail : "high"
  }
}

function localStorageOrNull() {
  try {
    return globalThis.localStorage || null
  } catch (_error) {
    return null
  }
}

export function loadApiSettings() {
  const storage = localStorageOrNull()
  if (!storage) return { ...DEFAULT_API_SETTINGS }
  try {
    const parsed = JSON.parse(storage.getItem(API_SETTINGS_STORAGE_KEY) || "null")
    if (!isRecord(parsed)) return { ...DEFAULT_API_SETTINGS }
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model
        : DEFAULT_API_SETTINGS.model,
      imageDetail: IMAGE_DETAILS.has(parsed.imageDetail)
        ? parsed.imageDetail
        : DEFAULT_API_SETTINGS.imageDetail
    }
  } catch (_error) {
    return { ...DEFAULT_API_SETTINGS }
  }
}

export function saveApiSettings(value) {
  const settings = normalizeSettings(value)
  const storage = localStorageOrNull()
  if (!storage) {
    throw new ApiError("当前环境无法使用本地存储", {
      code: "storage_unavailable"
    })
  }
  try {
    storage.setItem(API_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (cause) {
    throw new ApiError("自定义 API 配置无法保存到本机", {
      code: "storage_unavailable",
      cause
    })
  }
  return { ...settings }
}

export function clearApiSettings() {
  const storage = localStorageOrNull()
  if (!storage) return false
  try {
    storage.removeItem(API_SETTINGS_STORAGE_KEY)
    return true
  } catch (_error) {
    return false
  }
}

export function hasApiSettings(value = loadApiSettings()) {
  try {
    normalizeSettings(value)
    return true
  } catch (_error) {
    return false
  }
}

function activeSettings(override) {
  return normalizeSettings(override || loadApiSettings())
}

function createRequestId(prefix = "client") {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function endpointUrl(baseUrl, path) {
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${baseUrl}${suffix}`
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function requestAbort(signal, timeoutMs) {
  const controller = new AbortController()
  let source = null
  const fromCaller = () => {
    if (controller.signal.aborted) return
    source = "caller"
    controller.abort()
  }
  if (signal?.aborted) fromCaller()
  else signal?.addEventListener?.("abort", fromCaller, { once: true })
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return
    source = "timeout"
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    didTimeOut: () => source === "timeout",
    cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener?.("abort", fromCaller)
    }
  }
}

function providerError(response, body, requestId) {
  const provider = isRecord(body?.error) ? body.error : {}
  const status = response?.status ?? null
  const message = typeof provider.message === "string"
    ? provider.message
    : `自定义 API 请求失败${status ? ` (${status})` : ""}`
  return new ApiError(message, {
    code: typeof provider.code === "string" ? provider.code : `http_${status || "error"}`,
    status,
    retryable: status !== null && retryableStatus(status),
    requestId,
    details: provider
  })
}

async function providerRequest(path, {
  settings: settingsOverride,
  method = "POST",
  body,
  signal,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS
} = {}) {
  if (typeof globalThis.fetch !== "function") {
    throw new ApiError("当前环境不支持网络请求", { code: "fetch_unsupported" })
  }
  const settings = activeSettings(settingsOverride)
  const requestId = createRequestId("xinchao")
  const abort = requestAbort(signal, timeoutMs)
  let response = null
  try {
    response = await globalThis.fetch(endpointUrl(settings.baseUrl, path), {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    })

    const text = await response.text()
    let parsed = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch (cause) {
        if (response.ok) {
          throw new ApiError("自定义 API 返回了无法解析的响应", {
            code: "invalid_response",
            status: response.status,
            retryable: true,
            requestId,
            cause
          })
        }
      }
    }
    if (!response.ok) throw providerError(response, parsed, requestId)
    if (!isRecord(parsed)) {
      throw new ApiError("自定义 API 返回了空响应", {
        code: "invalid_response",
        status: response.status,
        retryable: true,
        requestId
      })
    }
    return { body: parsed, settings, requestId }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    if (abort.didTimeOut()) {
      throw new ApiError("自定义 API 请求超时", {
        code: "client_timeout",
        status: response?.status ?? null,
        retryable: true,
        requestId,
        cause
      })
    }
    if (abort.signal.aborted || signal?.aborted || cause?.name === "AbortError") {
      throw new ApiError("请求已取消", {
        code: "client_aborted",
        status: response?.status ?? null,
        requestId,
        cause
      })
    }
    throw new ApiError("无法连接自定义 API；请检查地址、CORS 与网络", {
      code: "network_error",
      status: response?.status ?? null,
      retryable: true,
      requestId,
      cause
    })
  } finally {
    abort.cleanup()
  }
}

function strictResponseFormat(name, schema) {
  return {
    type: "json_schema",
    json_schema: { name, strict: true, schema }
  }
}

function stringArraySchema(maxItems = 6) {
  return {
    type: "array",
    items: { type: "string" },
    maxItems
  }
}

const INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    uncertainty: { type: "string" },
    evidence_source_ids: stringArraySchema(6)
  },
  required: ["title", "description", "confidence", "uncertainty", "evidence_source_ids"]
}

const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    analysis_status: { type: "string", enum: ["sufficient", "limited"] },
    headline: { type: "string" },
    summary: { type: "string" },
    current_state: { type: "array", items: INSIGHT_SCHEMA, maxItems: 4 },
    recurring_patterns: { type: "array", items: INSIGHT_SCHEMA, maxItems: 4 },
    strengths_and_resources: { type: "array", items: INSIGHT_SCHEMA, maxItems: 4 },
    needs_and_preferences: { type: "array", items: INSIGHT_SCHEMA, maxItems: 4 },
    multimodal_observations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_ids: stringArraySchema(4),
          modality: { type: "string", enum: ["image", "cross_modal"] },
          observation: { type: "string" },
          contribution_to_profile: { type: "string" },
          uncertainty: { type: "string" }
        },
        required: ["source_ids", "modality", "observation", "contribution_to_profile", "uncertainty"]
      }
    },
    communication_preferences: stringArraySchema(5),
    gentle_actions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          action: { type: "string" },
          rationale: { type: "string" }
        },
        required: ["title", "action", "rationale"]
      }
    },
    reflection_questions: stringArraySchema(4),
    uncertainties: stringArraySchema(6),
    safety_notice: {
      type: "object",
      additionalProperties: false,
      properties: {
        level: {
          type: "string",
          enum: ["not_indicated", "urgent_support_recommended", "immediate_danger"]
        },
        message: { type: "string" }
      },
      required: ["level", "message"]
    }
  },
  required: [
    "analysis_status", "headline", "summary", "current_state", "recurring_patterns",
    "strengths_and_resources", "needs_and_preferences", "multimodal_observations",
    "communication_preferences", "gentle_actions", "reflection_questions", "uncertainties",
    "safety_notice"
  ]
}

const COMPANION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    suggested_prompts: stringArraySchema(3),
    safety_notice: {
      type: "object",
      additionalProperties: false,
      properties: {
        level: {
          type: "string",
          enum: ["not_indicated", "urgent_support_recommended", "immediate_danger"]
        },
        message: { type: "string" }
      },
      required: ["level", "message"]
    }
  },
  required: ["reply", "suggested_prompts", "safety_notice"]
}

const NARRATIVE_CHOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    result: { type: "string" }
  },
  required: ["label", "result"]
}

const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    intro: { type: "string" },
    cards: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          role: { type: "string" },
          portrait: { type: "string" },
          tone: { type: "string", enum: ["guide", "body", "friend", "standard", "future", "self"] },
          prompt: { type: "string" },
          whisper: { type: "string" },
          left: NARRATIVE_CHOICE_SCHEMA,
          right: NARRATIVE_CHOICE_SCHEMA
        },
        required: ["speaker", "role", "portrait", "tone", "prompt", "whisper", "left", "right"]
      }
    }
  },
  required: ["title", "intro", "cards"]
}

function completionText(body) {
  const message = body?.choices?.[0]?.message
  if (!message) {
    throw new ApiError("模型响应缺少 message", { code: "invalid_response", retryable: true })
  }
  if (message.refusal) {
    throw new ApiError("模型拒绝了这次请求", {
      code: "model_refusal",
      details: message.refusal
    })
  }
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => typeof part === "string" ? part : part?.text)
      .filter((part) => typeof part === "string")
      .join("")
  }
  throw new ApiError("模型响应没有可读取的内容", {
    code: "invalid_response",
    retryable: true
  })
}

function parseStructuredCompletion(body) {
  let text = completionText(body).trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) text = fenced[1]
  try {
    const parsed = JSON.parse(text)
    if (!isRecord(parsed)) throw new Error("not an object")
    return parsed
  } catch (cause) {
    throw new ApiError("模型没有返回有效的结构化 JSON", {
      code: "invalid_model_output",
      retryable: true,
      cause
    })
  }
}

function boundedString(value, maxLength, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback
}

function validateProfile(profile, currentImageSourceIds) {
  if (!isRecord(profile) || !boundedString(profile.headline, 120) || !boundedString(profile.summary, 1200)) {
    throw new ApiError("模型返回的画像结构不完整", { code: "invalid_model_output" })
  }
  const observations = Array.isArray(profile.multimodal_observations)
    ? profile.multimodal_observations
    : []
  if (currentImageSourceIds.length > 0) {
    const referenced = observations.some((item) => (
      Array.isArray(item?.source_ids) && item.source_ids.some((id) => currentImageSourceIds.includes(id))
    ))
    if (!referenced) {
      throw new ApiError("模型未返回本次图片的多模态文字观察", {
        code: "missing_multimodal_observation",
        retryable: true
      })
    }
  }
  return profile
}

async function blobToDataUrl(value) {
  const blob = value?.file || value
  if (typeof Blob === "undefined" || !(blob instanceof Blob)) {
    throw new ApiError("图片不是有效文件", { code: "invalid_image" })
  }
  const type = blob.type || "application/octet-stream"
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${type};base64,${globalThis.btoa(binary)}`
}

function profileSystemPrompt() {
  return [
    "你是心潮的非诊断性反思画像助手。只返回符合给定 JSON Schema 的对象，并使用简体中文。",
    "只把 fresh_evidence 中的文本、交互信号和本次图片视为新证据。previous_profile_context 只是连续性参考，不是用户本次陈述，也不得作为第一人称证据引用。",
    "新证据与旧画像冲突时以新证据为准；保留仍有根据的既往多模态文字观察。不要输出流程说明，例如‘本次没有新增第一人称近况’、‘主要依据此前摘要’或‘继续保持开放’。",
    "图片只可读取用户主动提供的文字、作品内容、物体和明确语境；禁止从脸、表情、身体、衣着或外貌推断情绪、人格、诊断、年龄、性别或其他敏感属性。",
    "每个判断都应保持暂时、可修正、低负担；不得诊断、打分、给人格标签或声称治疗效果。图片输入存在时，multimodal_observations 必须明确引用对应 image source_id，并只保存文字化观察。",
    "如材料出现自伤、伤人或即时危险，设置 safety_notice；不要在普通画像里扩写危险细节。"
  ].join("\n")
}

function profileUserContent(payload, images, detail) {
  const imageContexts = Array.isArray(payload.image_contexts) ? payload.image_contexts : []
  const content = [{
    type: "text",
    text: JSON.stringify({
      task: "根据新证据更新一份可被用户纠正的连续画像。不要复述系统流程。",
      locale: payload.locale || "zh-CN",
      analysis_focus: payload.analysis_focus || "形成低负担、可修正的反思画像。",
      fresh_evidence: {
        texts: Array.isArray(payload.texts) ? payload.texts : [],
        signals: Array.isArray(payload.signals) ? payload.signals : [],
        image_contexts: imageContexts
      },
      previous_profile_context: payload.previous_profile_context || null
    })
  }]
  return Promise.all(images.map(async (image, index) => ({
    type: "image_url",
    image_url: {
      url: await blobToDataUrl(image),
      detail
    },
    _sourceId: image?.sourceId || imageContexts[index]?.source_id || `image:${index + 1}`
  }))).then((imageParts) => [
    ...content,
    ...imageParts.map(({ _sourceId, ...part }) => part)
  ])
}

export async function analyzeProfile({
  payload,
  images = [],
  signal,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS,
  settings: settingsOverride
} = {}) {
  if (!isRecord(payload)) {
    throw new ApiError("画像请求必须是对象", { code: "invalid_request" })
  }
  const settings = activeSettings(settingsOverride)
  const imageList = Array.from(images || [])
  const imageContexts = Array.isArray(payload.image_contexts) ? payload.image_contexts : []
  const currentImageSourceIds = imageList.map((image, index) => (
    image?.sourceId || imageContexts[index]?.source_id || `image:${index + 1}`
  ))
  const userContent = await profileUserContent(payload, imageList, settings.imageDetail)
  const { body, requestId } = await providerRequest("/chat/completions", {
    settings,
    signal,
    timeoutMs,
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: profileSystemPrompt() },
        { role: "user", content: userContent }
      ],
      response_format: strictResponseFormat("xinchao_reflective_profile", PROFILE_SCHEMA)
    }
  })
  const profile = validateProfile(parseStructuredCompletion(body), currentImageSourceIds)
  const previous = payload.previous_profile_context
  const modalities = new Set(Array.isArray(previous?.modalities_used) ? previous.modalities_used : [])
  if ((payload.texts || []).length > 0) modalities.add("text")
  if ((payload.signals || []).length > 0) modalities.add("app_signal")
  if (imageList.length > 0) modalities.add("image")
  return {
    schema_version: "2.0",
    profile_id: typeof previous?.profile_id === "string" ? previous.profile_id : createRequestId("profile"),
    request_id: body.id || requestId,
    client_request_id: payload.client_request_id || null,
    generated_at: new Date().toISOString(),
    model: settings.model,
    modalities_used: [...modalities],
    processed_image_source_ids: currentImageSourceIds,
    profile,
    usage: isRecord(body.usage) ? body.usage : null,
    disclaimer: "这是可修正的反思性内容，不是心理诊断、治疗建议或危机评估。"
  }
}

function companionSystemPrompt(request) {
  return [
    "你是心潮的支持性反思伙伴。使用简体中文，温和、简洁、不过度追问。只返回给定 JSON Schema。",
    "先回应用户此刻表达，再根据需要给一个低负担问题或微小选择。不得诊断、贴人格标签、声称治疗或替代专业支持。",
    "profile_context 是可修正的模型摘要，只能帮助调整表达，不得把它当作确定事实，也不要对用户说‘画像显示’。",
    "若出现自伤、伤人、计划、手段或即时危险，停止普通陪聊，将 safety_notice 标为 urgent_support_recommended 或 immediate_danger，并建议联系所在地紧急服务及能立即陪伴的可信任对象。",
    `当前模式：${request.mode || "standalone"}；画像上下文：${JSON.stringify(request.profile_context || null)}`
  ].join("\n")
}

export async function sendCompanionMessage(request, {
  signal,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS,
  settings: settingsOverride
} = {}) {
  if (!isRecord(request) || !Array.isArray(request.messages)) {
    throw new ApiError("陪伴请求结构无效", { code: "invalid_request" })
  }
  const settings = activeSettings(settingsOverride)
  const messages = request.messages.slice(-10).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: boundedString(message.content, 1200)
  })).filter((message) => message.content)
  const { body, requestId } = await providerRequest("/chat/completions", {
    settings,
    signal,
    timeoutMs,
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: companionSystemPrompt(request) },
        ...messages
      ],
      response_format: strictResponseFormat("xinchao_companion_reply", COMPANION_SCHEMA)
    }
  })
  const result = parseStructuredCompletion(body)
  if (!boundedString(result.reply, 1600) || !isRecord(result.safety_notice)) {
    throw new ApiError("模型返回的陪伴回复结构不完整", { code: "invalid_model_output" })
  }
  return {
    schema_version: "1.0",
    request_id: body.id || requestId,
    generated_at: new Date().toISOString(),
    model: settings.model,
    result
  }
}

export async function generateNarrative({
  theme,
  profileContext = null,
  locale = "zh-CN",
  signal,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS,
  settings: settingsOverride
} = {}) {
  const cleanTheme = boundedString(theme, 240)
  if (!cleanTheme) throw new ApiError("生成叙事前需要确认主题", { code: "invalid_request" })
  const settings = activeSettings(settingsOverride)
  const { body, requestId } = await providerRequest("/chat/completions", {
    settings,
    signal,
    timeoutMs,
    body: {
      model: settings.model,
      messages: [
        {
          role: "system",
          content: [
            "你是心潮的叙事向导编剧，只返回符合 JSON Schema 的简体中文内容。",
            "生成 6 张彼此推进的低负担情境选择卡：看见处境、注意身体、尝试连接、辨认内在标准、看向近期未来、把决定交还用户。",
            "画像只是可修正参考；用它调整场景和措辞，不得明说画像、推断诊断或人格，不得暗示某个选项更健康。左右选项都必须合理，允许用户选择‘两个都不像’。",
            "每张 prompt 聚焦一个具体时刻；label 尽量 10 字以内；result 描述选择而非评价。portrait 只用一个汉字，tone 六类各使用一次。",
            "不要写危机情境、治疗承诺、心理评分或会加重负担的命令。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            locale,
            confirmed_theme: cleanTheme,
            reflective_profile_context: profileContext,
            fixed_local_choice_semantics: [
              { card: 1, left: "再争取确定感", right: "接受够用并保留主动" },
              { card: 2, left: "先守进度、延后休息", right: "回应身体、短暂停下" },
              { card: 3, left: "先保留表达", right: "向可信任的人透露一点" },
              { card: 4, left: "继续服从内在高标准", right: "理解高标准并拿回一点选择" },
              { card: 5, left: "继续准备以回应未知", right: "为今天设边界、保留余力" },
              { card: 6, left: "多留时间理解", right: "先走一个很小的行动" }
            ]
          })
        }
      ],
      response_format: strictResponseFormat("xinchao_narrative_chapter", NARRATIVE_SCHEMA)
    }
  })
  const result = parseStructuredCompletion(body)
  if (!Array.isArray(result.cards) || result.cards.length !== 6) {
    throw new ApiError("模型返回的叙事卡数量不正确", { code: "invalid_model_output" })
  }
  return {
    schema_version: "1.0",
    request_id: body.id || requestId,
    generated_at: new Date().toISOString(),
    model: settings.model,
    result
  }
}

export async function testApiConnection({
  settings: settingsOverride,
  signal,
  timeoutMs = DEFAULT_METADATA_TIMEOUT_MS
} = {}) {
  const settings = activeSettings(settingsOverride)
  const { body } = await providerRequest("/models", {
    settings,
    method: "GET",
    signal,
    timeoutMs
  })
  const models = Array.isArray(body.data)
    ? body.data.map((item) => item?.id).filter((id) => typeof id === "string")
    : []
  return {
    ok: true,
    modelAvailable: models.length === 0 || models.includes(settings.model),
    models
  }
}

export async function getCapabilities() {
  return {
    max_images: 4,
    max_image_bytes: 8 * 1024 * 1024,
    accepted_image_types: ["image/jpeg", "image/png", "image/webp"]
  }
}

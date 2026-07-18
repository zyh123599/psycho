/**
 * 心潮 V0.2 flow -> 心理画像 API 的无框架浏览器/Capacitor 适配器。
 * 不要把 OPENAI_API_KEY 放进这个文件或任何 App 包中。
 */

export class ProfileApiError extends Error {
  constructor(message, { status, code, requestId, details } = {}) {
    super(message)
    this.name = "ProfileApiError"
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * @param {object} flow 当前 prototype/app.js 中的 flow
 * @param {{locale?: string, imageContexts?: Array<{description: string}>}} options
 */
export function buildProfilePayload(flow, options = {}) {
  const texts = []
  const signals = []

  for (const [index, note] of (flow.notes || []).entries()) {
    if (!note?.trim()) continue
    texts.push({
      source_id: `note:${index + 1}`,
      source: "note",
      content: note.trim(),
      observed_at: null,
    })
  }

  if (flow.selectedTheme?.trim()) {
    texts.push({
      source_id: "theme:1",
      source: "theme",
      content: flow.selectedTheme.trim(),
      observed_at: null,
    })
  }

  for (const [index, answer] of (flow.responseAnswers || []).entries()) {
    if (!answer || answer.skipped || !answer.text?.trim()) continue
    texts.push({
      source_id: `response:${index + 1}`,
      source: "response",
      content: answer.text.trim(),
      observed_at: null,
    })
  }

  for (const [index, choice] of (flow.choices || []).entries()) {
    if (!choice) continue
    signals.push({
      source_id: `choice:${index + 1}`,
      source: "card_choice",
      name: `card_${index + 1}_choice`,
      value: choice.label,
      context: `direction=${choice.direction}; ${choice.result || ""}`.trim(),
      observed_at: null,
    })
  }

  for (const [name, value] of Object.entries(flow.signals || {})) {
    signals.push({
      source_id: `signal:${name}`,
      source: "aggregated_signal",
      name,
      value,
      context: "心潮 V0.2 本次会话的隐藏叙事信号，不是心理量表分数",
      observed_at: null,
    })
  }

  if (flow.selectedAction) {
    signals.push({
      source_id: "action:1",
      source: "selected_action",
      name: "selected_action",
      value: flow.selectedAction,
      context: "用户在本次会话中主动选择的微行动",
      observed_at: null,
    })
  }

  const imageContexts = options.imageContexts || []
  return {
    consent: {
      profile_generation: true,
      ai_processing: true,
      subject_is_requester: true,
      media_rights_confirmed: imageContexts.length > 0,
    },
    locale: options.locale || navigator.language || "zh-CN",
    client_request_id: requestId(),
    analysis_focus: flow.selectedTheme || null,
    texts,
    signals,
    image_contexts: imageContexts.map((item, index) => ({
      index,
      source_id: `image:${index + 1}`,
      description: item.description,
    })),
  }
}

/**
 * @param {{
 *   baseUrl: string,
 *   payload: object,
 *   images?: Array<Blob | File>,
 *   backendApiKey?: string,
 *   timeoutMs?: number
 * }} options
 */
export async function analyzeProfile({
  baseUrl,
  payload,
  images = [],
  backendApiKey,
  timeoutMs = 130_000,
}) {
  const form = new FormData()
  form.append("payload", JSON.stringify(payload))
  images.forEach((image, index) => {
    const name = image instanceof File && image.name ? image.name : `image-${index + 1}.jpg`
    form.append("images", image, name)
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const headers = { "X-Request-ID": payload.client_request_id || requestId() }
  if (backendApiKey) headers["X-API-Key"] = backendApiKey

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/profiles/analyze`, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const error = body?.error || {}
      throw new ProfileApiError(error.message || `画像请求失败 (${response.status})`, {
        status: response.status,
        code: error.code,
        requestId: error.request_id || response.headers.get("X-Request-ID"),
        details: error.details,
      })
    }
    return body
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ProfileApiError("画像生成超时，请保留输入并让用户决定是否重试", {
        code: "client_timeout",
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/*
用法：

const payload = buildProfilePayload(flow, {
  locale: "zh-CN",
  imageContexts: selectedImages.map(() => ({ description: "用户主动选择的本次记录" })),
})

const result = await analyzeProfile({
  baseUrl: "https://api.example.com",
  payload,
  images: selectedImages,
})
*/

/**
 * Browser/Capacitor client for the Xinchao backend.
 *
 * The model provider is an implementation detail of the backend. This module
 * never accepts or sends provider credentials. Authentication for a deployed
 * app should be supplied by a user session or an API gateway.
 */

const API_PREFIX = "/api/v1"
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000"
const DEFAULT_METADATA_TIMEOUT_MS = 10_000
const DEFAULT_MODEL_TIMEOUT_MS = 130_000
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

let runtimeApiBaseUrl = null

/** A normalized error shape shared by every request in this module. */
export class ApiError extends Error {
  constructor(
    message,
    {
      code = "api_error",
      status = null,
      retryable = false,
      requestId = null,
      details = null,
      cause,
    } = {},
  ) {
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

function configuredBaseUrl() {
  const runtimeConfig = globalThis.__XINCHAO_CONFIG__
  const globalOverride =
    runtimeConfig && typeof runtimeConfig === "object" ? runtimeConfig.apiBaseUrl : null

  // Vite replaces this property at build time. The optional chain also keeps
  // the module importable in plain ESM test environments where env is absent.
  const viteBaseUrl = import.meta.env?.VITE_API_BASE_URL

  const explicitBaseUrl =
    runtimeApiBaseUrl ||
    globalOverride ||
    globalThis.__XINCHAO_API_BASE_URL__ ||
    viteBaseUrl
  if (explicitBaseUrl) return explicitBaseUrl

  const isNativeRuntime =
    globalThis.Capacitor?.isNativePlatform?.() === true ||
    globalThis.location?.protocol === "capacitor:" ||
    globalThis.location?.protocol === "ionic:"
  if (isNativeRuntime || import.meta.env?.PROD === true) {
    throw new ApiError("当前构建尚未配置后端 API 地址", {
      code: "api_base_url_required",
      retryable: false,
    })
  }
  return DEFAULT_API_BASE_URL
}

function normalizeBaseUrl(value) {
  const untrimmedBaseUrl = typeof value === "string" ? value.trim() : ""
  if (!untrimmedBaseUrl) {
    throw new ApiError("API 地址尚未配置", {
      code: "invalid_api_base_url",
      retryable: false,
    })
  }

  if (/[?#]/.test(untrimmedBaseUrl)) {
    throw new ApiError("API 地址不能包含查询参数或片段", {
      code: "invalid_api_base_url",
      retryable: false,
    })
  }
  if (untrimmedBaseUrl === "/") return "/"

  const baseUrl = untrimmedBaseUrl.replace(/\/+$/, "")
  if (baseUrl.startsWith("//")) {
    throw new ApiError("API 地址不能使用省略协议的跨域地址", {
      code: "invalid_api_base_url",
      retryable: false,
    })
  }
  if (baseUrl.startsWith("/")) return baseUrl

  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch (cause) {
    throw new ApiError("API 地址格式无效", {
      code: "invalid_api_base_url",
      retryable: false,
      cause,
    })
  }

  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new ApiError("API 地址必须是未内嵌凭据的 HTTP(S) 地址", {
      code: "invalid_api_base_url",
      retryable: false,
    })
  }
  return baseUrl
}

/**
 * Return the active backend origin/base path without a trailing slash.
 *
 * Resolution order:
 * 1. setApiBaseUrl (runtime, useful for native bootstrap code)
 * 2. globalThis.__XINCHAO_CONFIG__.apiBaseUrl
 * 3. globalThis.__XINCHAO_API_BASE_URL__
 * 4. VITE_API_BASE_URL
 * 5. http://127.0.0.1:8000 only in local development; native/production
 *    builds fail clearly until one of the options above is configured
 */
export function getApiBaseUrl() {
  return normalizeBaseUrl(configuredBaseUrl())
}

/** Set or clear an in-memory runtime override, without persisting it. */
export function setApiBaseUrl(baseUrl = null) {
  runtimeApiBaseUrl = baseUrl == null ? null : normalizeBaseUrl(baseUrl)
}

function endpointUrl(path, baseUrl) {
  const base = normalizeBaseUrl(baseUrl === undefined ? getApiBaseUrl() : baseUrl)
  let endpoint = path.startsWith("/") ? path : `/${path}`
  if (base === "/") return endpoint

  // Accept either an origin (https://api.example.com) or a versioned base
  // (https://api.example.com/api/v1) to make native deployment config less
  // error-prone.
  if (base.endsWith(API_PREFIX) && endpoint.startsWith(`${API_PREFIX}/`)) {
    endpoint = endpoint.slice(API_PREFIX.length)
  }
  return `${base}${endpoint}`
}

function createRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `client-${uuid}`
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function requestIdFrom(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value) ? value : createRequestId()
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function responseRequestId(response) {
  return response?.headers?.get?.("X-Request-ID") || null
}

function serverError(response, body) {
  const errorBody = isRecord(body?.error)
    ? body.error
    : isRecord(body)
      ? body
      : {}
  const status = Number.isInteger(response?.status) ? response.status : null
  const requestId = errorBody.request_id || responseRequestId(response)
  const retryable =
    typeof errorBody.retryable === "boolean"
      ? errorBody.retryable
      : status !== null && retryableStatus(status)

  return new ApiError(
    typeof errorBody.message === "string"
      ? errorBody.message
      : `请求失败${status === null ? "" : ` (${status})`}`,
    {
      code:
        typeof errorBody.code === "string"
          ? errorBody.code
          : status === null
            ? "request_failed"
            : `http_${status}`,
      status,
      retryable,
      requestId: typeof requestId === "string" ? requestId : null,
      details: Array.isArray(errorBody.details) ? errorBody.details : null,
    },
  )
}

function requestAbort(signal, timeoutMs) {
  if (typeof AbortController === "undefined") {
    throw new ApiError("当前环境不支持取消网络请求", {
      code: "abort_unsupported",
      retryable: false,
    })
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiError("请求超时时间必须是正数", {
      code: "invalid_timeout",
      retryable: false,
    })
  }

  const controller = new AbortController()
  let abortSource = null
  // Do not propagate a caller-supplied reason: it could contain sensitive
  // application state, and callers should always receive the same ApiError.
  const abortFromCaller = () => {
    if (controller.signal.aborted) return
    abortSource = "caller"
    controller.abort()
  }

  if (signal?.aborted) {
    abortFromCaller()
  } else {
    signal?.addEventListener?.("abort", abortFromCaller, { once: true })
  }

  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return
    abortSource = "timeout"
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    didTimeOut: () => abortSource === "timeout",
    cleanup() {
      clearTimeout(timeout)
      signal?.removeEventListener?.("abort", abortFromCaller)
    },
  }
}

async function requestJson(
  path,
  {
    method = "GET",
    headers = {},
    body,
    signal,
    timeoutMs,
    requestId = createRequestId(),
    baseUrl,
  },
) {
  if (typeof globalThis.fetch !== "function") {
    throw new ApiError("当前环境不支持网络请求", {
      code: "fetch_unsupported",
      retryable: false,
    })
  }

  const abort = requestAbort(signal, timeoutMs)
  let response = null

  try {
    response = await globalThis.fetch(endpointUrl(path, baseUrl), {
      method,
      headers: {
        Accept: "application/json",
        "X-Request-ID": requestId,
        ...headers,
      },
      body,
      signal: abort.signal,
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })

    let responseBody = null
    try {
      responseBody = await response.json()
    } catch (cause) {
      if (abort.signal.aborted || cause?.name === "AbortError") throw cause
      if (!response.ok) throw serverError(response, null)
      throw new ApiError("服务返回了无法解析的响应", {
        code: "invalid_response",
        status: response.status,
        retryable: true,
        requestId: responseRequestId(response),
        cause,
      })
    }

    if (!response.ok) throw serverError(response, responseBody)
    if (!isRecord(responseBody)) {
      throw new ApiError("服务返回了无效的响应结构", {
        code: "invalid_response",
        status: response.status,
        retryable: true,
        requestId: responseRequestId(response),
      })
    }

    if (abort.signal.aborted) {
      throw abort.signal.reason || new DOMException("Aborted", "AbortError")
    }
    return responseBody
  } catch (cause) {
    if (cause instanceof ApiError) throw cause

    if (abort.didTimeOut()) {
      throw new ApiError("请求超时，请保留当前输入并由用户决定是否重试", {
        code: "client_timeout",
        status: response?.status ?? null,
        retryable: true,
        requestId: responseRequestId(response),
        cause,
      })
    }
    if (abort.signal.aborted || signal?.aborted || cause?.name === "AbortError") {
      throw new ApiError("请求已取消", {
        code: "client_aborted",
        status: response?.status ?? null,
        retryable: false,
        requestId: responseRequestId(response),
        cause,
      })
    }
    throw new ApiError("无法连接到服务，请检查网络后再试", {
      code: "network_error",
      status: response?.status ?? null,
      retryable: true,
      requestId: responseRequestId(response),
      cause,
    })
  } finally {
    abort.cleanup()
  }
}

function imageFileName(image, index) {
  const extension =
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[image?.type] || "bin"
  // Deliberately avoid transmitting a local filename, which may contain
  // personal information and is not part of the backend contract.
  return `image-${index + 1}.${extension}`
}

/**
 * Generate a one-time reflective profile using multipart/form-data.
 * Content-Type is intentionally omitted so fetch can add the boundary.
 */
export async function analyzeProfile({
  payload,
  images = [],
  signal,
  timeoutMs = DEFAULT_MODEL_TIMEOUT_MS,
  baseUrl,
} = {}) {
  if (!isRecord(payload)) {
    throw new ApiError("画像 payload 必须是对象", {
      code: "invalid_request",
      retryable: false,
    })
  }
  if (typeof FormData === "undefined") {
    throw new ApiError("当前环境不支持图片或表单上传", {
      code: "form_data_unsupported",
      retryable: false,
    })
  }

  let serializedPayload
  try {
    serializedPayload = JSON.stringify(payload)
  } catch (cause) {
    throw new ApiError("画像 payload 无法序列化", {
      code: "invalid_request",
      retryable: false,
      cause,
    })
  }

  const form = new FormData()
  form.append("payload", serializedPayload)
  for (const [index, image] of Array.from(images || []).entries()) {
    if (typeof Blob !== "undefined" && !(image instanceof Blob)) {
      throw new ApiError(`第 ${index + 1} 张图片不是有效文件`, {
        code: "invalid_image",
        retryable: false,
      })
    }
    form.append("images", image, imageFileName(image, index))
  }

  return requestJson(`${API_PREFIX}/profiles/analyze`, {
    method: "POST",
    body: form,
    signal,
    timeoutMs,
    requestId: requestIdFrom(payload.client_request_id),
    baseUrl,
  })
}

/** Send one non-streaming companion turn as JSON. */
export async function sendCompanionMessage(
  request,
  { signal, timeoutMs = DEFAULT_MODEL_TIMEOUT_MS, baseUrl } = {},
) {
  if (!isRecord(request)) {
    throw new ApiError("陪伴请求必须是对象", {
      code: "invalid_request",
      retryable: false,
    })
  }

  let body
  try {
    body = JSON.stringify(request)
  } catch (cause) {
    throw new ApiError("陪伴请求无法序列化", {
      code: "invalid_request",
      retryable: false,
      cause,
    })
  }

  return requestJson(`${API_PREFIX}/companion/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
    timeoutMs,
    requestId: requestIdFrom(request.client_request_id),
    baseUrl,
  })
}

/** Fetch backend modality and upload limits without invoking a model. */
export async function getCapabilities({
  signal,
  timeoutMs = DEFAULT_METADATA_TIMEOUT_MS,
  baseUrl,
} = {}) {
  return requestJson(`${API_PREFIX}/capabilities`, {
    signal,
    timeoutMs,
    baseUrl,
  })
}

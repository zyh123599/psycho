import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.security import APIKeyHeader
from pydantic import ValidationError

from psycho_backend import __version__
from psycho_backend.config import Settings
from psycho_backend.errors import PublicError, invalid_payload
from psycho_backend.image_processing import ACCEPTED_CONTENT_TYPES
from psycho_backend.schemas import (
    CapabilitiesResponse,
    ErrorResponse,
    HealthResponse,
    InputModality,
    ProfileAnalyzePayload,
    ProfileResponse,
)
from psycho_backend.service import ProfileService

router = APIRouter(prefix="/api/v1")
api_key_header = APIKeyHeader(
    name="X-API-Key",
    scheme_name="AppApiKey",
    description=(
        "可选的服务端 API key。开发环境 APP_API_KEYS 为空时不校验；"
        "生产环境应改用用户会话令牌或网关鉴权，不能把上游模型密钥放进 App。"
    ),
    auto_error=False,
)


def settings_from(request: Request) -> Settings:
    return request.app.state.settings


def service_from(request: Request) -> ProfileService:
    return request.app.state.profile_service


async def require_api_key(
    request: Request,
    supplied_key: Annotated[str | None, Depends(api_key_header)],
) -> None:
    settings = settings_from(request)
    if not settings.api_keys:
        return
    if supplied_key is None or not any(
        secrets.compare_digest(supplied_key, expected) for expected in settings.api_keys
    ):
        raise PublicError(
            status_code=401,
            code="unauthorized",
            message="缺少或提供了无效的 X-API-Key",
        )


ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "后端鉴权失败"},
    413: {"model": ErrorResponse, "description": "文本、图片或请求体超过限制"},
    415: {"model": ErrorResponse, "description": "图片格式不受支持"},
    422: {"model": ErrorResponse, "description": "字段、同意范围或模型输入无效"},
    429: {"model": ErrorResponse, "description": "模型服务限流"},
    502: {"model": ErrorResponse, "description": "模型服务或模型输出异常"},
    503: {"model": ErrorResponse, "description": "模型服务尚未配置"},
    504: {"model": ErrorResponse, "description": "模型请求超时"},
}


@router.get(
    "/health/live",
    response_model=HealthResponse,
    tags=["Health"],
    summary="存活检查",
)
async def live(request: Request) -> HealthResponse:
    settings = settings_from(request)
    return HealthResponse(status="ok", service=settings.app_name, version=__version__)


@router.get(
    "/health/ready",
    response_model=HealthResponse,
    responses={503: ERROR_RESPONSES[503]},
    tags=["Health"],
    summary="配置就绪检查",
    description="只检查本地模型配置是否完整，不产生上游模型调用或费用。",
)
async def ready(request: Request) -> HealthResponse:
    settings = settings_from(request)
    if not settings.llm_is_configured:
        raise PublicError(
            status_code=503,
            code="model_not_configured",
            message="模型服务尚未配置",
        )
    return HealthResponse(
        status="ready",
        service=settings.app_name,
        version=__version__,
        model=settings.openai_model,
        api_mode=settings.openai_api_mode,
    )


@router.get(
    "/capabilities",
    response_model=CapabilitiesResponse,
    tags=["Metadata"],
    summary="查询前端可用能力和上传限制",
)
async def capabilities(request: Request) -> CapabilitiesResponse:
    settings = settings_from(request)
    return CapabilitiesResponse(
        supported_modalities=[
            InputModality.TEXT,
            InputModality.IMAGE,
            InputModality.APP_SIGNAL,
            InputModality.VOICE_TRANSCRIPT,
        ],
        accepted_image_types=sorted(ACCEPTED_CONTENT_TYPES),
        raw_audio_upload_supported=False,
        max_images=settings.max_images,
        max_image_bytes=settings.max_image_bytes,
        max_text_chars=settings.max_text_chars,
        max_request_bytes=settings.max_request_bytes,
    )


@router.post(
    "/profiles/analyze",
    response_model=ProfileResponse,
    responses=ERROR_RESPONSES,
    tags=["Profiles"],
    summary="从文本、图片和 App 信号生成一次性反思画像",
    description=(
        "请求必须使用 multipart/form-data。payload 是符合 ProfileAnalyzePayload 的 JSON 字符串；"
        "images 可重复上传 0 到 4 个文件，顺序与 payload.image_contexts.index 对应。"
        "服务不持久化原始输入，也不会把上游模型 API key 暴露给客户端。"
    ),
)
async def analyze_profile(
    request: Request,
    payload: Annotated[
        str,
        Form(
            description=(
                "ProfileAnalyzePayload JSON 字符串。完整 Schema、示例和字段语义见 docs/API.md。"
            )
        ),
    ],
    service: Annotated[ProfileService, Depends(service_from)],
    _authorized: Annotated[None, Depends(require_api_key)],
    images: Annotated[
        list[UploadFile] | None,
        File(description="可选图片数组；仅 JPEG、PNG、WebP，不接受远程 URL"),
    ] = None,
) -> ProfileResponse:
    settings = settings_from(request)
    content_length = request.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > settings.max_request_bytes
    ):
        raise PublicError(
            status_code=413,
            code="request_too_large",
            message=f"请求体不能超过 {settings.max_request_bytes} 字节",
        )
    if len(payload.encode("utf-8")) > settings.max_payload_json_bytes:
        raise PublicError(
            status_code=413,
            code="payload_too_large",
            message=f"payload 不能超过 {settings.max_payload_json_bytes} 字节",
        )

    try:
        parsed = ProfileAnalyzePayload.model_validate_json(payload)
    except ValidationError as exc:
        details = [
            {
                "location": ".".join(str(part) for part in error["loc"]),
                "message": error["msg"],
                "error_type": error["type"],
            }
            for error in exc.errors(include_url=False)
        ]
        raise invalid_payload("payload JSON 字段校验失败", details=details) from exc
    except ValueError as exc:
        raise invalid_payload("payload 必须是有效的 JSON 对象") from exc

    return await service.analyze(
        payload=parsed,
        uploads=images or [],
        request_id=request.state.request_id,
    )

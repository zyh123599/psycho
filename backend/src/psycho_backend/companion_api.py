from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from psycho_backend.api import ERROR_RESPONSES, require_api_key
from psycho_backend.companion_schemas import CompanionRequest, CompanionResponse
from psycho_backend.companion_service import CompanionService

router = APIRouter(prefix="/api/v1")


def companion_service_from(request: Request) -> CompanionService:
    return request.app.state.companion_service


@router.post(
    "/companion/respond",
    response_model=CompanionResponse,
    responses=ERROR_RESPONSES,
    tags=["Companion"],
    summary="生成一次无持久化的支持性对话回复",
    description=(
        "接收最近 1 到 8 条消息和可选的结构化画像上下文。必须显式同意 ai_processing；"
        "发送画像上下文时还必须显式同意 use_profile；"
        "普通请求异步调用配置的模型，明确危机用语由本地规则直接升级且不发送上游。"
        "服务端不创建会话、不持久化消息，并要求上游 store=false。"
    ),
)
async def respond_to_companion(
    request: Request,
    response: Response,
    payload: CompanionRequest,
    service: Annotated[CompanionService, Depends(companion_service_from)],
    _authorized: Annotated[None, Depends(require_api_key)],
) -> CompanionResponse:
    result = await service.respond(
        payload=payload,
        request_id=request.state.request_id,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return result

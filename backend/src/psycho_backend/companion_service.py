import asyncio
from datetime import UTC, datetime

from psycho_backend.companion_llm import CompanionLLM
from psycho_backend.companion_schemas import (
    CompanionRequest,
    CompanionResponse,
    GeneratedCompanionResult,
)
from psycho_backend.config import Settings
from psycho_backend.errors import PublicError
from psycho_backend.safety import has_explicit_urgent_texts
from psycho_backend.schemas import SafetyLevel, SafetyNotice

COMPANION_DISCLAIMER = (
    "此回复是基于本次主动提供内容的支持性反思，不是心理治疗、医疗诊断、"
    "危机评估或紧急服务；服务端不保存本次消息或画像上下文。"
)


class CompanionService:
    """无会话存储；每次请求只处理客户端显式提交的最近消息。"""

    def __init__(self, *, settings: Settings, llm: CompanionLLM) -> None:
        self.settings = settings
        self.llm = llm
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_analyses)

    async def respond(
        self,
        *,
        payload: CompanionRequest,
        request_id: str,
    ) -> CompanionResponse:
        if payload.context_character_count > self.settings.max_text_chars:
            raise PublicError(
                status_code=413,
                code="text_too_large",
                message=f"消息与画像上下文合计不能超过 {self.settings.max_text_chars} 个字符",
            )

        user_messages = (message.content for message in payload.messages if message.role == "user")
        if has_explicit_urgent_texts(user_messages):
            return self._local_safety_response(payload=payload, request_id=request_id)

        if not self.settings.llm_is_configured:
            raise PublicError(
                status_code=503,
                code="model_not_configured",
                message="模型服务尚未配置",
            )

        async with self._semaphore:
            generated = await self.llm.respond(payload=payload, request_id=request_id)

        if generated.result.mode != payload.mode:
            raise PublicError(
                status_code=502,
                code="invalid_model_output",
                message="模型返回的对话模式与请求不一致，请稍后重试",
            )

        return CompanionResponse(
            request_id=request_id,
            client_request_id=payload.client_request_id,
            generated_at=datetime.now(UTC),
            model=generated.model,
            usage=generated.usage,
            result=generated.result,
            disclaimer=COMPANION_DISCLAIMER,
        )

    @staticmethod
    def _local_safety_response(
        *,
        payload: CompanionRequest,
        request_id: str,
    ) -> CompanionResponse:
        if payload.locale.lower().startswith("zh"):
            reply = (
                "我很在意你刚才提到可能马上伤害自己或他人。现在先不要独自承担："
                "请立即联系当地急救、报警或危机支持服务，并联系一位可信任且能尽快到场的人。"
                "如果可以，先远离可能造成伤害的物品和独处环境。"
            )
            message = (
                "明确危机用语触发了本地安全升级。此规则可能误判，也不等同于风险评估；"
                "如果危险可能立即发生，请不要只依赖本应用。"
            )
            actions = [
                "立即联系当地急救、报警或危机支持服务",
                "联系一位可信任且能尽快到场的人",
                "远离可能造成伤害的物品和独处环境",
            ]
            prompts = ["我现在愿意联系一个人", "帮我列出接下来三步"]
        else:
            reply = (
                "What you just said may mean that you or someone else could be in immediate "
                "danger. Please contact local emergency or crisis services now, and ask a "
                "trusted person who can be physically present to stay with you. If possible, "
                "move away from anything that could be used to cause harm."
            )
            message = (
                "Explicit crisis wording triggered a local safety escalation. This rule can "
                "be wrong and is not a risk assessment; do not rely on this app if danger "
                "is imminent."
            )
            actions = [
                "Contact local emergency or crisis services now",
                "Ask a trusted person who can arrive quickly to stay with you",
                "Move away from means of harm and avoid being alone",
            ]
            prompts = ["I can contact someone now", "Help me list the next three steps"]

        result = GeneratedCompanionResult(
            mode=payload.mode,
            reply=reply,
            chapter=None,
            report=None,
            suggested_prompts=prompts,
            safety_notice=SafetyNotice(
                level=SafetyLevel.URGENT_SUPPORT_RECOMMENDED,
                evidence=["最近的用户消息中出现了明确的即时自伤或他伤用语；本地规则未保存原文。"],
                message=message,
                recommended_actions=actions,
            ),
        )
        return CompanionResponse(
            request_id=request_id,
            client_request_id=payload.client_request_id,
            generated_at=datetime.now(UTC),
            model=None,
            usage=None,
            result=result,
            disclaimer=COMPANION_DISCLAIMER,
        )

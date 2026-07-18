import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import UploadFile

from psycho_backend.config import Settings
from psycho_backend.errors import PublicError, invalid_payload
from psycho_backend.image_processing import process_images
from psycho_backend.llm import ProfileLLM
from psycho_backend.safety import has_explicit_urgent_language
from psycho_backend.schemas import (
    AnalysisStatus,
    InputModality,
    ProfileAnalyzePayload,
    ProfileResponse,
    SafetyLevel,
    SafetyNotice,
    TextSource,
)

DISCLAIMER = (
    "此画像仅是基于本次用户主动提供材料的暂时性反思总结，不是心理测评、医疗诊断、"
    "治疗建议或危机评估，也不得用于就业、教育、保险、信贷、司法等高影响决策。"
)


class ProfileService:
    def __init__(self, *, settings: Settings, llm: ProfileLLM) -> None:
        self.settings = settings
        self.llm = llm
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_analyses)

    async def analyze(
        self,
        *,
        payload: ProfileAnalyzePayload,
        uploads: list[UploadFile],
        request_id: str,
    ) -> ProfileResponse:
        if not self.settings.llm_is_configured:
            raise PublicError(
                status_code=503,
                code="model_not_configured",
                message="模型服务尚未配置",
            )
        if payload.text_character_count > self.settings.max_text_chars:
            raise PublicError(
                status_code=413,
                code="text_too_large",
                message=f"文本与结构化信号合计不能超过 {self.settings.max_text_chars} 个字符",
            )
        if payload.image_contexts and not uploads:
            raise invalid_payload("提供了 image_contexts，但没有上传 images")
        if uploads and not payload.consent.media_rights_confirmed:
            raise PublicError(
                status_code=422,
                code="media_consent_required",
                message="上传图片前必须确认 media_rights_confirmed=true",
            )
        if not payload.texts and not payload.signals and not uploads:
            raise invalid_payload("texts、signals、images 至少提供一种输入")

        images = await process_images(uploads, payload.image_contexts, self.settings)
        all_source_ids = [item.source_id for item in payload.texts]
        all_source_ids.extend(item.source_id for item in payload.signals)
        all_source_ids.extend(image.source_id for image in images)
        if len(all_source_ids) != len(set(all_source_ids)):
            raise invalid_payload(
                "图片自动生成的 source_id 与 texts/signals 冲突；请通过 image_contexts 指定唯一编号"
            )
        explicit_safety_hint = has_explicit_urgent_language(payload)
        async with self._semaphore:
            result = await self.llm.generate(
                payload=payload,
                images=images,
                explicit_safety_hint=explicit_safety_hint,
                request_id=request_id,
            )

        profile = result.profile
        referenced_source_ids = {
            evidence.source_id
            for collection in (
                profile.current_state,
                profile.recurring_patterns,
                profile.strengths_and_resources,
                profile.needs_and_preferences,
            )
            for insight in collection
            for evidence in insight.evidence
        }
        unknown_source_ids = referenced_source_ids.difference(all_source_ids)
        if unknown_source_ids:
            raise PublicError(
                status_code=502,
                code="invalid_model_output",
                message="模型返回了无法对应输入证据的画像，请稍后重试",
            )

        if explicit_safety_hint:
            profile = profile.model_copy(
                update={
                    "analysis_status": AnalysisStatus.SAFETY_FIRST,
                    "safety_notice": SafetyNotice(
                        level=SafetyLevel.URGENT_SUPPORT_RECOMMENDED,
                        evidence=[
                            "输入中出现了明确的即时自伤意图用语；自动规则可能误判，需要立即向用户确认。"
                        ],
                        message=(
                            "如果你或他人可能马上受到伤害，请立即联系当地紧急服务、前往最近的"
                            "急诊，并请可信任的人留在身边。不要只依赖本应用或本次画像。"
                        ),
                        recommended_actions=[
                            "立即联系当地急救、报警或危机支持服务",
                            "联系一位可信任且能尽快到场的人",
                            "远离可能造成伤害的物品和独处环境",
                        ],
                    ),
                }
            )
        elif profile.safety_notice.level == SafetyLevel.URGENT_SUPPORT_RECOMMENDED:
            profile = profile.model_copy(update={"analysis_status": AnalysisStatus.SAFETY_FIRST})

        modalities: list[InputModality] = []
        if payload.analysis_focus or any(
            item.source != TextSource.VOICE_TRANSCRIPT for item in payload.texts
        ):
            modalities.append(InputModality.TEXT)
        if any(item.source == TextSource.VOICE_TRANSCRIPT for item in payload.texts):
            modalities.append(InputModality.VOICE_TRANSCRIPT)
        if payload.signals:
            modalities.append(InputModality.APP_SIGNAL)
        if images:
            modalities.append(InputModality.IMAGE)

        return ProfileResponse(
            profile_id=uuid4(),
            request_id=request_id,
            client_request_id=payload.client_request_id,
            generated_at=datetime.now(UTC),
            model=result.model,
            modalities_used=modalities,
            profile=profile,
            usage=result.usage,
            disclaimer=DISCLAIMER,
        )

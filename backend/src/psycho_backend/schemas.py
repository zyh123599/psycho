from datetime import datetime
from enum import StrEnum
from math import isfinite
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SOURCE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$"


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Consent(ApiModel):
    """证明本次请求是在数据主体本人知情同意下发起。"""

    profile_generation: Literal[True] = Field(description="用户同意生成本次反思性画像")
    ai_processing: Literal[True] = Field(description="用户同意把本次输入发送给第三方 AI 端点")
    subject_is_requester: Literal[True] = Field(description="被分析对象就是当前用户本人")
    media_rights_confirmed: bool = Field(
        default=False,
        description="上传图片时必须为 true，表示用户有权处理图片中的内容",
    )


class TextSource(StrEnum):
    NOTE = "note"
    THEME = "theme"
    RESPONSE = "response"
    JOURNAL = "journal"
    CHECK_IN = "check_in"
    VOICE_TRANSCRIPT = "voice_transcript"
    OTHER = "other"


class TextEntry(ApiModel):
    source_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=SOURCE_ID_PATTERN,
        description="本次请求内唯一的证据编号，如 note:1",
    )
    source: TextSource
    content: str = Field(min_length=1, max_length=6000)
    observed_at: datetime | None = None


class SignalSource(StrEnum):
    CARD_CHOICE = "card_choice"
    AGGREGATED_SIGNAL = "aggregated_signal"
    SELECTED_ACTION = "selected_action"
    CHECK_IN = "check_in"
    QUESTIONNAIRE = "questionnaire"
    APP_INTERACTION = "app_interaction"
    OTHER = "other"


class AppSignal(ApiModel):
    source_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=SOURCE_ID_PATTERN,
        description="本次请求内唯一的证据编号，如 choice:1",
    )
    source: SignalSource
    name: str = Field(min_length=1, max_length=100)
    value: str | int | float | bool
    context: str | None = Field(default=None, max_length=1000)
    observed_at: datetime | None = None

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: str | int | float | bool) -> str | int | float | bool:
        if isinstance(value, str) and len(value) > 1000:
            raise ValueError("字符串信号值不能超过 1000 个字符")
        if isinstance(value, float) and not isfinite(value):
            raise ValueError("数值信号必须是有限数")
        return value


class ImageContext(ApiModel):
    index: int = Field(ge=0, le=15, description="对应 multipart images 的零基索引")
    source_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=SOURCE_ID_PATTERN,
        description="图片证据编号，如 image:1",
    )
    description: str = Field(
        min_length=1,
        max_length=1000,
        description="用户主动提供的图片语境；模型不得仅凭外貌推断心理属性",
    )


class ProfileAnalyzePayload(ApiModel):
    consent: Consent
    locale: str = Field(default="zh-CN", min_length=2, max_length=20, pattern=r"^[A-Za-z0-9-]+$")
    client_request_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=SOURCE_ID_PATTERN,
        description="客户端用于界面去重的非敏感编号；不会发送给模型",
    )
    analysis_focus: str | None = Field(default=None, max_length=1000)
    texts: list[TextEntry] = Field(default_factory=list, max_length=30)
    signals: list[AppSignal] = Field(default_factory=list, max_length=100)
    image_contexts: list[ImageContext] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_source_ids(self) -> Self:
        source_ids = [item.source_id for item in self.texts]
        source_ids.extend(item.source_id for item in self.signals)
        source_ids.extend(item.source_id for item in self.image_contexts)
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("texts、signals 和 image_contexts 的 source_id 必须在请求内唯一")

        indexes = [item.index for item in self.image_contexts]
        if len(indexes) != len(set(indexes)):
            raise ValueError("image_contexts.index 不能重复")
        return self

    @property
    def text_character_count(self) -> int:
        total = len(self.analysis_focus or "")
        total += sum(len(item.content) for item in self.texts)
        for signal in self.signals:
            total += len(signal.name) + len(str(signal.value)) + len(signal.context or "")
        total += sum(len(item.description) for item in self.image_contexts)
        return total


class Confidence(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class AnalysisStatus(StrEnum):
    COMPLETE = "complete"
    LIMITED_BY_EVIDENCE = "limited_by_evidence"
    SAFETY_FIRST = "safety_first"


class SafetyLevel(StrEnum):
    NOT_INDICATED = "not_indicated"
    CHECK_IN_RECOMMENDED = "check_in_recommended"
    URGENT_SUPPORT_RECOMMENDED = "urgent_support_recommended"


class EvidenceReference(ApiModel):
    source_id: str = Field(min_length=1, max_length=64)
    observation: str = Field(min_length=1, max_length=500)


class ProfileInsight(ApiModel):
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=800)
    evidence: list[EvidenceReference] = Field(min_length=1, max_length=5)
    confidence: Confidence
    uncertainty: str = Field(min_length=1, max_length=400)


class GentleAction(ApiModel):
    title: str = Field(min_length=1, max_length=100)
    action: str = Field(min_length=1, max_length=500)
    rationale: str = Field(min_length=1, max_length=500)


class SafetyNotice(ApiModel):
    level: SafetyLevel
    evidence: list[str] = Field(max_length=4)
    message: str = Field(min_length=1, max_length=800)
    recommended_actions: list[str] = Field(max_length=4)


class GeneratedProfile(ApiModel):
    """由模型生成、随后再次通过 Pydantic 验证的非诊断性画像。"""

    analysis_status: AnalysisStatus
    headline: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1200)
    current_state: list[ProfileInsight] = Field(max_length=4)
    recurring_patterns: list[ProfileInsight] = Field(max_length=6)
    strengths_and_resources: list[ProfileInsight] = Field(max_length=5)
    needs_and_preferences: list[ProfileInsight] = Field(max_length=5)
    communication_preferences: list[str] = Field(max_length=5)
    gentle_actions: list[GentleAction] = Field(max_length=4)
    reflection_questions: list[str] = Field(max_length=4)
    uncertainties: list[str] = Field(min_length=1, max_length=6)
    safety_notice: SafetyNotice


class InputModality(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    APP_SIGNAL = "app_signal"
    VOICE_TRANSCRIPT = "voice_transcript"


class TokenUsage(ApiModel):
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)


class ProfileResponse(ApiModel):
    schema_version: Literal["1.0"] = "1.0"
    profile_id: UUID
    request_id: str
    client_request_id: str | None
    generated_at: datetime
    model: str
    modalities_used: list[InputModality]
    profile: GeneratedProfile
    usage: TokenUsage | None
    disclaimer: str


class HealthResponse(ApiModel):
    status: Literal["ok", "ready"]
    service: str
    version: str
    model: str | None = None
    api_mode: str | None = None


class CapabilitiesResponse(ApiModel):
    schema_version: Literal["1.0"] = "1.0"
    supported_modalities: list[InputModality]
    accepted_image_types: list[str]
    raw_audio_upload_supported: bool
    max_images: int
    max_image_bytes: int
    max_text_chars: int
    max_request_bytes: int


class ErrorItem(ApiModel):
    location: str | None = None
    message: str
    error_type: str | None = None


class ErrorBody(ApiModel):
    code: str
    message: str
    request_id: str
    details: list[ErrorItem] | None = None


class ErrorResponse(ApiModel):
    error: ErrorBody

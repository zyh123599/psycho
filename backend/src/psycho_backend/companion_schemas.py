from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from psycho_backend.schemas import (
    SafetyLevel,
    SafetyNotice,
    TokenUsage,
)

SOURCE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$"
CompanionMode = Literal["standalone", "chapter", "report"]
CompanionRole = Literal["user", "assistant"]
CompanionShortText = Annotated[str, Field(min_length=1, max_length=180)]
CompanionContextText = Annotated[str, Field(min_length=1, max_length=500)]


class StrictApiModel(BaseModel):
    """用于新的 JSON API：拒绝未知字段，也禁止隐式类型转换。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


class CompanionConsent(StrictApiModel):
    ai_processing: Literal[True] = Field(
        description="用户明确同意将本次对话和可选画像上下文发送给第三方 AI 端点"
    )
    use_profile: bool = Field(
        default=False,
        description="用户是否单独同意把 profile_context 用于本次回复",
    )


class CompanionMessage(StrictApiModel):
    role: CompanionRole
    content: str = Field(min_length=1, max_length=4000)


class CompanionProfileContext(StrictApiModel):
    """客户端经单独授权提供的最小画像上下文，不包含证据原文或安全事件。"""

    profile_id: str = Field(
        min_length=36,
        max_length=36,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    )
    generated_at: str = Field(
        min_length=20,
        max_length=35,
        pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$",
    )
    headline: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1200)
    communication_preferences: list[CompanionContextText] = Field(max_length=5)
    needs_and_preferences: list[CompanionContextText] = Field(max_length=5)
    gentle_actions: list[CompanionContextText] = Field(max_length=4)
    uncertainties: list[CompanionContextText] = Field(max_length=6)

    @field_validator("generated_at")
    @classmethod
    def validate_generated_at(cls, value: str) -> str:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("generated_at 必须包含时区")
        return value


class CompanionRequest(StrictApiModel):
    consent: CompanionConsent
    mode: CompanionMode = "standalone"
    locale: str = Field(
        default="zh-CN",
        min_length=2,
        max_length=20,
        pattern=r"^[A-Za-z0-9-]+$",
    )
    client_request_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=SOURCE_ID_PATTERN,
        description="仅回传给客户端用于去重；不会发送给模型",
    )
    messages: list[CompanionMessage] = Field(min_length=1, max_length=8)
    profile_context: CompanionProfileContext | None = Field(
        default=None,
        description="可选、最小化且由用户单独授权发送的既有反思画像上下文",
    )

    @model_validator(mode="after")
    def validate_turn_order(self) -> Self:
        if self.profile_context is not None and not self.consent.use_profile:
            raise ValueError("提供 profile_context 时 consent.use_profile 必须为 true")
        if self.messages[-1].role != "user":
            raise ValueError("messages 最后一条必须是等待回复的 user 消息")
        if any(
            previous.role == current.role
            for previous, current in zip(self.messages, self.messages[1:], strict=False)
        ):
            raise ValueError("messages 必须按 user/assistant 角色交替排列")
        return self

    @property
    def context_character_count(self) -> int:
        total = sum(len(message.content) for message in self.messages)
        if self.profile_context is not None:
            total += len(self.profile_context.model_dump_json())
        return total


class CompanionChapter(StrictApiModel):
    title: str = Field(min_length=1, max_length=120)
    narrative: str = Field(min_length=1, max_length=1800)
    reflection_question: str = Field(min_length=1, max_length=300)


class CompanionReport(StrictApiModel):
    title: str = Field(min_length=1, max_length=120)
    overview: str = Field(min_length=1, max_length=1200)
    observations: list[CompanionShortText] = Field(min_length=1, max_length=5)
    strengths: list[CompanionShortText] = Field(max_length=4)
    possible_needs: list[CompanionShortText] = Field(max_length=4)
    next_steps: list[CompanionShortText] = Field(max_length=4)
    uncertainty: str = Field(min_length=1, max_length=500)


class GeneratedCompanionResult(StrictApiModel):
    """上游模型必须返回、并由服务端再次严格校验的结构。"""

    mode: CompanionMode
    reply: str = Field(min_length=1, max_length=2400)
    chapter: CompanionChapter | None
    report: CompanionReport | None
    suggested_prompts: list[CompanionShortText] = Field(max_length=3)
    safety_notice: SafetyNotice

    @model_validator(mode="after")
    def validate_mode_shape(self) -> Self:
        is_safety_escalation = self.safety_notice.level == SafetyLevel.URGENT_SUPPORT_RECOMMENDED
        if self.mode == "standalone":
            if self.chapter is not None or self.report is not None:
                raise ValueError("standalone 模式不能包含 chapter 或 report")
        elif self.mode == "chapter":
            if self.report is not None:
                raise ValueError("chapter 模式不能包含 report")
            if self.chapter is None and not is_safety_escalation:
                raise ValueError("chapter 模式必须包含 chapter")
        elif self.mode == "report":
            if self.chapter is not None:
                raise ValueError("report 模式不能包含 chapter")
            if self.report is None and not is_safety_escalation:
                raise ValueError("report 模式必须包含 report")
        return self


class CompanionResponse(StrictApiModel):
    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    client_request_id: str | None
    generated_at: datetime
    model: str | None
    usage: TokenUsage | None
    result: GeneratedCompanionResult
    disclaimer: str

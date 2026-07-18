import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol, cast

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)
from pydantic import ValidationError

from psycho_backend.config import Settings
from psycho_backend.errors import PublicError
from psycho_backend.image_processing import ProcessedImage
from psycho_backend.prompts import SYSTEM_PROMPT, build_user_prompt
from psycho_backend.schemas import GeneratedProfile, ProfileAnalyzePayload, TokenUsage

logger = logging.getLogger(__name__)


@dataclass(slots=True, frozen=True)
class LLMResult:
    profile: GeneratedProfile
    model: str
    usage: TokenUsage | None


class ProfileLLM(Protocol):
    async def generate(
        self,
        *,
        payload: ProfileAnalyzePayload,
        images: list[ProcessedImage],
        explicit_safety_hint: bool,
        request_id: str,
    ) -> LLMResult: ...


class OpenAIProfileLLM:
    """兼容 OpenAI Responses 与 Chat Completions 的多模态适配器。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value() or "not-configured",
            base_url=settings.openai_base_url,
            timeout=settings.openai_timeout_seconds,
            max_retries=settings.openai_max_retries,
        )

    async def close(self) -> None:
        await self.client.close()

    async def generate(
        self,
        *,
        payload: ProfileAnalyzePayload,
        images: list[ProcessedImage],
        explicit_safety_hint: bool,
        request_id: str,
    ) -> LLMResult:
        image_sources: list[dict[str, str | int]] = [
            {
                "index": index,
                "source_id": image.source_id,
                "user_context": image.context,
                "normalized_size": f"{image.width}x{image.height}",
            }
            for index, image in enumerate(images)
        ]
        user_prompt = build_user_prompt(
            payload,
            image_sources=image_sources,
            explicit_safety_hint=explicit_safety_hint,
        )

        try:
            if self.settings.openai_api_mode == "responses":
                raw, model, usage = await self._responses(user_prompt, images)
            else:
                raw, model, usage = await self._chat_completions(user_prompt, images)
        except APITimeoutError as exc:
            raise PublicError(
                status_code=504,
                code="model_timeout",
                message="画像生成超时，请稍后重试",
            ) from exc
        except RateLimitError as exc:
            raise PublicError(
                status_code=429,
                code="model_rate_limited",
                message="模型服务当前繁忙，请稍后重试",
            ) from exc
        except AuthenticationError as exc:
            logger.error("Upstream authentication failed request_id=%s", request_id)
            raise PublicError(
                status_code=502,
                code="model_authentication_failed",
                message="模型服务配置无效，请联系服务管理员",
            ) from exc
        except APIConnectionError as exc:
            logger.warning("Upstream connection failed request_id=%s", request_id)
            raise PublicError(
                status_code=502,
                code="model_unavailable",
                message="暂时无法连接模型服务，请稍后重试",
            ) from exc
        except APIStatusError as exc:
            logger.warning(
                "Upstream API failed request_id=%s status=%s",
                request_id,
                exc.status_code,
            )
            raise PublicError(
                status_code=502,
                code="model_request_failed",
                message="模型服务未能完成本次画像生成",
            ) from exc

        profile = self._parse_profile(raw, request_id=request_id)
        return LLMResult(profile=profile, model=model or self.settings.openai_model, usage=usage)

    async def _chat_completions(
        self, user_prompt: str, images: list[ProcessedImage]
    ) -> tuple[str, str, TokenUsage | None]:
        user_content: list[dict[str, Any]] = [{"type": "text", "text": user_prompt}]
        user_content.extend(
            {
                "type": "image_url",
                "image_url": {
                    "url": image.data_url,
                    "detail": self.settings.openai_image_detail,
                },
            }
            for image in images
        )
        schema = GeneratedProfile.model_json_schema()
        response = await self.client.chat.completions.create(
            model=self.settings.openai_model,
            messages=cast(
                Any,
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
            ),
            response_format=cast(
                Any,
                {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "reflective_psychological_profile",
                        "strict": True,
                        "schema": schema,
                    },
                },
            ),
            max_completion_tokens=self.settings.openai_max_output_tokens,
            store=False,
        )
        if not response.choices:
            raise PublicError(
                status_code=502,
                code="empty_model_output",
                message="模型没有返回画像结果",
            )
        message = response.choices[0].message
        refusal = getattr(message, "refusal", None)
        if refusal:
            raise PublicError(
                status_code=422,
                code="analysis_refused",
                message="模型无法安全处理本次输入，请调整内容后重试",
            )
        raw = message.content or ""
        usage = self._chat_usage(response.usage)
        return raw, response.model, usage

    async def _responses(
        self, user_prompt: str, images: list[ProcessedImage]
    ) -> tuple[str, str, TokenUsage | None]:
        content: list[dict[str, Any]] = [{"type": "input_text", "text": user_prompt}]
        content.extend(
            {
                "type": "input_image",
                "image_url": image.data_url,
                "detail": self.settings.openai_image_detail,
            }
            for image in images
        )
        response = await self.client.responses.create(
            model=self.settings.openai_model,
            instructions=SYSTEM_PROMPT,
            input=cast(Any, [{"role": "user", "content": content}]),
            text=cast(
                Any,
                {
                    "format": {
                        "type": "json_schema",
                        "name": "reflective_psychological_profile",
                        "strict": True,
                        "schema": GeneratedProfile.model_json_schema(),
                    }
                },
            ),
            max_output_tokens=self.settings.openai_max_output_tokens,
            store=False,
        )
        raw = response.output_text or ""
        usage = self._responses_usage(response.usage)
        return raw, response.model, usage

    @staticmethod
    def _chat_usage(usage: Any) -> TokenUsage | None:
        if usage is None:
            return None
        return TokenUsage(
            input_tokens=getattr(usage, "prompt_tokens", None),
            output_tokens=getattr(usage, "completion_tokens", None),
            total_tokens=getattr(usage, "total_tokens", None),
        )

    @staticmethod
    def _responses_usage(usage: Any) -> TokenUsage | None:
        if usage is None:
            return None
        return TokenUsage(
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
            total_tokens=getattr(usage, "total_tokens", None),
        )

    @staticmethod
    def _parse_profile(raw: str, *, request_id: str) -> GeneratedProfile:
        candidate = raw.strip()
        if candidate.startswith("```"):
            lines = candidate.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            candidate = "\n".join(lines).strip()
        if not candidate.startswith("{"):
            start, end = candidate.find("{"), candidate.rfind("}")
            if start >= 0 and end > start:
                candidate = candidate[start : end + 1]
        try:
            parsed = json.loads(candidate)
            return GeneratedProfile.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError) as exc:
            logger.warning("Invalid structured model output request_id=%s", request_id)
            raise PublicError(
                status_code=502,
                code="invalid_model_output",
                message="模型返回的数据结构无效，请稍后重试",
            ) from exc

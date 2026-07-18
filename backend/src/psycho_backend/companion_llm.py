import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol, cast

from pydantic import ValidationError

from psycho_backend.companion_prompts import (
    COMPANION_SYSTEM_PROMPT,
    build_companion_prompt,
)
from psycho_backend.companion_schemas import (
    CompanionRequest,
    GeneratedCompanionResult,
)
from psycho_backend.errors import PublicError
from psycho_backend.llm import OpenAIProfileLLM
from psycho_backend.schemas import TokenUsage

logger = logging.getLogger(__name__)


@dataclass(slots=True, frozen=True)
class CompanionLLMResult:
    result: GeneratedCompanionResult
    model: str
    usage: TokenUsage | None


class CompanionLLM(Protocol):
    async def respond(
        self,
        *,
        payload: CompanionRequest,
        request_id: str,
    ) -> CompanionLLMResult: ...


class OpenAICompanionLLM(OpenAIProfileLLM):
    """在现有异步 OpenAI 适配器上增加结构化支持性对话。"""

    async def respond(
        self,
        *,
        payload: CompanionRequest,
        request_id: str,
    ) -> CompanionLLMResult:
        user_prompt = build_companion_prompt(payload)
        if self.settings.openai_api_mode == "responses":
            call = self._companion_responses(user_prompt)
        else:
            call = self._companion_chat_completions(user_prompt)
        raw, model, usage = await self._call_with_error_mapping(
            call,
            request_id=request_id,
            task_label="对话回复",
        )
        result = self._parse_result(raw, request_id=request_id)
        if result.mode != payload.mode:
            logger.warning(
                "Companion mode mismatch request_id=%s requested=%s returned=%s",
                request_id,
                payload.mode,
                result.mode,
            )
            raise PublicError(
                status_code=502,
                code="invalid_model_output",
                message="模型返回的对话模式与请求不一致，请稍后重试",
            )
        return CompanionLLMResult(
            result=result,
            model=model or self.settings.openai_model,
            usage=usage,
        )

    async def _companion_chat_completions(
        self,
        user_prompt: str,
    ) -> tuple[str, str, TokenUsage | None]:
        response = await self.client.chat.completions.create(
            model=self.settings.openai_model,
            messages=cast(
                Any,
                [
                    {"role": "system", "content": COMPANION_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            ),
            response_format=cast(
                Any,
                {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "supportive_companion_response",
                        "strict": True,
                        "schema": GeneratedCompanionResult.model_json_schema(),
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
                message="模型没有返回对话结果",
            )
        message = response.choices[0].message
        if getattr(message, "refusal", None):
            raise PublicError(
                status_code=422,
                code="response_refused",
                message="模型无法安全处理本次输入，请调整内容后重试",
            )
        return message.content or "", response.model, self._chat_usage(response.usage)

    async def _companion_responses(
        self,
        user_prompt: str,
    ) -> tuple[str, str, TokenUsage | None]:
        response = await self.client.responses.create(
            model=self.settings.openai_model,
            instructions=COMPANION_SYSTEM_PROMPT,
            input=cast(
                Any,
                [
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": user_prompt}],
                    }
                ],
            ),
            text=cast(
                Any,
                {
                    "format": {
                        "type": "json_schema",
                        "name": "supportive_companion_response",
                        "strict": True,
                        "schema": GeneratedCompanionResult.model_json_schema(),
                    }
                },
            ),
            max_output_tokens=self.settings.openai_max_output_tokens,
            store=False,
        )
        return (
            response.output_text or "",
            response.model,
            self._responses_usage(response.usage),
        )

    @staticmethod
    def _parse_result(raw: str, *, request_id: str) -> GeneratedCompanionResult:
        candidate = raw.strip()
        fence = chr(96) * 3
        if candidate.startswith(fence):
            lines = candidate.splitlines()
            if lines and lines[0].startswith(fence):
                lines = lines[1:]
            if lines and lines[-1].strip() == fence:
                lines = lines[:-1]
            candidate = "\n".join(lines).strip()
        if not candidate.startswith("{"):
            start, end = candidate.find("{"), candidate.rfind("}")
            if start >= 0 and end > start:
                candidate = candidate[start : end + 1]
        try:
            parsed = json.loads(candidate)
            return GeneratedCompanionResult.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError) as exc:
            logger.warning("Invalid companion model output request_id=%s", request_id)
            raise PublicError(
                status_code=502,
                code="invalid_model_output",
                message="模型返回的对话数据结构无效，请稍后重试",
            ) from exc

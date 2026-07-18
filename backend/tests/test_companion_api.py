import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from psycho_backend.companion_llm import CompanionLLMResult
from psycho_backend.companion_prompts import build_companion_prompt
from psycho_backend.companion_schemas import (
    CompanionChapter,
    CompanionReport,
    CompanionRequest,
    GeneratedCompanionResult,
)
from psycho_backend.companion_service import CompanionService
from psycho_backend.config import Settings
from psycho_backend.main import create_app
from psycho_backend.schemas import SafetyLevel, SafetyNotice, TokenUsage


def settings(**overrides: Any) -> Settings:
    values = {
        "environment": "test",
        "openai_base_url": "https://model.example.test/v1",
        "openai_api_key": "test-upstream-key",
        "openai_model": "gpt-5.6-sol",
        "max_request_bytes": 2 * 1024 * 1024,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def safe_notice() -> SafetyNotice:
    return SafetyNotice(
        level=SafetyLevel.NOT_INDICATED,
        evidence=[],
        message="没有命中明确即时危险用语；这不是安全评估。",
        recommended_actions=[],
    )


def generated_result(mode: str) -> GeneratedCompanionResult:
    chapter = None
    report = None
    if mode == "chapter":
        chapter = CompanionChapter(
            title="给不确定留一个停点",
            narrative="你注意到自己又开始检查，也注意到了疲惫。",
            reflection_question="什么样的停点对今天来说已经够用？",
        )
    elif mode == "report":
        report = CompanionReport(
            title="本轮反思小结",
            overview="这次对话围绕检查、疲惫和休息展开。",
            observations=["不确定出现时会继续检查"],
            strengths=["能够觉察疲惫"],
            possible_needs=["一个清楚的结束边界"],
            next_steps=["写下今天的停止时间"],
            uncertainty="只有本轮对话，不能推断其他情境。",
        )
    return GeneratedCompanionResult(
        mode=mode,
        reply="听起来你一边想确认没有遗漏，一边也已经很累了。",
        chapter=chapter,
        report=report,
        suggested_prompts=["我想先说说最累的部分"],
        safety_notice=safe_notice(),
    )


class FakeCompanionLLM:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def respond(self, **kwargs: Any) -> CompanionLLMResult:
        await asyncio.sleep(0)
        self.calls.append(kwargs)
        return CompanionLLMResult(
            result=generated_result(kwargs["payload"].mode),
            model="gpt-5.6-sol",
            usage=TokenUsage(input_tokens=20, output_tokens=10, total_tokens=30),
        )


class WrongModeLLM(FakeCompanionLLM):
    async def respond(self, **kwargs: Any) -> CompanionLLMResult:
        await asyncio.sleep(0)
        self.calls.append(kwargs)
        return CompanionLLMResult(
            result=generated_result("standalone"),
            model="gpt-5.6-sol",
            usage=None,
        )


def make_client(
    *,
    custom_settings: Settings | None = None,
    llm: FakeCompanionLLM | None = None,
) -> tuple[TestClient, FakeCompanionLLM]:
    runtime_settings = custom_settings or settings()
    runtime_llm = llm or FakeCompanionLLM()
    service = CompanionService(settings=runtime_settings, llm=runtime_llm)
    app = create_app(settings=runtime_settings, companion_service=service)
    return TestClient(app), runtime_llm


def request_payload(mode: str = "standalone") -> dict[str, Any]:
    return {
        "consent": {"ai_processing": True, "use_profile": False},
        "mode": mode,
        "locale": "zh-CN",
        "client_request_id": "chat-001",
        "messages": [
            {"role": "user", "content": "我又检查了好几遍。"},
            {"role": "assistant", "content": "你似乎很想确保没有遗漏。"},
            {"role": "user", "content": "是的，但我也真的累了。"},
        ],
        "profile_context": None,
    }


def minimal_profile_context() -> dict[str, Any]:
    return {
        "profile_id": "11111111-1111-4111-8111-111111111111",
        "generated_at": "2026-07-18T08:00:00Z",
        "headline": "在检查与休息之间寻找停点",
        "summary": "这是只基于本次材料的暂时性总结。",
        "needs_and_preferences": [],
        "communication_preferences": [],
        "gentle_actions": [],
        "uncertainties": ["材料不足以代表其他情境。"],
    }


@pytest.mark.parametrize("mode", ["standalone", "chapter", "report"])
def test_companion_modes_return_strict_envelope(mode: str) -> None:
    client, llm = make_client()
    payload = request_payload(mode)
    payload["profile_context"] = minimal_profile_context()
    payload["consent"]["use_profile"] = True

    with client:
        response = client.post(
            "/api/v1/companion/respond",
            json=payload,
            headers={"X-Request-ID": f"companion-{mode}"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert body["request_id"] == f"companion-{mode}"
    assert body["client_request_id"] == "chat-001"
    assert body["result"]["mode"] == mode
    assert body["result"]["reply"]
    assert body["model"] == "gpt-5.6-sol"
    assert body["usage"]["total_tokens"] == 30
    assert response.headers["Cache-Control"] == "no-store"
    assert len(llm.calls) == 1
    assert llm.calls[0]["payload"].profile_context is not None


def test_schema_rejects_missing_consent_extra_fields_bad_turns_and_more_than_eight() -> None:
    client, llm = make_client()
    bad_payloads = []

    missing_consent = request_payload()
    missing_consent["consent"] = {"ai_processing": False}
    bad_payloads.append(missing_consent)

    extra = request_payload()
    extra["provider_api_key"] = "must-never-be-accepted"
    bad_payloads.append(extra)

    profile_without_consent = request_payload()
    profile_without_consent["profile_context"] = minimal_profile_context()
    bad_payloads.append(profile_without_consent)

    bad_roles = request_payload()
    bad_roles["messages"] = [
        {"role": "user", "content": "第一条"},
        {"role": "user", "content": "第二条"},
    ]
    bad_payloads.append(bad_roles)

    too_many = request_payload()
    too_many["messages"] = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"消息 {index}",
        }
        for index in range(9)
    ]
    bad_payloads.append(too_many)

    wrong_type = request_payload()
    wrong_type["messages"] = [{"role": "user", "content": 123}]
    bad_payloads.append(wrong_type)

    with client:
        for payload in bad_payloads:
            response = client.post("/api/v1/companion/respond", json=payload)
            assert response.status_code == 422
            assert response.json()["error"]["code"] == "request_validation_error"
            assert response.headers["Cache-Control"] == "no-store"

    assert not llm.calls


def test_explicit_crisis_language_is_escalated_locally_without_model() -> None:
    client, llm = make_client(
        custom_settings=settings(openai_api_key=""),
    )
    payload = request_payload("chapter")
    payload["messages"] = [{"role": "user", "content": "我现在就要自杀"}]

    with client:
        response = client.post(
            "/api/v1/companion/respond",
            json=payload,
            headers={"X-Request-ID": "local-safety-001"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model"] is None
    assert body["usage"] is None
    assert body["result"]["chapter"] is None
    assert body["result"]["safety_notice"]["level"] == "urgent_support_recommended"
    assert "当地" in body["result"]["reply"]
    assert response.headers["X-Request-ID"] == "local-safety-001"
    assert response.headers["Cache-Control"] == "no-store"
    assert not llm.calls


def test_backend_api_key_and_text_limit_apply_to_companion() -> None:
    client, llm = make_client(
        custom_settings=settings(app_api_keys="backend-secret", max_text_chars=10)
    )

    with client:
        unauthorized = client.post("/api/v1/companion/respond", json=request_payload())
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "unauthorized"

        too_large = client.post(
            "/api/v1/companion/respond",
            json=request_payload(),
            headers={"X-API-Key": "backend-secret"},
        )
        assert too_large.status_code == 413
        assert too_large.json()["error"]["code"] == "text_too_large"

    assert not llm.calls


def test_model_mode_mismatch_is_rejected() -> None:
    wrong_llm = WrongModeLLM()
    client, _ = make_client(llm=wrong_llm)
    with client:
        response = client.post(
            "/api/v1/companion/respond",
            json=request_payload("report"),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "invalid_model_output"


def test_prompt_excludes_client_id_and_marks_context_untrusted() -> None:
    payload = CompanionRequest.model_validate(request_payload())
    prompt = build_companion_prompt(payload)

    assert "<untrusted_user_data>" in prompt
    assert "chat-001" not in prompt
    assert "我又检查了好几遍" in prompt


def test_generated_mode_shape_is_strict() -> None:
    with pytest.raises(ValidationError):
        GeneratedCompanionResult(
            mode="standalone",
            reply="回复",
            chapter=CompanionChapter(
                title="不该出现",
                narrative="standalone 不能含章节。",
                reflection_question="不应出现？",
            ),
            report=None,
            suggested_prompts=[],
            safety_notice=safe_notice(),
        )


def test_openapi_exposes_companion_json_route() -> None:
    client, _ = make_client()
    with client:
        openapi = client.get("/openapi.json").json()

    operation = openapi["paths"]["/api/v1/companion/respond"]["post"]
    assert "application/json" in operation["requestBody"]["content"]
    assert operation["responses"]["200"]

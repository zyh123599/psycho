import json
from io import BytesIO
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from psycho_backend.config import Settings
from psycho_backend.llm import LLMResult
from psycho_backend.main import create_app
from psycho_backend.schemas import (
    AnalysisStatus,
    Confidence,
    EvidenceReference,
    GeneratedProfile,
    GentleAction,
    ProfileInsight,
    SafetyLevel,
    SafetyNotice,
    TokenUsage,
)
from psycho_backend.service import ProfileService


def settings(**overrides: Any) -> Settings:
    values = {
        "environment": "test",
        "openai_base_url": "https://model.example.test/v1",
        "openai_api_key": "test-upstream-key",
        "openai_model": "gpt-5.6-sol",
        "max_request_bytes": 2 * 1024 * 1024,
        "max_image_bytes": 1024 * 1024,
        "max_image_pixels": 1_000_000,
        "max_image_dimension": 512,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def model_profile() -> GeneratedProfile:
    insight = ProfileInsight(
        title="为不确定寻找停点",
        description="本次文字显示，用户在检查与休息之间做权衡。",
        evidence=[EvidenceReference(source_id="note:1", observation="用户自述反复检查且疲惫")],
        confidence=Confidence.MEDIUM,
        uncertainty="只有一次会话材料，不能推断稳定人格。",
    )
    return GeneratedProfile(
        analysis_status=AnalysisStatus.COMPLETE,
        headline="在检查与休息之间留出选择",
        summary="这是基于本次输入的暂时性总结。",
        current_state=[insight],
        recurring_patterns=[],
        strengths_and_resources=[],
        needs_and_preferences=[],
        communication_preferences=["先被具体理解"],
        gentle_actions=[
            GentleAction(
                title="设置停点",
                action="写下本次检查的结束时间。",
                rationale="把模糊的够用变成可见边界。",
            )
        ],
        reflection_questions=["这次继续检查是在保护什么？"],
        uncertainties=["材料不足以代表其他情境。"],
        safety_notice=SafetyNotice(
            level=SafetyLevel.NOT_INDICATED,
            evidence=[],
            message="未见明确即时危险表达；这不是安全评估。",
            recommended_actions=[],
        ),
    )


class FakeLLM:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def generate(self, **kwargs: Any) -> LLMResult:
        self.calls.append(kwargs)
        return LLMResult(
            profile=model_profile(),
            model="gpt-5.6-sol",
            usage=TokenUsage(input_tokens=100, output_tokens=50, total_tokens=150),
        )


class HallucinatedEvidenceLLM(FakeLLM):
    async def generate(self, **kwargs: Any) -> LLMResult:
        result = await super().generate(**kwargs)
        profile = result.profile.model_copy(deep=True)
        profile.current_state[0].evidence[0].source_id = "missing:99"
        return LLMResult(profile=profile, model=result.model, usage=result.usage)


def make_client(custom_settings: Settings | None = None) -> tuple[TestClient, FakeLLM]:
    runtime_settings = custom_settings or settings()
    llm = FakeLLM()
    service = ProfileService(settings=runtime_settings, llm=llm)
    app = create_app(settings=runtime_settings, profile_service=service)
    return TestClient(app), llm


def make_client_with_llm(llm: FakeLLM) -> TestClient:
    runtime_settings = settings()
    service = ProfileService(settings=runtime_settings, llm=llm)
    return TestClient(create_app(settings=runtime_settings, profile_service=service))


def consent(*, media: bool = False) -> dict[str, bool]:
    return {
        "profile_generation": True,
        "ai_processing": True,
        "subject_is_requester": True,
        "media_rights_confirmed": media,
    }


def text_payload(content: str = "我反复检查同一件事，已经很累了") -> dict[str, Any]:
    return {
        "consent": consent(),
        "locale": "zh-CN",
        "client_request_id": "client-001",
        "texts": [
            {
                "source_id": "note:1",
                "source": "note",
                "content": content,
                "observed_at": None,
            }
        ],
        "signals": [],
        "image_contexts": [],
    }


def multipart_payload(payload: dict[str, Any]) -> dict[str, tuple[None, str, str]]:
    return {"payload": (None, json.dumps(payload, ensure_ascii=False), "application/json")}


def test_health_capabilities_and_openapi() -> None:
    client, _ = make_client()
    with client:
        assert client.get("/api/v1/health/live").status_code == 200
        ready = client.get("/api/v1/health/ready")
        assert ready.status_code == 200
        assert ready.json()["model"] == "gpt-5.6-sol"

        capabilities = client.get("/api/v1/capabilities").json()
        assert capabilities["raw_audio_upload_supported"] is False
        assert "image" in capabilities["supported_modalities"]

        openapi = client.get("/openapi.json").json()
        assert "/api/v1/profiles/analyze" in openapi["paths"]


def test_text_analysis_returns_valid_envelope() -> None:
    client, llm = make_client()
    with client:
        response = client.post(
            "/api/v1/profiles/analyze",
            files=multipart_payload(text_payload()),
            headers={"X-Request-ID": "test-request-001"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert body["request_id"] == "test-request-001"
    assert body["client_request_id"] == "client-001"
    assert body["model"] == "gpt-5.6-sol"
    assert body["modalities_used"] == ["text"]
    assert body["usage"]["total_tokens"] == 150
    assert len(llm.calls) == 1


def test_invalid_consent_and_empty_input_are_rejected_before_model() -> None:
    client, llm = make_client()
    invalid = text_payload()
    invalid["consent"]["ai_processing"] = False

    with client:
        response = client.post(
            "/api/v1/profiles/analyze",
            files=multipart_payload(invalid),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_payload"

        empty = {
            "consent": consent(),
            "locale": "zh-CN",
            "texts": [],
            "signals": [],
            "image_contexts": [],
        }
        response = client.post(
            "/api/v1/profiles/analyze",
            files=multipart_payload(empty),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_payload"

    assert not llm.calls


def test_backend_api_key_is_enforced_when_configured() -> None:
    client, _ = make_client(settings(app_api_keys="backend-secret"))
    files = multipart_payload(text_payload())
    with client:
        unauthorized = client.post("/api/v1/profiles/analyze", files=files)
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "unauthorized"

        authorized = client.post(
            "/api/v1/profiles/analyze",
            files=multipart_payload(text_payload()),
            headers={"X-API-Key": "backend-secret"},
        )
        assert authorized.status_code == 200


def test_valid_image_is_normalized_and_invalid_image_is_rejected() -> None:
    client, llm = make_client()
    source = BytesIO()
    Image.new("RGB", (900, 600), "navy").save(source, format="PNG")
    payload = text_payload()
    payload["consent"] = consent(media=True)
    payload["image_contexts"] = [
        {"index": 0, "source_id": "image:1", "description": "用户自己的记录页"}
    ]

    with client:
        files: list[tuple[str, tuple[Any, ...]]] = [
            ("payload", (None, json.dumps(payload, ensure_ascii=False), "application/json")),
            ("images", ("journal.png", source.getvalue(), "image/png")),
        ]
        response = client.post("/api/v1/profiles/analyze", files=files)
        assert response.status_code == 200, response.text
        processed = llm.calls[-1]["images"][0]
        assert processed.source_id == "image:1"
        assert processed.width <= 512
        assert processed.height <= 512
        assert processed.data_url.startswith("data:image/jpeg;base64,")

        invalid_files: list[tuple[str, tuple[Any, ...]]] = [
            ("payload", (None, json.dumps(payload, ensure_ascii=False), "application/json")),
            ("images", ("fake.png", b"not-an-image", "image/png")),
        ]
        invalid = client.post("/api/v1/profiles/analyze", files=invalid_files)
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "invalid_image"


def test_explicit_urgent_language_forces_safety_first_response() -> None:
    client, llm = make_client()
    with client:
        response = client.post(
            "/api/v1/profiles/analyze",
            files=multipart_payload(text_payload("我现在想自杀")),
        )

    assert response.status_code == 200
    profile = response.json()["profile"]
    assert profile["analysis_status"] == "safety_first"
    assert profile["safety_notice"]["level"] == "urgent_support_recommended"
    assert llm.calls[-1]["explicit_safety_hint"] is True


def test_hallucinated_evidence_id_is_rejected() -> None:
    client = make_client_with_llm(HallucinatedEvidenceLLM())
    with client:
        response = client.post(
            "/api/v1/profiles/analyze",
            files=multipart_payload(text_payload()),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "invalid_model_output"


def test_chunked_request_without_content_length_still_obeys_body_limit() -> None:
    client, llm = make_client(settings(max_request_bytes=64))
    raw = (
        b'--x\r\nContent-Disposition: form-data; name="payload"\r\n\r\n'
        + b"a" * 100
        + b"\r\n--x--\r\n"
    )

    def chunks():
        for offset in range(0, len(raw), 30):
            yield raw[offset : offset + 30]

    with client:
        response = client.post(
            "/api/v1/profiles/analyze",
            content=chunks(),
            headers={
                "Content-Type": "multipart/form-data; boundary=x",
                "Origin": "http://localhost:4173",
            },
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:4173"
    assert not llm.calls

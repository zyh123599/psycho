from functools import lru_cache
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlparse

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """运行配置；敏感值只从环境变量或未纳入版本控制的 .env 读取。"""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "心潮心理画像 API"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: SecretStr = SecretStr("")
    openai_model: str = "gpt-5.6-sol"
    openai_api_mode: Literal["chat_completions", "responses"] = "chat_completions"
    allow_insecure_openai_base_url: bool = False
    openai_timeout_seconds: float = 120.0
    openai_max_retries: int = 2
    openai_max_output_tokens: int = 3200
    openai_image_detail: Literal["low", "high", "auto"] = "auto"

    app_api_keys: str = ""
    cors_origins: str = (
        "http://localhost:4173,http://localhost:4174,http://localhost:8100,"
        "http://127.0.0.1:4173,http://127.0.0.1:8100,"
        "capacitor://localhost,https://localhost"
    )

    max_request_bytes: int = 25 * 1024 * 1024
    max_payload_json_bytes: int = 128 * 1024
    max_text_chars: int = 30_000
    max_images: int = 4
    max_image_bytes: int = 8 * 1024 * 1024
    max_image_pixels: int = 20_000_000
    max_image_dimension: int = 2048
    max_concurrent_analyses: int = 8

    @field_validator("openai_base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @field_validator("openai_model", "log_level")
    @classmethod
    def strip_non_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @model_validator(mode="after")
    def validate_security_boundaries(self) -> Self:
        parsed = urlparse(self.openai_base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("OPENAI_BASE_URL 必须是有效的 http(s) URL")

        is_local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if (
            parsed.scheme == "http"
            and not is_local
            and (self.environment == "production" or not self.allow_insecure_openai_base_url)
        ):
            raise ValueError(
                "远程 OPENAI_BASE_URL 使用了明文 HTTP；测试时需显式设置 "
                "ALLOW_INSECURE_OPENAI_BASE_URL=true，生产环境禁止使用明文上游"
            )

        if self.environment == "production" and not self.api_keys:
            raise ValueError("生产环境必须配置 APP_API_KEYS 或接入等价的用户鉴权")
        return self

    @property
    def api_keys(self) -> tuple[str, ...]:
        return tuple(item.strip() for item in self.app_api_keys.split(",") if item.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def llm_is_configured(self) -> bool:
        key = self.openai_api_key.get_secret_value().strip()
        return bool(key and self.openai_model and self.openai_base_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()

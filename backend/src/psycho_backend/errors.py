from typing import Any


class PublicError(Exception):
    """可安全返回给客户端的领域错误，不包含上游响应或敏感数据。"""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def invalid_payload(message: str, *, details: list[dict[str, Any]] | None = None) -> PublicError:
    return PublicError(status_code=422, code="invalid_payload", message=message, details=details)

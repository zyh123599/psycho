import logging
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from psycho_backend import __version__
from psycho_backend.api import router
from psycho_backend.config import Settings, get_settings
from psycho_backend.errors import PublicError
from psycho_backend.llm import OpenAIProfileLLM
from psycho_backend.service import ProfileService

logger = logging.getLogger(__name__)
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


class RequestBodyLimitMiddleware:
    """对有无 Content-Length 的请求都按实际接收字节限制大小。"""

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        received_body_bytes = 0

        async def limited_receive():  # type: ignore[no-untyped-def]
            nonlocal received_body_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_body_bytes += len(message.get("body", b""))
                if received_body_bytes > self.max_body_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "code": "request_too_large",
                            "message": f"请求体不能超过 {self.max_body_bytes} 字节",
                        },
                    )
            return message

        await self.app(scope, limited_receive, send)


def _error_content(
    *,
    request: Request,
    code: str,
    message: str,
    details: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": getattr(request.state, "request_id", "unknown"),
            "details": details,
        }
    }


def create_app(
    *,
    settings: Settings | None = None,
    profile_service: ProfileService | None = None,
) -> FastAPI:
    runtime_settings = settings or get_settings()
    logging.basicConfig(
        level=getattr(logging, runtime_settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owned_llm: OpenAIProfileLLM | None = None
        if profile_service is None:
            owned_llm = OpenAIProfileLLM(runtime_settings)
            app.state.profile_service = ProfileService(
                settings=runtime_settings,
                llm=owned_llm,
            )
        else:
            app.state.profile_service = profile_service
        try:
            yield
        finally:
            if owned_llm is not None:
                await owned_llm.close()

    app = FastAPI(
        title=runtime_settings.app_name,
        version=__version__,
        description=(
            "面向心潮 App 的多模态、非诊断性反思画像服务。"
            "原始输入只在单次请求内处理，默认不持久化。"
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings

    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_bytes=runtime_settings.max_request_bytes,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()

        content_length = request.headers.get("content-length")
        if (
            content_length
            and content_length.isdigit()
            and int(content_length) > runtime_settings.max_request_bytes
        ):
            response = JSONResponse(
                status_code=413,
                content=_error_content(
                    request=request,
                    code="request_too_large",
                    message=f"请求体不能超过 {runtime_settings.max_request_bytes} 字节",
                ),
            )
        else:
            response = await call_next(request)

        response.headers["X-Request-ID"] = request_id
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "request_complete method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response

    @app.exception_handler(PublicError)
    async def public_error_handler(request: Request, exc: PublicError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_content(
                request=request,
                code=exc.code,
                message=exc.message,
                details=exc.details,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            {
                "location": ".".join(str(part) for part in error["loc"]),
                "message": error["msg"],
                "error_type": error["type"],
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_error_content(
                request=request,
                code="request_validation_error",
                message="请求格式校验失败",
                details=details,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code", f"http_{exc.status_code}"))
            message = str(exc.detail.get("message", "请求处理失败"))
        else:
            code = f"http_{exc.status_code}"
            message = exc.detail if isinstance(exc.detail, str) else "请求处理失败"
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_content(
                request=request,
                code=code,
                message=message,
            ),
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled server error request_id=%s",
            getattr(request.state, "request_id", "unknown"),
            exc_info=exc,
        )
        return JSONResponse(
            status_code=500,
            content=_error_content(
                request=request,
                code="internal_error",
                message="服务内部错误",
            ),
        )

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {
            "service": runtime_settings.app_name,
            "version": __version__,
            "docs": "/docs",
            "redoc": "/redoc",
            "openapi": "/openapi.json",
        }

    app.include_router(router)
    # 最后添加使 CORS 成为最外层用户中间件，连大小限制和错误响应也带正确跨域头。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("psycho_backend.main:app", host="127.0.0.1", port=8000)

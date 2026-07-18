import asyncio
import base64
import warnings
from dataclasses import dataclass
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from psycho_backend.config import Settings
from psycho_backend.errors import PublicError
from psycho_backend.schemas import ImageContext

ACCEPTED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ACCEPTED_FORMATS = {"JPEG", "PNG", "WEBP"}


@dataclass(slots=True, frozen=True)
class ProcessedImage:
    source_id: str
    context: str
    data_url: str
    width: int
    height: int
    original_format: str


def _image_error(code: str, message: str, status_code: int = 422) -> PublicError:
    return PublicError(status_code=status_code, code=code, message=message)


def _normalize_image(raw: bytes, settings: Settings) -> tuple[bytes, int, int, str]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as probe:
                original_format = (probe.format or "").upper()
                width, height = probe.size
                if original_format not in ACCEPTED_FORMATS:
                    raise _image_error(
                        "unsupported_image_type",
                        "仅支持 JPEG、PNG 和 WebP 图片",
                        415,
                    )
                if width < 1 or height < 1 or width * height > settings.max_image_pixels:
                    raise _image_error("image_dimensions_exceeded", "图片像素尺寸超过限制", 413)
                if getattr(probe, "is_animated", False):
                    raise _image_error("animated_image_not_supported", "暂不支持动画图片", 415)
                probe.verify()

            with Image.open(BytesIO(raw)) as source:
                normalized = ImageOps.exif_transpose(source)
                normalized.load()
                if "A" in normalized.getbands():
                    rgba = normalized.convert("RGBA")
                    background = Image.new("RGB", rgba.size, "white")
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    normalized = background
                else:
                    normalized = normalized.convert("RGB")

                normalized.thumbnail(
                    (settings.max_image_dimension, settings.max_image_dimension),
                    Image.Resampling.LANCZOS,
                )
                output = BytesIO()
                normalized.save(output, format="JPEG", quality=88, optimize=True)
                encoded = output.getvalue()
                width, height = normalized.size
    except PublicError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _image_error("image_dimensions_exceeded", "图片像素尺寸超过限制", 413) from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise _image_error("invalid_image", "文件不是可解析的有效图片", 422) from None

    if len(encoded) > settings.max_image_bytes:
        raise _image_error("normalized_image_too_large", "图片处理后仍超过大小限制", 413)
    return encoded, width, height, original_format


async def process_images(
    uploads: list[UploadFile],
    contexts: list[ImageContext],
    settings: Settings,
) -> list[ProcessedImage]:
    if len(uploads) > settings.max_images:
        raise _image_error("too_many_images", f"最多上传 {settings.max_images} 张图片", 413)

    context_by_index = {item.index: item for item in contexts}
    if any(index >= len(uploads) for index in context_by_index):
        raise _image_error("invalid_image_context", "image_contexts.index 超出图片数组范围")

    processed: list[ProcessedImage] = []
    total_raw_bytes = 0
    for index, upload in enumerate(uploads):
        try:
            declared_type = (upload.content_type or "").lower()
            if declared_type not in ACCEPTED_CONTENT_TYPES | {"application/octet-stream", ""}:
                raise _image_error(
                    "unsupported_image_type",
                    "图片 Content-Type 必须是 image/jpeg、image/png 或 image/webp",
                    415,
                )

            raw = await upload.read(settings.max_image_bytes + 1)
            if len(raw) > settings.max_image_bytes:
                raise _image_error(
                    "image_too_large",
                    f"单张图片不能超过 {settings.max_image_bytes} 字节",
                    413,
                )
            total_raw_bytes += len(raw)
            if total_raw_bytes > settings.max_request_bytes:
                raise _image_error("request_too_large", "图片总大小超过请求限制", 413)

            encoded, width, height, original_format = await asyncio.to_thread(
                _normalize_image, raw, settings
            )
            context = context_by_index.get(index)
            source_id = context.source_id if context else f"image:{index + 1}"
            description = context.description if context else "用户未提供额外图片语境"
            data = base64.b64encode(encoded).decode("ascii")
            processed.append(
                ProcessedImage(
                    source_id=source_id,
                    context=description,
                    data_url=f"data:image/jpeg;base64,{data}",
                    width=width,
                    height=height,
                    original_format=original_format,
                )
            )
        finally:
            await upload.close()
    return processed

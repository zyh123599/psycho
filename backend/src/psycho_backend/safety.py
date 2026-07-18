import re
from collections.abc import Iterable

from psycho_backend.schemas import ProfileAnalyzePayload

_EXPLICIT_URGENT_PATTERNS = (
    re.compile(
        r"我(?:现在|马上|今晚|今天|这就)?(?:就)?(?:真的)?(?:想|要|准备|打算)(?:去)?"
        r"(?:自杀|结束(?:自己|我的)?生命|伤害自己)"
    ),
    re.compile(
        r"我(?:现在|马上|今晚|今天|这就)?(?:就)?(?:要|准备|打算)(?:去)?"
        r"(?:杀(?:了|死)?|伤害)(?:你|他|她|他们|她们|别人|某个人)"
    ),
    re.compile(
        r"\bI\s+(?:(?:am|'m)\s+going\s+to|want\s+to|plan\s+to|intend\s+to)\s+"
        r"(?:kill|hurt)\s+myself\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bI\s+(?:(?:am|'m)\s+going\s+to|want\s+to|plan\s+to|intend\s+to)\s+"
        r"(?:kill|hurt)\s+(?:you|him|her|them|someone)\b",
        re.IGNORECASE,
    ),
)


def has_explicit_urgent_texts(texts: Iterable[str]) -> bool:
    """本地高精度升级规则；只作展示短路，不等同于临床风险评估。"""

    return any(pattern.search(text) for text in texts for pattern in _EXPLICIT_URGENT_PATTERNS)


def has_explicit_urgent_language(payload: ProfileAnalyzePayload) -> bool:
    """兼容画像链路的本地升级检查。"""

    candidates = [item.content for item in payload.texts]
    candidates.extend(item.context or "" for item in payload.signals)
    candidates.extend(str(item.value) for item in payload.signals if isinstance(item.value, str))
    return has_explicit_urgent_texts(candidates)

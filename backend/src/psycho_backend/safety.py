import re

from psycho_backend.schemas import ProfileAnalyzePayload

_EXPLICIT_URGENT_PATTERNS = (
    re.compile(
        r"我(?:现在|马上|今晚|今天)?(?:真的)?(?:想|要|准备|打算)(?:去)?"
        r"(?:自杀|结束(?:自己|我的)?生命|伤害自己)"
    ),
    re.compile(
        r"\bI\s+(?:(?:am|'m)\s+going\s+to|want\s+to|plan\s+to|intend\s+to)\s+"
        r"(?:kill|hurt)\s+myself\b",
        re.IGNORECASE,
    ),
)


def has_explicit_urgent_language(payload: ProfileAnalyzePayload) -> bool:
    """高精度的展示升级规则，不是临床风险评估。"""

    candidates = [item.content for item in payload.texts]
    candidates.extend(item.context or "" for item in payload.signals)
    candidates.extend(str(item.value) for item in payload.signals if isinstance(item.value, str))
    return any(pattern.search(text) for text in candidates for pattern in _EXPLICIT_URGENT_PATTERNS)

"""Shared HTTP-response-to-exception mapping used by both the sync and async clients.

Kept in one place so the sync and async code paths can never drift on how a
given worker error is classified.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Optional

from .exceptions import (
    PrivedgeAPIError,
    PrivedgeAuthError,
    PrivedgeError,
    PrivedgeNERUnavailableError,
    PrivedgeRateLimitError,
    PrivedgeStrategyMismatchError,
)


def _parse_body(text: str) -> Dict[str, Any]:
    """Best-effort JSON parse of an error body.

    The worker returns JSON error bodies from every code path we care about
    (`Response.json(...)`), but a couple of paths (`405 Method not allowed`,
    `400 Invalid JSON`) return a plain-text `Response(...)`. Never raise from
    inside error handling because of that — fall back to `{}`.
    """
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def raise_for_error_response(
    status_code: int,
    text: str,
    headers: Mapping[str, str],
) -> None:
    """Raises the appropriate typed `PrivedgeError` subclass for a non-2xx response.

    Args:
        status_code: HTTP status code of the response.
        text: Raw response body (may or may not be JSON — see `_parse_body`).
        headers: Response headers, used for rate-limit and edge-limit info.

    Raises:
        PrivedgeAuthError: on 401.
        PrivedgeRateLimitError: on 429.
        PrivedgeStrategyMismatchError: on 400 with `code: "strategy_mismatch"`.
        PrivedgeNERUnavailableError: on 503 with `code: "ner_unavailable"`.
        PrivedgeAPIError: on any other non-2xx status.
    """
    body = _parse_body(text)
    message = body.get("error") or text or f"Privedge API error ({status_code})"

    if status_code == 401:
        raise PrivedgeAuthError(message, status_code=status_code, body=body)

    if status_code == 429:
        raise PrivedgeRateLimitError(
            message,
            status_code=status_code,
            body=body,
            limit=headers.get("X-RateLimit-Limit"),
            remaining=headers.get("X-RateLimit-Remaining"),
            reset=headers.get("X-RateLimit-Reset"),
            edge_limit=headers.get("X-Edge-Limit"),
            edge_remaining=headers.get("X-Edge-Remaining"),
        )

    code = body.get("code")

    if status_code == 400 and code == "strategy_mismatch":
        raise PrivedgeStrategyMismatchError(
            message,
            status_code=status_code,
            body=body,
            configured=body.get("configured"),
        )

    if status_code == 503 and code == "ner_unavailable":
        raise PrivedgeNERUnavailableError(message, status_code=status_code, body=body)

    raise PrivedgeAPIError(message, status_code=status_code, body=body)

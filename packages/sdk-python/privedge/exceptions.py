"""Typed exception hierarchy for the Privedge Python SDK.

The worker (`packages/worker/src/index.ts`) returns JSON error bodies with a
`code` field for the two domain-specific error cases and plain status codes
for the generic ones. This module maps those HTTP responses onto a typed
exception hierarchy so callers can `except PrivedgeRateLimitError` instead of
parsing strings out of a generic exception message.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class PrivedgeError(Exception):
    """Base class for all errors raised by the Privedge SDK.

    Attributes:
        message: Human-readable error message.
        status_code: HTTP status code returned by the worker, if applicable.
        body: Parsed JSON error body returned by the worker, if any.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.body = body or {}

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"{self.__class__.__name__}(status_code={self.status_code!r}, message={self.message!r})"


class PrivedgeAuthError(PrivedgeError):
    """Raised on HTTP 401 — missing or invalid API key.

    Mirrors the worker's `authError('Unauthorized — provide a valid Privedge
    API key', 401)` response from `validateKey`.
    """


class PrivedgeRateLimitError(PrivedgeError):
    """Raised on HTTP 429 — per-key rate limit exceeded.

    The worker sends `X-RateLimit-*` headers on every response and, when the
    limit is hit, `X-Edge-*` headers when the request was for edge inference
    (see `checkEdgeRateLimit` in the worker). Both sets are exposed here so
    callers can implement backoff without re-parsing raw headers.

    Attributes:
        limit: Value of `X-RateLimit-Limit` (or the `limit` field in the JSON
            body), if present.
        remaining: Value of `X-RateLimit-Remaining`, if present.
        reset: Value of `X-RateLimit-Reset`, if present.
        edge_limit: Value of `X-Edge-Limit`, if present (edge-inference rate
            limit, distinct from the general per-key limit).
        edge_remaining: Value of `X-Edge-Remaining`, if present.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        body: Optional[Dict[str, Any]] = None,
        limit: Optional[str] = None,
        remaining: Optional[str] = None,
        reset: Optional[str] = None,
        edge_limit: Optional[str] = None,
        edge_remaining: Optional[str] = None,
    ) -> None:
        super().__init__(message, status_code=status_code, body=body)
        self.limit = limit
        self.remaining = remaining
        self.reset = reset
        self.edge_limit = edge_limit
        self.edge_remaining = edge_remaining


class PrivedgeStrategyMismatchError(PrivedgeError):
    """Raised on HTTP 400 with `code: "strategy_mismatch"`.

    The worker raises this when a request's `pii_strategy` conflicts with a
    key that is fixed to `edge` or `anonymize` (only keys configured as
    `custom` accept a per-request override). This is a configuration error,
    not a transient failure — check your API key's configured strategy in
    the dashboard, or drop `pii_strategy` from the request.

    Attributes:
        configured: The key's actually configured strategy mode, echoed back
            by the worker as `body["configured"]`.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        body: Optional[Dict[str, Any]] = None,
        configured: Optional[str] = None,
    ) -> None:
        super().__init__(message, status_code=status_code, body=body)
        self.configured = configured


class PrivedgeNERUnavailableError(PrivedgeError):
    """Raised on HTTP 503 with `code: "ner_unavailable"`.

    This means the semantic (NER) detection layer failed for a Pro/Enterprise
    key on the `anonymize` strategy (Workers AI timeout, malformed model
    output, rate limit — see the `nerResult.error` fail-safe in the worker's
    `/v1/chat/completions` handler). The worker refused to forward the prompt
    to the cloud provider because it could not guarantee PII was stripped.

    Importantly: **no data was leaked**. The request was never sent to the
    cloud LLM. This error is safe and expected to be retried — the failure is
    in the detection layer, not in your prompt or API key. A tight retry
    with backoff is the correct response.
    """


class PrivedgeAPIError(PrivedgeError):
    """Raised for any other non-2xx response the worker returns.

    Covers cases such as HTTP 405 (method not allowed), HTTP 502 (edge
    inference failure in Workers AI), and pass-through errors from the
    upstream cloud provider forwarded by `routeToCloud` / `routeToCloudAnon`.
    """

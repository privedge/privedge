"""Synchronous Privedge client.

Uses `httpx.Client` for transport. See the package README for the
sync-vs-async dependency rationale — in short, `httpx` gives the sync and
async clients (`client.py` / `async_client.py`) an (almost) identical API,
first-class typed timeouts, and connection pooling, at the cost of one
dependency shared by both clients (so it isn't "two dependencies" in
practice).
"""

from __future__ import annotations

from types import TracebackType
from typing import Any, Dict, List, Optional, Type

import httpx

from ._errors import raise_for_error_response
from .exceptions import PrivedgeAPIError
from .types import ChatCompletionResponse, DetectResponse, KeyInfo, Message, PiiStrategy

DEFAULT_TIMEOUT = 60.0
"""Default request timeout in seconds. Cloud LLM calls can be slow; NER adds
an extra Workers AI round-trip on Pro/Enterprise, so this errs generous
rather than causing spurious timeouts on legitimate slow completions."""


class _ChatCompletions:
    """Namespace for `client.chat.completions.create(...)`, mirroring the OpenAI SDK shape."""

    def __init__(self, client: "Privedge") -> None:
        self._client = client

    def create(
        self,
        *,
        messages: List[Message],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        pii_strategy: Optional[PiiStrategy] = None,
    ) -> ChatCompletionResponse:
        """Sends a chat completion request through the Privedge proxy.

        The worker detects PII/secrets in `messages`, then either anonymizes
        before forwarding to the cloud LLM, routes to an on-edge Workers AI
        model, or passes through untouched — depending on the key's
        configured strategy and what was found. See
        `ChatCompletionResponse` for what each response field means.

        Args:
            messages: Conversation so far, OpenAI-compatible shape.
            model: Model identifier forwarded to the configured provider
                (e.g. ``"gpt-5.4-nano"``, ``"claude-opus-4-6"``). Optional:
                when omitted (``None``), the worker falls back to the
                ``cloud_model`` configured on the API key. Passing it here
                always wins over the key's default, which keeps this a
                drop-in OpenAI replacement and is the only way to choose a
                model on a self-hosted deployment, where there is no
                dashboard to configure one. When ``None``, the ``model`` key
                is omitted from the request body entirely (never sent as
                ``null``) — the worker only honors a request-supplied model
                when ``typeof body.model === "string"``.
            temperature: Optional sampling temperature, forwarded as-is.
            max_tokens: Optional max output tokens, forwarded as-is. The
                worker renames this to ``max_completion_tokens`` internally
                for models that require it (o1/o3/gpt-5.x) — no action
                needed on the caller's part.
            pii_strategy: Per-request override of ``"edge"`` or
                ``"anonymize"``. Only honored when the API key is configured
                as ``custom``; otherwise a conflicting value raises
                `PrivedgeStrategyMismatchError`.

        Returns:
            The parsed chat completion response.

        Raises:
            PrivedgeAuthError: invalid or missing API key.
            PrivedgeRateLimitError: per-key rate limit exceeded.
            PrivedgeStrategyMismatchError: `pii_strategy` conflicts with a
                fixed key configuration.
            PrivedgeNERUnavailableError: semantic PII detection failed and
                the worker refused to forward the prompt unguarded. Safe to
                retry — nothing was sent to the cloud provider.
            PrivedgeAPIError: any other non-2xx response.

        Note:
            Streaming (``stream=True``) is intentionally not supported. The
            worker has no streaming code path — every response is built with
            a single `Response.json(...)` after the full upstream response is
            read, so there is nothing to stream.
        """
        payload: Dict[str, Any] = {"messages": messages}
        if model is not None:
            payload["model"] = model
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if pii_strategy is not None:
            payload["pii_strategy"] = pii_strategy

        data = self._client._post("/v1/chat/completions", payload)
        return ChatCompletionResponse.from_dict(data)


class _Chat:
    def __init__(self, client: "Privedge") -> None:
        self.completions = _ChatCompletions(client)


class _Keys:
    """Namespace for `client.keys.info()`."""

    def __init__(self, client: "Privedge") -> None:
        self._client = client

    def info(self) -> KeyInfo:
        """Fetches metadata about the configured API key via `GET /v1/keys/info`.

        Returns:
            Provider, provider mode (``managed``/``byok``), and default
            cloud model configured for this key.

        Raises:
            PrivedgeAuthError: invalid or missing API key.
            PrivedgeAPIError: any other non-2xx response.
        """
        data = self._client._get("/v1/keys/info")
        return KeyInfo.from_dict(data)


class Privedge:
    """Synchronous client for the Privedge compliance proxy.

    Example:
        >>> from privedge import Privedge
        >>> client = Privedge(api_key="pvdg_live_...", worker_url="https://edge.privedge.io")
        >>> resp = client.chat.completions.create(
        ...     model="gpt-5.4-nano",
        ...     messages=[{"role": "user", "content": "..."}],
        ... )
        >>> resp.choices[0].message["content"]

    Also usable as a context manager to close the underlying HTTP session:
        >>> with Privedge(api_key="...", worker_url="...") as client:
        ...     client.chat.completions.create(...)
    """

    def __init__(
        self,
        *,
        api_key: str,
        worker_url: str,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        """
        Args:
            api_key: Privedge API key (``pvdg_live_...`` / ``pvdg_test_...``).
            worker_url: Base URL of the Privedge worker deployment, e.g.
                ``"https://edge.privedge.io"``. A trailing slash is stripped.
            timeout: Request timeout in seconds, applied to connect/read/write/pool.
        """
        self.api_key = api_key
        self.worker_url = worker_url.rstrip("/")
        self.timeout = timeout
        self._http = httpx.Client(timeout=timeout)
        self.chat = _Chat(self)
        self.keys = _Keys(self)

    def detect(self, *, messages: List[Message]) -> DetectResponse:
        """Runs PII/secret detection without sending anything to an LLM.

        Wraps `POST /v1/detect`. Useful for a dry-run compliance check, or to
        show a user what would be redacted before they commit to a request.

        Args:
            messages: Conversation to inspect, OpenAI-compatible shape.

        Returns:
            Detected PII types/counts, whether a secret was found, the
            sanitized (anonymized) messages, and whether the semantic (NER)
            layer ran (`DetectResponse.ner_ran` — see its docstring: an empty
            result with `ner_ran=False` means nothing was searched for, not
            that the text is clean).

        Raises:
            PrivedgeAuthError: invalid or missing API key.
            PrivedgeRateLimitError: per-key rate limit exceeded.
            PrivedgeAPIError: any other non-2xx response.

        Note:
            Unlike `chat.completions.create`, this endpoint never raises
            `PrivedgeNERUnavailableError` — it's an inspection endpoint, not
            an egress path, so a NER failure here is reported via
            `DetectResponse.ner_error` instead of blocking the response.
        """
        data = self._post("/v1/detect", {"messages": messages})
        return DetectResponse.from_dict(data)

    def close(self) -> None:
        """Closes the underlying HTTP session. Safe to call multiple times."""
        self._http.close()

    def __enter__(self) -> "Privedge":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self._http.post(
                f"{self.worker_url}{path}", headers=self._headers(), json=payload
            )
        except httpx.TimeoutException as exc:
            raise PrivedgeAPIError(f"Request to {path} timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise PrivedgeAPIError(f"Request to {path} failed: {exc}") from exc

        if response.status_code >= 400:
            raise_for_error_response(response.status_code, response.text, response.headers)
        return response.json()

    def _get(self, path: str) -> Dict[str, Any]:
        try:
            response = self._http.get(f"{self.worker_url}{path}", headers=self._headers())
        except httpx.TimeoutException as exc:
            raise PrivedgeAPIError(f"Request to {path} timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise PrivedgeAPIError(f"Request to {path} failed: {exc}") from exc

        if response.status_code >= 400:
            raise_for_error_response(response.status_code, response.text, response.headers)
        return response.json()

"""Asynchronous Privedge client.

Uses `httpx.AsyncClient`. Mirrors `client.py` method-for-method — the only
difference is `async def` / `await`. Kept as a near-duplicate rather than a
shared-base abstraction on purpose: the two clients are short enough that a
generic base class would cost more in indirection than it saves in
duplication, and it keeps each client's control flow trivially readable on
its own (matches the TS SDK's preference for simplicity over cleverness).
"""

from __future__ import annotations

from types import TracebackType
from typing import Any, Dict, List, Optional, Type

import httpx

from ._errors import raise_for_error_response
from .exceptions import PrivedgeAPIError
from .types import ChatCompletionResponse, DetectResponse, KeyInfo, Message, PiiStrategy
from .client import DEFAULT_TIMEOUT


class _AsyncChatCompletions:
    def __init__(self, client: "AsyncPrivedge") -> None:
        self._client = client

    async def create(
        self,
        *,
        model: str,
        messages: List[Message],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        pii_strategy: Optional[PiiStrategy] = None,
    ) -> ChatCompletionResponse:
        """Async counterpart of `privedge.client.Privedge.chat.completions.create`.

        See that method's docstring for full parameter and error semantics —
        identical here, only awaited.
        """
        payload: Dict[str, Any] = {"model": model, "messages": messages}
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if pii_strategy is not None:
            payload["pii_strategy"] = pii_strategy

        data = await self._client._post("/v1/chat/completions", payload)
        return ChatCompletionResponse.from_dict(data)


class _AsyncChat:
    def __init__(self, client: "AsyncPrivedge") -> None:
        self.completions = _AsyncChatCompletions(client)


class _AsyncKeys:
    def __init__(self, client: "AsyncPrivedge") -> None:
        self._client = client

    async def info(self) -> KeyInfo:
        """Async counterpart of `privedge.client.Privedge.keys.info`."""
        data = await self._client._get("/v1/keys/info")
        return KeyInfo.from_dict(data)


class AsyncPrivedge:
    """Asynchronous client for the Privedge compliance proxy.

    Example:
        >>> import asyncio
        >>> from privedge import AsyncPrivedge
        >>> async def main():
        ...     async with AsyncPrivedge(api_key="pvdg_live_...", worker_url="https://edge.privedge.io") as client:
        ...         resp = await client.chat.completions.create(
        ...             model="gpt-5.4-nano",
        ...             messages=[{"role": "user", "content": "..."}],
        ...         )
        ...         print(resp.choices[0].message["content"])
        >>> asyncio.run(main())
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
            worker_url: Base URL of the Privedge worker deployment. Trailing
                slash is stripped.
            timeout: Request timeout in seconds, applied to connect/read/write/pool.
        """
        self.api_key = api_key
        self.worker_url = worker_url.rstrip("/")
        self.timeout = timeout
        self._http = httpx.AsyncClient(timeout=timeout)
        self.chat = _AsyncChat(self)
        self.keys = _AsyncKeys(self)

    async def detect(self, *, messages: List[Message]) -> DetectResponse:
        """Async counterpart of `privedge.client.Privedge.detect`."""
        data = await self._post("/v1/detect", {"messages": messages})
        return DetectResponse.from_dict(data)

    async def close(self) -> None:
        """Closes the underlying HTTP session. Safe to call multiple times."""
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncPrivedge":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await self.close()

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    async def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = await self._http.post(
                f"{self.worker_url}{path}", headers=self._headers(), json=payload
            )
        except httpx.TimeoutException as exc:
            raise PrivedgeAPIError(f"Request to {path} timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise PrivedgeAPIError(f"Request to {path} failed: {exc}") from exc

        if response.status_code >= 400:
            raise_for_error_response(response.status_code, response.text, response.headers)
        return response.json()

    async def _get(self, path: str) -> Dict[str, Any]:
        try:
            response = await self._http.get(f"{self.worker_url}{path}", headers=self._headers())
        except httpx.TimeoutException as exc:
            raise PrivedgeAPIError(f"Request to {path} timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise PrivedgeAPIError(f"Request to {path} failed: {exc}") from exc

        if response.status_code >= 400:
            raise_for_error_response(response.status_code, response.text, response.headers)
        return response.json()

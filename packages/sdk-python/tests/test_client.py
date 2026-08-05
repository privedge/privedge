"""Tests for the Privedge Python SDK.

All HTTP calls are mocked via `respx` (an httpx-native mocking library) —
no real network calls are made. Covers response parsing (including
`ner_ran`), the full typed exception hierarchy, and both the sync and async
clients.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from privedge import (
    AsyncPrivedge,
    Privedge,
    PrivedgeAPIError,
    PrivedgeAuthError,
    PrivedgeNERUnavailableError,
    PrivedgeRateLimitError,
    PrivedgeStrategyMismatchError,
)

WORKER_URL = "https://edge.privedge.example"
API_KEY = "pvdg_test_abc123"


def _chat_url() -> str:
    return f"{WORKER_URL}/v1/chat/completions"


def _detect_url() -> str:
    return f"{WORKER_URL}/v1/detect"


def _keys_url() -> str:
    return f"{WORKER_URL}/v1/keys/info"


def _success_body(**overrides):
    body = {
        "id": "chatcmpl-abc123",
        "object": "chat.completion",
        "model": "gpt-5.4-nano",
        "routed_to": "cloud",
        "anonymized": True,
        "pii_matches": 2,
        "ner_entities": ["PERSON"],
        "ner_ran": True,
        "latency_ms": 842,
        "applied_strategy": "anonymize",
        "strategy_mode": "anonymize",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "Hello, redacted."},
                "finish_reason": "stop",
            }
        ],
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


class TestChatCompletionParsing:
    @respx.mock
    def test_parses_successful_response(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )

        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            resp = client.chat.completions.create(
                model="gpt-5.4-nano",
                messages=[{"role": "user", "content": "hi, my name is John Smith"}],
            )

        assert resp.id == "chatcmpl-abc123"
        assert resp.model == "gpt-5.4-nano"
        assert resp.routed_to == "cloud"
        assert resp.anonymized is True
        assert resp.pii_matches == 2
        assert resp.ner_entities == ["PERSON"]
        assert resp.latency_ms == 842
        assert resp.applied_strategy == "anonymize"
        assert resp.strategy_mode == "anonymize"
        assert len(resp.choices) == 1
        assert resp.choices[0].message["content"] == "Hello, redacted."
        assert resp.choices[0].finish_reason == "stop"

    @respx.mock
    def test_ner_ran_true_reflected(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body(ner_ran=True, ner_entities=["PERSON", "ORG"]))
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            resp = client.chat.completions.create(
                model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
            )
        assert resp.ner_ran is True
        assert resp.ner_entities == ["PERSON", "ORG"]

    @respx.mock
    def test_ner_ran_false_on_free_tier_reflected_even_with_matches(self):
        """Free tier: regex still finds PII, but ner_ran is False and
        ner_entities stays empty — this must NOT be conflated with 'no PII'."""
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                200,
                json=_success_body(ner_ran=False, ner_entities=[], pii_matches=1),
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            resp = client.chat.completions.create(
                model="gpt-5.4-nano", messages=[{"role": "user", "content": "DNI 12345678Z"}]
            )
        assert resp.ner_ran is False
        assert resp.ner_entities == []
        assert resp.pii_matches == 1  # regex still caught something

    @respx.mock
    def test_detect_parses_response_including_ner_error(self):
        respx.post(_detect_url()).mock(
            return_value=httpx.Response(
                200,
                json={
                    "pii_types": ["EMAIL"],
                    "pii_type_counts": {"EMAIL": 1},
                    "pii_count": 1,
                    "has_secret": False,
                    "sanitized_messages": [{"role": "user", "content": "[ANON_EMAIL_1]"}],
                    "ner_ran": True,
                    "ner_error": True,
                },
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            resp = client.detect(messages=[{"role": "user", "content": "a@b.com"}])

        assert resp.pii_types == ["EMAIL"]
        assert resp.pii_count == 1
        assert resp.ner_ran is True
        assert resp.ner_error is True

    @respx.mock
    def test_keys_info_parses_response(self):
        respx.get(_keys_url()).mock(
            return_value=httpx.Response(
                200,
                json={"provider": "anthropic", "provider_mode": "byok", "cloud_model": "claude-opus-4-6"},
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            info = client.keys.info()

        assert info.provider == "anthropic"
        assert info.provider_mode == "byok"
        assert info.cloud_model == "claude-opus-4-6"


# ---------------------------------------------------------------------------
# Typed exceptions
# ---------------------------------------------------------------------------


class TestExceptions:
    @respx.mock
    def test_401_raises_auth_error(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                401, json={"error": "Unauthorized — provide a valid Privedge API key"}
            )
        )
        with Privedge(api_key="bad", worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeAuthError) as exc_info:
                client.chat.completions.create(model="gpt-5.4-nano", messages=[])
        assert exc_info.value.status_code == 401

    @respx.mock
    def test_429_raises_rate_limit_error_with_headers(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                429,
                json={"error": "Rate limit exceeded", "limit": 100, "tier": "free"},
                headers={
                    "X-RateLimit-Limit": "100",
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": "1712345678",
                },
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeRateLimitError) as exc_info:
                client.chat.completions.create(model="gpt-5.4-nano", messages=[])

        err = exc_info.value
        assert err.status_code == 429
        assert err.limit == "100"
        assert err.remaining == "0"
        assert err.reset == "1712345678"

    @respx.mock
    def test_429_edge_rate_limit_headers_exposed(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                429,
                json={"error": "Edge inference rate limit exceeded", "limit": 10, "tier": "free"},
                headers={
                    "X-RateLimit-Limit": "100",
                    "X-RateLimit-Remaining": "50",
                    "X-RateLimit-Reset": "1712345678",
                    "X-Edge-Limit": "10",
                    "X-Edge-Remaining": "0",
                },
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeRateLimitError) as exc_info:
                client.chat.completions.create(model="gpt-5.4-nano", messages=[])

        err = exc_info.value
        assert err.edge_limit == "10"
        assert err.edge_remaining == "0"

    @respx.mock
    def test_400_strategy_mismatch_raises_typed_error(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                400,
                json={
                    "error": "Invalid pii_strategy 'edge' for the provided API key (configured as 'anonymize').",
                    "code": "strategy_mismatch",
                    "configured": "anonymize",
                },
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeStrategyMismatchError) as exc_info:
                client.chat.completions.create(
                    model="gpt-5.4-nano",
                    messages=[{"role": "user", "content": "hi"}],
                    pii_strategy="edge",
                )
        assert exc_info.value.configured == "anonymize"
        assert exc_info.value.status_code == 400

    @respx.mock
    def test_503_ner_unavailable_raises_typed_error(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                503,
                json={
                    "error": (
                        "PII detection (NER) is temporarily unavailable, so anonymization "
                        "cannot be guaranteed for this request. Retry shortly."
                    ),
                    "code": "ner_unavailable",
                },
            )
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeNERUnavailableError) as exc_info:
                client.chat.completions.create(
                    model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
                )
        assert exc_info.value.status_code == 503

    @respx.mock
    def test_other_status_raises_generic_api_error(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(502, json={"error": "Edge inference failed", "model": "x"})
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeAPIError) as exc_info:
                client.chat.completions.create(
                    model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
                )
        assert exc_info.value.status_code == 502
        # Ensure it's the generic error, not a subclass
        assert type(exc_info.value) is PrivedgeAPIError

    @respx.mock
    def test_non_json_error_body_does_not_crash(self):
        """405 Method not allowed returns a plain-text body in the worker, not JSON."""
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(405, text="Method not allowed")
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeAPIError) as exc_info:
                client.chat.completions.create(
                    model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
                )
        assert exc_info.value.status_code == 405


# ---------------------------------------------------------------------------
# Context manager
# ---------------------------------------------------------------------------


class TestContextManager:
    def test_sync_context_manager_closes_session(self):
        client = Privedge(api_key=API_KEY, worker_url=WORKER_URL)
        assert client._http.is_closed is False
        with client:
            pass
        assert client._http.is_closed is True

    def test_sync_close_is_idempotent(self):
        client = Privedge(api_key=API_KEY, worker_url=WORKER_URL)
        client.close()
        client.close()  # must not raise
        assert client._http.is_closed is True

    @pytest.mark.asyncio
    async def test_async_context_manager_closes_session(self):
        client = AsyncPrivedge(api_key=API_KEY, worker_url=WORKER_URL)
        assert client._http.is_closed is False
        async with client:
            pass
        assert client._http.is_closed is True


# ---------------------------------------------------------------------------
# Async client parity
# ---------------------------------------------------------------------------


class TestAsyncClient:
    @respx.mock
    @pytest.mark.asyncio
    async def test_async_parses_successful_response_with_ner_ran(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body(ner_ran=True))
        )
        async with AsyncPrivedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            resp = await client.chat.completions.create(
                model="gpt-5.4-nano",
                messages=[{"role": "user", "content": "hi"}],
            )
        assert resp.ner_ran is True
        assert resp.choices[0].message["content"] == "Hello, redacted."

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_raises_typed_ner_unavailable_error(self):
        respx.post(_chat_url()).mock(
            return_value=httpx.Response(
                503, json={"error": "NER unavailable", "code": "ner_unavailable"}
            )
        )
        async with AsyncPrivedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            with pytest.raises(PrivedgeNERUnavailableError):
                await client.chat.completions.create(
                    model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
                )

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_detect(self):
        respx.post(_detect_url()).mock(
            return_value=httpx.Response(
                200,
                json={
                    "pii_types": [],
                    "pii_type_counts": {},
                    "pii_count": 0,
                    "has_secret": False,
                    "sanitized_messages": [{"role": "user", "content": "hi"}],
                    "ner_ran": False,
                },
            )
        )
        async with AsyncPrivedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            resp = await client.detect(messages=[{"role": "user", "content": "hi"}])
        assert resp.pii_count == 0
        assert resp.ner_ran is False
        assert resp.ner_error is None


# ---------------------------------------------------------------------------
# Request construction
# ---------------------------------------------------------------------------


class TestRequestConstruction:
    @respx.mock
    def test_sends_bearer_auth_header(self):
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        with Privedge(api_key="pvdg_live_secret", worker_url=WORKER_URL) as client:
            client.chat.completions.create(model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}])

        assert route.calls.last.request.headers["Authorization"] == "Bearer pvdg_live_secret"

    @respx.mock
    def test_pii_strategy_included_only_when_set(self):
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            client.chat.completions.create(model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}])

        import json

        sent_body = json.loads(route.calls.last.request.content)
        assert "pii_strategy" not in sent_body

    @respx.mock
    def test_trailing_slash_in_worker_url_is_stripped(self):
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL + "/") as client:
            client.chat.completions.create(model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}])
        assert route.called

    @respx.mock
    def test_model_omitted_is_not_sent_in_body(self):
        """Omitting `model` must not send `model: null` — the worker only
        falls back to the key's `cloud_model` when the field is absent
        entirely (`typeof body.model === 'string'` check)."""
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            client.chat.completions.create(messages=[{"role": "user", "content": "hi"}])

        import json

        sent_body = json.loads(route.calls.last.request.content)
        assert "model" not in sent_body

    @respx.mock
    def test_model_passed_is_sent_in_body(self):
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        with Privedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            client.chat.completions.create(
                model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
            )

        import json

        sent_body = json.loads(route.calls.last.request.content)
        assert sent_body["model"] == "gpt-5.4-nano"


class TestAsyncRequestConstruction:
    @respx.mock
    @pytest.mark.asyncio
    async def test_async_model_omitted_is_not_sent_in_body(self):
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        async with AsyncPrivedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            await client.chat.completions.create(messages=[{"role": "user", "content": "hi"}])

        import json

        sent_body = json.loads(route.calls.last.request.content)
        assert "model" not in sent_body

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_model_passed_is_sent_in_body(self):
        route = respx.post(_chat_url()).mock(
            return_value=httpx.Response(200, json=_success_body())
        )
        async with AsyncPrivedge(api_key=API_KEY, worker_url=WORKER_URL) as client:
            await client.chat.completions.create(
                model="gpt-5.4-nano", messages=[{"role": "user", "content": "hi"}]
            )

        import json

        sent_body = json.loads(route.calls.last.request.content)
        assert sent_body["model"] == "gpt-5.4-nano"

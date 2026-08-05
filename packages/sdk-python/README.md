# privedge (Python SDK)

**Privacy on the edge.** Python client for the Privedge compliance proxy — a
drop-in-style AI inference gateway that detects PII/secrets in your prompts
and either anonymizes them before forwarding to a cloud LLM, routes
inference to a Cloudflare edge model instead (no external call at all), or
passes clean prompts through untouched.

Functional parity with [`@privedge/sdk`](../sdk) (TypeScript). See the [root
README](../../README.md) for how the proxy itself works.

## Install

```bash
pip install privedge
```

Requires Python 3.9+. The only runtime dependency is [`httpx`](https://www.python-httpx.org/) (see [Dependencies](#dependencies)).

## Quickstart — sync

```python
from privedge import Privedge

client = Privedge(api_key="pvdg_live_...", worker_url="https://edge.privedge.io")

resp = client.chat.completions.create(
    model="gpt-5.4-nano",
    messages=[{"role": "user", "content": "Summarize this patient record..."}],
)

print(resp.choices[0].message["content"])
print(resp.routed_to)     # "edge" | "cloud"
print(resp.anonymized)    # True if PII was redacted before the cloud call
print(resp.pii_matches)   # number of PII tokens detected
print(resp.ner_ran)       # whether semantic (NER) detection ran — see below
```

Or as a context manager, to close the HTTP session automatically:

```python
with Privedge(api_key="pvdg_live_...", worker_url="https://edge.privedge.io") as client:
    resp = client.chat.completions.create(
        model="gpt-5.4-nano",
        messages=[{"role": "user", "content": "..."}],
    )
```

## Quickstart — async

```python
import asyncio
from privedge import AsyncPrivedge

async def main():
    async with AsyncPrivedge(api_key="pvdg_live_...", worker_url="https://edge.privedge.io") as client:
        resp = await client.chat.completions.create(
            model="gpt-5.4-nano",
            messages=[{"role": "user", "content": "..."}],
        )
        print(resp.choices[0].message["content"])

asyncio.run(main())
```

## Other endpoints

```python
# Dry-run PII/secret detection, no LLM call
detect = client.detect(messages=[{"role": "user", "content": "My DNI is 12345678Z"}])
print(detect.pii_types, detect.pii_count, detect.has_secret, detect.ner_ran)

# API key metadata
info = client.keys.info()
print(info.provider, info.provider_mode, info.cloud_model)
```

## `ner_ran` — read this before you rely on empty PII results

Every response — `ChatCompletionResponse` and `DetectResponse` — carries a
boolean `ner_ran` field.

The semantic detection layer (Named Entity Recognition — catches person
names, organizations, and street addresses that regex cannot) is gated
behind the **Pro/Enterprise** tier. On the **Free** tier it never runs, so
`ner_entities` (or `pii_types` restricted to NER-only categories) is
**always empty** — not because your prompt is clean, but because names,
organizations and addresses were **never looked for**.

```python
resp = client.chat.completions.create(model="gpt-5.4-nano", messages=[...])

if not resp.ner_ran:
    # resp.ner_entities == [] here tells you NOTHING about whether the
    # prompt contains a person's name, a hospital name, or a street address.
    # Only regex-coverable PII (SSN, DNI, email, credit cards, phone, etc.)
    # was checked.
    ...
```

Always check `ner_ran` before treating an empty `ner_entities` (or the
absence of NER-only types in `pii_types`) as "this prompt has no PII." Treat
it as "no PII of the types actually checked."

## Response fields

### `ChatCompletionResponse`

| Field | Type | Meaning |
|---|---|---|
| `id` | `str` | Completion id (provider-assigned, or `chatcmpl-edge-<ts>` for edge routing) |
| `object` | `str` | Always `"chat.completion"` |
| `model` | `str` | Model that actually served the request |
| `choices` | `list[ChatCompletionChoice]` | OpenAI-compatible choices, each with `index`, `message`, `finish_reason` |
| `routed_to` | `"edge" \| "cloud"` | Where inference actually ran |
| `anonymized` | `bool` | Whether PII was redacted before the cloud call |
| `pii_matches` | `int` | Total PII tokens matched (regex + NER combined) |
| `ner_entities` | `list[str]` | Entity **types** found by NER (e.g. `["PERSON", "ORG"]`) — always `[]` when `ner_ran` is `False` |
| `ner_ran` | `bool` | Whether the semantic (NER) layer ran — see [above](#ner_ran--read-this-before-you-rely-on-empty-pii-results) |
| `latency_ms` | `int` | End-to-end latency measured by the worker |
| `applied_strategy` | `"anonymize" \| "edge"` | Strategy actually applied to this request |
| `strategy_mode` | `"anonymize" \| "edge" \| "custom"` | The API key's configured mode |
| `raw` | `dict` | Unparsed JSON body, for fields not yet modeled |

### `DetectResponse` (from `client.detect(...)`)

| Field | Type | Meaning |
|---|---|---|
| `pii_types` | `list[str]` | Distinct PII types found |
| `pii_type_counts` | `dict[str, int]` | Count per type |
| `pii_count` | `int` | Total count across all types |
| `has_secret` | `bool` | Whether a secret pattern (API key, JWT, DB connection string) was found |
| `sanitized_messages` | `list[Message]` | Messages with PII replaced by `[ANON_<TYPE>_<n>]` tokens |
| `ner_ran` | `bool` | Same caveat as above |
| `ner_error` | `bool \| None` | `True` if NER was attempted (paid tier) but failed. **Not blocking** — unlike `chat.completions.create`, this endpoint returns 200 either way; check this field explicitly |

### `KeyInfo` (from `client.keys.info()`)

| Field | Type | Meaning |
|---|---|---|
| `provider` | `str` | e.g. `"openai"`, `"anthropic"` |
| `provider_mode` | `str` | `"managed"` (Privedge's own provider keys) or `"byok"` |
| `cloud_model` | `str \| None` | Default cloud model configured for this key |

## Exceptions

All errors raised by the SDK derive from `PrivedgeError`, which carries
`.message`, `.status_code`, and `.body` (the parsed JSON error payload, if
any).

| Exception | When | Notes |
|---|---|---|
| `PrivedgeAuthError` | HTTP 401 | Missing or invalid API key |
| `PrivedgeRateLimitError` | HTTP 429 | Also exposes `.limit`, `.remaining`, `.reset`, `.edge_limit`, `.edge_remaining` from the `X-RateLimit-*` / `X-Edge-*` response headers |
| `PrivedgeStrategyMismatchError` | HTTP 400, `code: "strategy_mismatch"` | A request-level `pii_strategy` conflicts with a key fixed to `edge`/`anonymize`. Also exposes `.configured`. This is a config error — fix your key or drop the field, don't retry blindly |
| `PrivedgeNERUnavailableError` | HTTP 503, `code: "ner_unavailable"` | Semantic detection failed on a Pro/Enterprise key using the `anonymize` strategy, and the worker refused to forward the prompt without a PII guarantee. **No data was sent to the cloud provider.** Safe and expected to retry with backoff |
| `PrivedgeAPIError` | Any other non-2xx | Includes upstream provider errors and edge-inference failures (502) |

```python
from privedge import Privedge, PrivedgeNERUnavailableError, PrivedgeRateLimitError

with Privedge(api_key="...", worker_url="...") as client:
    try:
        resp = client.chat.completions.create(model="gpt-5.4-nano", messages=[...])
    except PrivedgeNERUnavailableError:
        # Nothing leaked — detection failed closed. Retry shortly.
        ...
    except PrivedgeRateLimitError as e:
        print(f"retry after reset={e.reset}, remaining={e.remaining}")
```

## Detection scope by tier

| Layer | Free | Pro / Enterprise |
|---|---|---|
| Regex (deterministic: SSN, credit cards, IBAN, DNI/NIE, email, phone, dates, medical IDs, secrets) | Yes | Yes |
| NER — person names, organizations, street addresses (Workers AI `llama-3.3-70b`) | **No** | Yes |

On Free, `client.detect(...)` and `chat.completions.create(...)` only ever
check the deterministic regex layer. If your prompts might contain names of
patients, clients, or organizations and that matters for your compliance
posture, you need a Pro/Enterprise key — `ner_ran=False` on Free is not a
bug, it's the tier boundary made visible instead of silently assumed.

## Model resolution

`model` is optional on `chat.completions.create(...)`:

```python
# model omitted — the worker falls back to the cloud_model configured on
# the API key (see client.keys.info().cloud_model)
resp = client.chat.completions.create(
    messages=[{"role": "user", "content": "..."}],
)

# model passed — always wins over the key's configured default
resp = client.chat.completions.create(
    model="gpt-5.4-nano",
    messages=[{"role": "user", "content": "..."}],
)
```

Passing `model` always takes precedence over the key's configured
`cloud_model`. This keeps the SDK a drop-in OpenAI replacement, and on a
self-hosted deployment — where there's no dashboard to configure a key's
default model — it's the only way to choose one at all.

When `model` is omitted, the SDK does not send the field (never as
`model: null`); the worker only honors a request-supplied model when it's
present as a string.

## No streaming

The Privedge worker has no streaming code path — `stream` is not accepted
by this SDK. Every request is a single buffered request/response.

## Timeouts

```python
client = Privedge(api_key="...", worker_url="...", timeout=30.0)  # seconds, default 60.0
```

Applies to connect/read/write/pool via `httpx`'s timeout model. A `PrivedgeAPIError` is raised on timeout.

## Dependencies

| Client | Library | Why |
|---|---|---|
| Sync (`Privedge`) | [`httpx`](https://www.python-httpx.org/) | Typed timeouts, connection pooling, and — critically — an API that is structurally identical to its async counterpart. Standard-library `urllib` would drop the dependency count to zero, but at the cost of hand-rolling JSON error bodies, header parsing, and timeout handling twice, once for each client, with no code sharing possible. One well-maintained dependency shared by both clients beats zero dependencies duplicated by hand. |
| Async (`AsyncPrivedge`) | `httpx` (`AsyncClient`) | Same library as sync, so the two clients share one dependency instead of two (`httpx` + `aiohttp`), and their code paths (`_post`/`_get`, error mapping in `_errors.py`) stay in lockstep by construction rather than by discipline. |

Total runtime dependency footprint: **one package** (`httpx`).

## Development

```bash
cd packages/sdk-python
pip install -e ".[dev]"
pytest
```

Tests mock all HTTP calls via [`respx`](https://lundberg.github.io/respx/) — no network access required, no live worker needed.

"""Request and response types for the Privedge Python SDK.

These mirror the shapes defined in the TypeScript SDK
(`packages/sdk/src/index.ts`) and the JSON actually returned by the worker
(`packages/worker/src/index.ts`). Plain dataclasses are used instead of
pydantic to keep the dependency footprint at zero for the type layer — the
SDK only ever *parses* worker responses, it never needs validation beyond
what a `dict.get(...)` with sane defaults provides.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, TypedDict

Role = Literal["system", "user", "assistant"]
PiiStrategy = Literal["edge", "anonymize"]
StrategyMode = Literal["edge", "anonymize", "custom"]
RoutedTo = Literal["edge", "cloud"]


class Message(TypedDict):
    """A single chat message, OpenAI-compatible shape."""

    role: Role
    content: str


@dataclass
class ChatCompletionChoice:
    """One entry in `ChatCompletionResponse.choices`."""

    index: int
    message: Message
    finish_reason: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatCompletionChoice":
        return cls(
            index=data.get("index", 0),
            message=data.get("message", {"role": "assistant", "content": ""}),
            finish_reason=data.get("finish_reason", ""),
        )


@dataclass
class ChatCompletionResponse:
    """Response from `POST /v1/chat/completions`.

    Field-for-field mirror of `ChatCompletionResponse` in the TypeScript SDK,
    plus `applied_strategy` and `strategy_mode` which the worker always
    includes in practice (`StrategyMeta`, spread into every success path:
    `routeToCloud`, `routeToCloudAnon`, `routeToEdge`).

    Attributes:
        ner_ran: Whether the semantic (NER) detection layer actually ran for
            this request. NER is gated behind the Pro/Enterprise tier — on
            Free, this is always ``False`` and ``ner_entities`` is always
            ``[]``. **Do not read an empty ``ner_entities`` as "the prompt
            has no names/orgs/addresses."** It may simply mean nobody looked.
            Only a Pro/Enterprise key running the semantic layer
            (``ner_ran=True``) can make that claim, and even then only for
            entity types NER covers (see the worker's PII detection docs).
    """

    id: str
    object: str
    model: str
    routed_to: RoutedTo
    anonymized: bool
    pii_matches: int
    ner_entities: List[str]
    ner_ran: bool
    latency_ms: int
    choices: List[ChatCompletionChoice]
    applied_strategy: Optional[str] = None
    strategy_mode: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict, repr=False)
    """Full, unparsed JSON body as returned by the worker, for forward compatibility."""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatCompletionResponse":
        choices = [ChatCompletionChoice.from_dict(c) for c in data.get("choices", [])]
        return cls(
            id=data.get("id", ""),
            object=data.get("object", ""),
            model=data.get("model", ""),
            routed_to=data.get("routed_to", "cloud"),
            anonymized=data.get("anonymized", False),
            pii_matches=data.get("pii_matches", 0),
            ner_entities=data.get("ner_entities", []),
            ner_ran=data.get("ner_ran", False),
            latency_ms=data.get("latency_ms", 0),
            choices=choices,
            applied_strategy=data.get("applied_strategy"),
            strategy_mode=data.get("strategy_mode"),
            raw=data,
        )


@dataclass
class DetectResponse:
    """Response from `POST /v1/detect`.

    Attributes:
        ner_ran: Same caveat as `ChatCompletionResponse.ner_ran` — on Free
            tier this is always ``False``, meaning names/orgs/addresses were
            never searched for, not that none were found.
        ner_error: Present and ``True`` only when NER was attempted (paid
            tier) but failed. This endpoint is inspection-only (it never
            blocks on a failed NER, unlike `/v1/chat/completions`, which
            returns 503 `ner_unavailable` on `anonymize` strategy) — so a
            failure here is silent unless you check this field.
    """

    pii_types: List[str]
    pii_type_counts: Dict[str, int]
    pii_count: int
    has_secret: bool
    sanitized_messages: List[Message]
    ner_ran: bool
    ner_error: Optional[bool] = None
    raw: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DetectResponse":
        return cls(
            pii_types=data.get("pii_types", []),
            pii_type_counts=data.get("pii_type_counts", {}),
            pii_count=data.get("pii_count", 0),
            has_secret=data.get("has_secret", False),
            sanitized_messages=data.get("sanitized_messages", []),
            ner_ran=data.get("ner_ran", False),
            ner_error=data.get("ner_error"),
            raw=data,
        )


@dataclass
class KeyInfo:
    """Response from `GET /v1/keys/info`."""

    provider: str
    provider_mode: str
    cloud_model: Optional[str]
    raw: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KeyInfo":
        return cls(
            provider=data.get("provider", "openai"),
            provider_mode=data.get("provider_mode", "managed"),
            cloud_model=data.get("cloud_model"),
            raw=data,
        )

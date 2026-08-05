"""Privedge Python SDK — privacy-preserving AI inference proxy client.

Drop-in-style client for the Privedge compliance proxy: routes chat
completions through PII/secret detection, then either anonymizes before
forwarding to a cloud LLM, runs inference on the Cloudflare edge node, or
passes the prompt through untouched, depending on what was found and how
the API key is configured. See the package README for the full picture,
and `ChatCompletionResponse.ner_ran` / `DetectResponse.ner_ran` in
`privedge.types` for an important compliance caveat about the semantic
detection layer on the Free tier.
"""

from .async_client import AsyncPrivedge
from .client import Privedge
from .exceptions import (
    PrivedgeAPIError,
    PrivedgeAuthError,
    PrivedgeError,
    PrivedgeNERUnavailableError,
    PrivedgeRateLimitError,
    PrivedgeStrategyMismatchError,
)
from .types import (
    ChatCompletionChoice,
    ChatCompletionResponse,
    DetectResponse,
    KeyInfo,
    Message,
    PiiStrategy,
    Role,
    RoutedTo,
    StrategyMode,
)

__version__ = "0.1.0"

__all__ = [
    "Privedge",
    "AsyncPrivedge",
    # Errors
    "PrivedgeError",
    "PrivedgeAuthError",
    "PrivedgeRateLimitError",
    "PrivedgeStrategyMismatchError",
    "PrivedgeNERUnavailableError",
    "PrivedgeAPIError",
    # Types
    "Message",
    "Role",
    "PiiStrategy",
    "StrategyMode",
    "RoutedTo",
    "ChatCompletionChoice",
    "ChatCompletionResponse",
    "DetectResponse",
    "KeyInfo",
]

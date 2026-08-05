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

from importlib.metadata import PackageNotFoundError, version as _pkg_version

# Read from the installed distribution instead of hardcoding it: a literal here has to be
# kept in sync with pyproject.toml by hand, and 1.0.0 shipped reporting 0.1.0 because it
# wasn't. The fallback covers running from a source tree that was never installed.
try:
    __version__ = _pkg_version("privedge")
except PackageNotFoundError:  # pragma: no cover - source checkout without install
    __version__ = "0.0.0+unknown"

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

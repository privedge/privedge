# Privedge

**Privacy on the edge.**

AI inference proxy with two privacy modes: anonymize PII before sending to cloud, or run inference directly on the Cloudflare edge node. Your data never leaves the node closest to your user.

## How it works

```
Your app → Privedge Worker (Cloudflare edge node)
                │
                ├── Regex detection (sync, local)
                ├── NER detection   (Workers AI, same node) ← PII never leaves this node
                │
                ├── pii_strategy: 'anonymize' → redact PII → cloud API → re-inject → response
                ├── pii_strategy: 'edge'      → CF AI edge model (full prompt stays local)
                └── No PII detected           → cloud API → response
```

**Why NER runs on Workers AI and not on the cloud API:**
NER sees the original text before any anonymization — it must run on the same Cloudflare edge node as the request. Sending the raw prompt to OpenAI for entity detection would expose PII before it's redacted, defeating the purpose of the proxy.

Drop-in replacement for the OpenAI SDK. One header change, full compliance.

## Quickstart

### TypeScript

```bash
npm install @privedge/sdk
```

```typescript
import Privedge from '@privedge/sdk'

const ai = new Privedge({
  apiKey: 'your-privedge-api-key',
  workerUrl: 'https://edge.privedge.io',
})

const res = await ai.chat.completions.create({
  model: 'gpt-5.4-nano',
  messages: [{ role: 'user', content: 'Summarize this patient record...' }],
})

console.log(res.choices[0].message.content)
console.log(res.routed_to)   // 'edge' | 'cloud'
console.log(res.pii_matches) // PII values detected and replaced
console.log(res.anonymized)  // true if PII was tokenized before the cloud call
console.log(res.ner_ran)     // false on Free — see "PII Detection" below
```

### Python

```bash
pip install privedge
```

```python
from privedge import Privedge

with Privedge(api_key="your-privedge-api-key", worker_url="https://edge.privedge.io") as ai:
    res = ai.chat.completions.create(
        model="gpt-5.4-nano",
        messages=[{"role": "user", "content": "Summarize this patient record..."}],
    )

print(res.choices[0].message["content"])
print(res.routed_to, res.pii_matches, res.anonymized, res.ner_ran)
```

The async client mirrors the same shape:

```python
from privedge import AsyncPrivedge

async with AsyncPrivedge(api_key="...", worker_url="https://edge.privedge.io") as ai:
    res = await ai.chat.completions.create(model="gpt-5.4-nano", messages=[...])
```

Errors are typed, so you can act on them instead of parsing a message:

```python
from privedge import PrivedgeNERUnavailableError, PrivedgeRateLimitError

try:
    res = ai.chat.completions.create(model="gpt-5.4-nano", messages=[...])
except PrivedgeNERUnavailableError:
    # Semantic detection was down, so the proxy refused to forward the prompt
    # rather than send it without guaranteed anonymization. Nothing leaked —
    # safe to retry.
    ...
except PrivedgeRateLimitError as e:
    print(e.limit, e.remaining, e.reset)
```

Full reference: [`packages/sdk-python`](./packages/sdk-python).

> Neither SDK exposes `stream`. The Worker has no streaming path today:
> de-anonymization rebuilds the response with a full-text pass, and a token can
> arrive split across chunks (`[PER` + `SON_1]`), so streaming needs a reassembly
> buffer before it can be offered.

## Privacy Modes

Each API key has a configurable `pii_strategy`:

| Strategy | Behavior | Use case |
|----------|----------|----------|
| `anonymize` | PII redacted before cloud call, re-injected in response | When you need GPT-4 quality but must strip PII |
| `edge` | Full prompt sent to CF AI model on edge node — no external API call | HIPAA, legal privilege, maximum data residency |

The strategy is set via the `pii_strategy` field on the API key (passed to the Worker through KV or the `PII_STRATEGY` env var).

## Packages

| Package | Description |
|---------|-------------|
| [`packages/worker`](./packages/worker) | Cloudflare Worker — PII detection, anonymization + edge routing |
| [`packages/sdk`](./packages/sdk) | `@privedge/sdk` — drop-in OpenAI replacement (TypeScript) |
| [`packages/sdk-python`](./packages/sdk-python) | `privedge` — drop-in OpenAI replacement (Python), sync + async |

## PII Detection

Detection runs in two layers — which layers are active depends on your plan:

| Layer | Free | Pro / Enterprise |
|-------|------|-----------------|
| Regex (deterministic) | ✅ | ✅ |
| NER (Workers AI 70B) | — | ✅ |

**Regex** (all tiers, deterministic, zero latency):
- Spanish identifiers: DNI / NIE, CIF, social security, medical record no. (NHC), bar registration no., court case no. (NIG), cadastral reference
- Financial: IBAN, credit cards, routing numbers, tax IDs
- Contact: email addresses, phone numbers (US + ES formats)
- Other: SSN, passports, dates, MRN, employee IDs, generic reference numbers
- Secret patterns (API keys, JWTs, DB connection strings)

**NER** (Pro / Enterprise — Workers AI `llama-3.3-70b-fp8-fast`, same edge node):
- Person names
- Organizations (hospitals, insurers, law firms, courts and other judicial bodies)
- Street addresses

NER never calls an external API: it runs on the same Cloudflare node that received the request. It runs after the regex pass, and its entities are merged before anonymization.

### Measured recall

Against an independent evaluation set — 306 Spanish legal and healthcare documents, 921 labelled entities, generated separately from the detector it measures:

| Layer | Recall |
|-------|--------|
| Regex | 92.3% (418/453) |
| NER | 100% (468/468) |
| **Combined** | **96.2% (886/921)** |

The dataset and runners live in [`packages/worker/eval/dataset`](./packages/worker/eval/dataset), including the known gaps. These are synthetic documents: independent of the detector, but not a substitute for validation against real customer data.

### What Free does not cover

The semantic layer is gated behind Pro/Enterprise, so on Free **names, organizations and addresses are never looked for** — an empty `ner_entities` there means "not searched", not "not present". Check `ner_ran` before treating a response as clean.

## Testing

Unit tests cover the privacy-critical core — PII detection and the
`anonymize → de-anonymize` round-trip. They run on Node's built-in test runner
with type stripping, so there are **no test dependencies to install**.

**Requires Node 22.6+** (for `--experimental-strip-types`).

```bash
# all packages, from the repo root
pnpm test

# only the worker
pnpm --filter worker test

# or run the test files directly
cd packages/worker
node --experimental-strip-types --test test/*.test.ts
```

What's covered (`packages/worker/test/pii.test.ts`):

- **No leak** — after `anonymize`, the original PII and secrets never appear in the outgoing text
- **Round-trip integrity** — `deanonymize(anonymize(x)) === x`, including many tokens of the same type and NER entities
- **Detection** — `detectPII` / `detectSecrets` per type, plus clean-text negatives
- **Malformed input** — untrusted request bodies are handled without throwing

## Deploy

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com)
- [pnpm](https://pnpm.io)
- Node 18+

### 1. Clone & install

```bash
git clone https://github.com/privedge/privedge.git
cd privedge
pnpm install
```

### 2. Login to Cloudflare

```bash
cd packages/worker
pnpm wrangler login
```

### 3. Set secrets

```bash
# Required: cloud API key (OpenAI or compatible)
pnpm wrangler secret put CLOUD_API_KEY

# Optional: default strategy when not set per-key (default: 'anonymize')
# Set in wrangler.toml: PII_STRATEGY = "anonymize" | "edge"
# Set in wrangler.toml: EDGE_MODEL = "@cf/meta/llama-3.2-3b-instruct"
```

### 4. Deploy

```bash
pnpm wrangler deploy
# → https://privedge-worker.<your-account>.workers.dev
```

### 5. Test

PII detected — anonymize mode (key configured with `pii_strategy: 'anonymize'`):

```bash
http POST https://privedge-worker.<your-account>.workers.dev/v1/chat/completions \
  Authorization:"Bearer <your-key>" \
  model=gpt-4 \
  messages:='[{"role":"user","content":"Patient DNI 12345678Z needs a checkup"}]'
# → routed_to: "cloud", anonymized: true, pii_matches: 1
```

Edge inference mode (key configured with `pii_strategy: 'edge'`):

```bash
http POST https://privedge-worker.<your-account>.workers.dev/v1/chat/completions \
  Authorization:"Bearer <your-key>" \
  model=gpt-4 \
  messages:='[{"role":"user","content":"Patient DNI 12345678Z needs a checkup"}]'
# → routed_to: "edge", anonymized: false, pii_matches: 1
```

## Roadmap

- [x] Regex PII detection
- [x] Anonymize + de-anonymize pipeline
- [x] Auth middleware + per-key rate limiting
- [x] Request logging (async via `ctx.waitUntil`)
- [x] Secret detection (API keys, tokens)
- [x] Dual PII strategy (anonymize vs edge inference)
- [x] Per-key edge model selection + edge rate limits
- [x] NER model (Workers AI 70B, runs on-node — PII never leaves the edge)
- [x] Unit tests — PII detection + anonymize/de-anonymize round-trip
- [x] Multi-provider egress — OpenAI, Anthropic, Google, DeepSeek, Mistral
- [x] BYOK — your provider key stays in Cloudflare, referenced by alias
- [x] Spanish sectorial identifiers — CIF, NHC, bar registration no., NIG, cadastral reference
- [x] Independent evaluation set — 306 Spanish documents, 920 labelled entities
- [x] Python SDK
- [ ] Streaming — needs a reassembly buffer so de-anonymization can restore tokens split across chunks
- [ ] SOC2 / HIPAA certification
- [ ] Portable deployment beyond Cloudflare — today the Worker depends on Workers AI, KV and `request.cf`

## What this repository contains

The point of publishing this is that you should not have to take our word for what the
proxy does to your prompts. So it is worth being precise about what is here and what is not.

**Here — the entire request path.** `packages/worker/src/index.ts` is the deployed entry
point, and it imports exactly five modules, all of them in this repository: `auth`,
`pii`, `logger`, `ratelimit`, `landing`. There is no sixth file, and no private fork. What
detects PII, what replaces it, what is sent upstream and what is written to the logs is
all readable here, along with the evaluation set the recall numbers come from.

**Not here — the commercial layer.** The dashboard, billing, the account API and the
key-issuing backend live in a private repository. They decide *which* key gets *which*
policy; they never touch prompt content. A self-hosted deployment does not need them.

**Self-hosting today means Cloudflare.** The Worker uses Workers AI for the NER layer and
edge inference, KV for keys and rate limits, and `request.cf` for node geography. Running
it elsewhere means replacing those, which is on the roadmap and is not done.

If you find a gap between what this README claims and what the code does, that is a bug
worth reporting — two such gaps (an advertised streaming option that was never
implemented, and a per-key model setting the Worker ignored) were found and fixed this way.

## License

MIT — [privedge.io](https://privedge.io)

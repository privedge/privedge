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

```typescript
import Privedge from '@privedge/sdk'

const ai = new Privedge({
  apiKey: 'your-privedge-api-key',
  workerUrl: 'https://privedge-worker.workers.dev',
})

const res = await ai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Summarize this patient record...' }],
})

console.log(res.routed_to)  // 'edge' | 'cloud'
console.log(res.pii_matches) // number of PII tokens detected
console.log(res.anonymized)  // true if PII was redacted before cloud call
```

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
| [`packages/sdk`](./packages/sdk) | `@privedge/sdk` — drop-in OpenAI replacement |

## PII Detection

Two layers run in parallel on every request:

**Regex** (deterministic, zero latency):
- SSN, credit cards, IBAN, routing numbers, tax IDs
- Email addresses
- Spanish DNI / NIE, passports
- Phone numbers (US + ES formats)
- Dates (MM/DD/YYYY, YYYY-MM-DD)
- Medical IDs: MRN, employee IDs, generic reference numbers
- Medical keywords (`patient`, `cardiologist`, `troponin`…)
- Secret patterns (API keys, JWTs, DB connection strings)

**NER** (Workers AI `llama-3.3-70b`, same edge node):
- Person names
- Organizations (hospitals, insurers, law firms)
- Street addresses

Both layers run with `Promise.all` — results are merged before anonymization. NER never calls an external API; it runs on the same Cloudflare node that received the request.

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
- [ ] Anthropic / Gemini support
- [ ] SOC2 / HIPAA certification

## License

MIT — [privedge.io](https://privedge.io)

# Privedge

**Privacy on the edge.**

AI inference proxy that automatically routes sensitive requests to edge models — your data never leaves the node closest to you.

## How it works

```
Your app → Privedge Worker → PII detected? ──yes──→ Edge model (data stays local)
                                           └──no───→ OpenAI / cloud API
```

Drop-in replacement for the OpenAI SDK. One header change, full compliance.

## Quickstart

```typescript
import Privedge from '@privedge/sdk'

const ai = new Privedge({
  apiKey: 'your-cloud-api-key',
  workerUrl: 'https://privedge-worker.workers.dev',
  compliance: 'hipaa', // 'gdpr' | 'pci' | custom
})

const res = await ai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Summarize this patient record...' }],
})

console.log(res.routed_to) // 'edge' | 'cloud'
```

## Packages

| Package | Description |
|---------|-------------|
| [`packages/worker`](./packages/worker) | Cloudflare Worker — PII detection + routing |
| [`packages/sdk`](./packages/sdk) | `@privedge/sdk` — drop-in OpenAI replacement |

## PII Detection (v1)

Regex-based detection for:
- SSN, credit cards, IBAN
- Email addresses
- Spanish DNI / NIE
- Phone numbers
- Medical keywords (`patient`, `diagnosis`, `historial`...)

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

### 3. (Optional) Set cloud API key

Only needed if you want to route non-PII requests to OpenAI or another cloud provider.

```bash
pnpm wrangler secret put CLOUD_API_KEY
```

### 4. Deploy

```bash
pnpm wrangler deploy
# → https://privedge-worker.<your-account>.workers.dev
```

### 5. Test

Send a request with PII — should return `"routed_to": "edge"`:

```bash
# Using httpie
http POST https://privedge-worker.<your-account>.workers.dev/v1/chat/completions \
  X-Privedge-Compliance:hipaa \
  model=gpt-4 \
  messages:='[{"role":"user","content":"Patient DNI 12345678Z needs a checkup"}]'
```

Without PII — should return `"routed_to": "cloud"`:

```bash
http POST https://privedge-worker.<your-account>.workers.dev/v1/chat/completions \
  model=gpt-4 \
  messages:='[{"role":"user","content":"Summarize the Roman Empire"}]'
```

## Roadmap

- [ ] NER model for smarter PII detection
- [ ] Anthropic / Gemini support
- [ ] Dashboard — routing logs, compliance reports
- [ ] SOC2 / HIPAA certification

## License

MIT — [privedge.io](https://privedge.io)

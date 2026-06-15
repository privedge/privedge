# Privedge — Design Brief

## What we're building

**Privedge** is a developer tool — an AI inference proxy that automatically routes requests containing sensitive data to edge models, so that data never leaves the node closest to the user.

The promise: **Privacy on the edge.**

---

## The problem

Companies with sensitive data (healthcare, legal, finance, HR) can't send user data to OpenAI or Anthropic due to compliance requirements (HIPAA, GDPR, PCI). Their current options are expensive, complex, or break their stack.

Privedge sits between the app and the AI API. It detects PII in the prompt and routes automatically:

```
App → Privedge Worker → PII detected? ──yes──→ Edge model (data stays local)
                                       └──no───→ OpenAI / cloud API
```

---

## Who it's for

**Primary**: Backend and fullstack developers at companies with compliance requirements.
**Secondary**: Solo developers building apps that handle sensitive data.

---

## Product

### SDK — `@privedge/sdk`
Drop-in replacement for the OpenAI SDK. One import change, zero friction.

```typescript
import Privedge from '@privedge/sdk'

const ai = new Privedge({
  apiKey: 'sk-...',
  workerUrl: 'https://privedge-worker.workers.dev',
  compliance: 'hipaa',
})

const res = await ai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: prompt }],
})

console.log(res.routed_to) // 'edge' | 'cloud'
```

### Worker — Cloudflare Workers
- Runs at the edge (200+ global nodes)
- PII detection via regex (v1) → NER model (v2)
- Routes to `@cf/meta/llama-3.2-1b-instruct` for sensitive data
- Routes to OpenAI/Anthropic for clean data

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Edge runtime | Cloudflare Workers |
| Edge AI model | Llama 3.2 1B (via Workers AI) |
| SDK | TypeScript, ESM + CJS, published to npm |
| Repo | Monorepo — `packages/worker` + `packages/sdk` |

---

## Current state (MVP shipped)

- Worker deployed and live
- SDK published to npm (`@privedge/sdk@0.0.1`)
- PII detection working (regex-based, v1)
- End-to-end tested and validated

---

## Design needs

### 1. Landing page — `privedge.io`

**Goal**: Convert developers who land via GitHub or word of mouth.

**Sections needed**:
- Hero — tagline + CTA (npm install command)
- How it works — the routing diagram (edge vs cloud)
- Code example — drop-in SDK usage
- PII detection — what we detect (SSN, DNI, IBAN, email, medical keywords...)
- Compliance — HIPAA, GDPR, PCI badges
- Footer — GitHub, npm, docs

**Tone**: Technical, clean, confident. Reference: Vercel, Linear, Stripe docs pages.

**Visual reference**: Supabase dashboard style — dark mode first, clean typography, monospace for code.

### 2. Dashboard (future)
- Routing logs — which requests went edge vs cloud
- Compliance reports — PII detection events
- Usage metrics — tokens processed, latency

---

## Brand

- **Name**: Privedge
- **Tagline**: Privacy on the edge.
- **Colors**: TBD — dark background, accent that suggests security/privacy (deep blue, slate, or emerald)
- **Typography**: Monospace for code, clean sans-serif for body

---

## Links

- GitHub: [github.com/privedge/privedge](https://github.com/privedge/privedge)
- npm: [npmjs.com/package/@privedge/sdk](https://npmjs.com/package/@privedge/sdk)
- Worker: `https://edge.privedge.io`

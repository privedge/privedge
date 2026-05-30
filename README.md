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

## Roadmap

- [ ] NER model for smarter PII detection
- [ ] Anthropic / Gemini support
- [ ] Dashboard — routing logs, compliance reports
- [ ] SOC2 / HIPAA certification

## License

MIT — [privedge.io](https://privedge.io)

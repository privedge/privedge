# @privedge/sdk

**Privacy on the edge.** Drop-in AI proxy that automatically routes requests containing sensitive data to edge models — your data never leaves the node closest to you.

## Install

```bash
npm install @privedge/sdk
```

## Usage

```typescript
import Privedge from '@privedge/sdk'

const ai = new Privedge({
  apiKey: 'your-cloud-api-key',
  workerUrl: 'https://privedge-worker.workers.dev',
  compliance: 'hipaa', // 'gdpr' | 'pci' | custom
})

const res = await ai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Patient DNI 12345678Z needs a checkup' }],
})

console.log(res.routed_to) // 'edge' — PII detected, data stayed local
```

## How it works

```
Your app → Privedge Worker → PII detected? ──yes──→ Edge model (data stays local)
                                            └──no───→ OpenAI / cloud API
```

PII is detected automatically — SSN, credit cards, IBAN, email, DNI/NIE, medical keywords. When found, the request is routed to a local edge model (Llama 3.2 1B via Cloudflare Workers AI). No sensitive data ever reaches a cloud API.

## Options

```typescript
new Privedge({
  apiKey: string       // your cloud API key (OpenAI, etc.)
  workerUrl: string    // your deployed Privedge worker URL
  compliance?: string  // 'hipaa' | 'gdpr' | 'pci' — enables PII routing
})
```

When `compliance` is omitted, all requests go to the cloud API regardless of content.

## Deploy your own worker

See [github.com/privedge/privedge](https://github.com/privedge/privedge) for the full worker source and deploy instructions.

## License

MIT

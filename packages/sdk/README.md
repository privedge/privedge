# @privedge/sdk

Drop-in replacement for the OpenAI SDK with automatic PII detection and routing.

## Install

```bash
npm install @privedge/sdk
```

## Usage

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

console.log(res.routed_to)   // 'edge' | 'cloud'
console.log(res.pii_matches) // number of PII tokens detected
console.log(res.anonymized)  // true if PII was redacted before the cloud call
```

Every request is inspected for PII automatically. The routing strategy (`anonymize` vs `edge`) is configured at the API key level on the Worker.

If your key is configured as **`custom`**, you may override the strategy per request:

```typescript
const res = await ai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: '...' }],
  pii_strategy: 'edge', // only honored on `custom` keys; defaults to `anonymize`
})
```

Keys fixed to `edge` or `anonymize` reject a conflicting `pii_strategy` with a `400` error
(`code: 'strategy_mismatch'`) — that fixed strategy is an immutable guarantee, change it in the dashboard.

## Response fields

| Field | Type | Description |
|-------|------|-------------|
| `routed_to` | `'edge' \| 'cloud'` | Where the request was sent |
| `pii_matches` | `number` | PII tokens detected |
| `anonymized` | `boolean` | Whether PII was redacted before the cloud call |
| `choices` | `array` | Standard OpenAI-compatible response |

## Worker

The SDK talks to a self-hosted [Privedge Worker](https://github.com/privedge/privedge/tree/main/packages/worker) running on Cloudflare.

## License

MIT — [privedge.io](https://privedge.io)

export interface PrivedgeOptions {
  apiKey: string
  workerUrl: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionParams {
  /**
   * Cloud model id. Optional: when omitted, the proxy falls back to the `cloud_model`
   * configured on the API key. Passing it here always wins, which keeps this a drop-in
   * OpenAI replacement and is the only way to choose a model on a self-hosted worker,
   * where there is no dashboard to configure one.
   */
  model?: string
  messages: Message[]
  temperature?: number
  max_tokens?: number
  // No `stream` option: the worker has no streaming path, and `create()` parses the
  // response as JSON. Accepting the flag would have promised something neither side
  // delivers — it silently produced a broken response instead of a clear error.
  /**
   * Per-request routing strategy. Only honored when the API key is configured as `custom`
   * (defaults to `anonymize` if omitted). Keys fixed to `edge`/`anonymize` reject a conflicting
   * value with a 400 `strategy_mismatch` error.
   */
  pii_strategy?: 'edge' | 'anonymize'
}

export interface ChatCompletionResponse {
  id: string
  object: string
  model: string
  routed_to: 'edge' | 'cloud'
  anonymized: boolean
  pii_matches: number
  ner_entities: string[]
  /**
   * Whether the semantic (NER) layer ran. It is gated behind Pro/Enterprise, so on the
   * Free tier this is `false` and `ner_entities` is always empty — names, organisations
   * and addresses were never looked for, as opposed to looked for and not found.
   * Check this before treating an empty `ner_entities` as "the prompt carries no names".
   */
  ner_ran: boolean
  latency_ms: number
  choices: {
    index: number
    message: Message
    finish_reason: string
  }[]
}

class ChatCompletions {
  constructor(private client: Privedge) {}

  async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.client.apiKey}`,
    }

    const response = await fetch(`${this.client.workerUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Privedge error ${response.status}: ${error}`)
    }

    return response.json()
  }
}

class Chat {
  completions: ChatCompletions

  constructor(client: Privedge) {
    this.completions = new ChatCompletions(client)
  }
}

export class Privedge {
  apiKey: string
  workerUrl: string
  chat: Chat

  constructor(options: PrivedgeOptions) {
    this.apiKey = options.apiKey
    this.workerUrl = options.workerUrl.replace(/\/$/, '')
    this.chat = new Chat(this)
  }
}

export default Privedge

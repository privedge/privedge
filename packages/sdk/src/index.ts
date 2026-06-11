export interface PrivedgeOptions {
  apiKey: string
  workerUrl: string
  compliance?: boolean // enable PII detection + routing
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionParams {
  model: string
  messages: Message[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export interface ChatCompletionResponse {
  id: string
  object: string
  model: string
  routed_to: 'edge' | 'cloud'
  anonymized: boolean
  pii_matches: number
  ner_entities: string[]
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

    if (this.client.compliance) {
      headers['X-Privedge-Compliance'] = '1'
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
  compliance?: boolean
  chat: Chat

  constructor(options: PrivedgeOptions) {
    this.apiKey = options.apiKey
    this.workerUrl = options.workerUrl.replace(/\/$/, '')
    this.compliance = options.compliance
    this.chat = new Chat(this)
  }
}

export default Privedge

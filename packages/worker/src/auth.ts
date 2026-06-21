export type Provider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'mistral'

export interface KeyData {
  user_id: string
  tier: string
  api_key_id: string
  api_key_name: string
  pii_strategy: 'anonymize' | 'edge' | 'custom'  // 'custom' = caller picks per request (body)
  edge_model: string           // Workers AI model for edge inference
  edge_limit: number | null    // null = use tier default
  // Cloud egress config. Optional for back-compat — KV entries written before the
  // BYOK/managed split lack these, so readers default to managed/openai (see index.ts).
  provider_mode?: 'managed' | 'byok'  // managed = Privedge's key; byok = customer's key in CF
  provider?: Provider                 // which cloud provider the AI Gateway routes to
  cloud_model?: string                // cloud model id (e.g. 'gpt-4o-mini'); prefixed per provider
  byok_alias?: string | null          // cf-aig-byok-alias reference; NEVER the plaintext key
}

/** Validates the `Authorization: Bearer pvdg_live_*` header against the KV store. Returns null if missing, malformed, or not found. */
export async function validateKey(
  request: Request,
  kv: KVNamespace,
): Promise<KeyData | null> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer pvdg_live_')) return null

  const key = auth.slice(7)
  return kv.get<KeyData>(key, 'json')
}

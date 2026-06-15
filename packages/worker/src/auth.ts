export interface KeyData {
  user_id: string
  tier: string
  api_key_id: string
  api_key_name: string
  pii_strategy: 'anonymize' | 'edge'
  edge_model: string           // Workers AI model for edge inference
  edge_limit: number | null    // null = use tier default
  allow_strategy_override?: boolean  // demo keys only — allows pii_strategy in request body
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

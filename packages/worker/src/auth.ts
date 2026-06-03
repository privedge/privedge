export interface KeyData {
  user_id: string
  tier: string
  api_key_id: string
  api_key_name: string
}

export async function validateKey(
  request: Request,
  kv: KVNamespace,
): Promise<KeyData | null> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer pvdg_live_')) return null

  const key = auth.slice(7)
  return kv.get<KeyData>(key, 'json')
}

import type { KeyData } from './auth'

const LIMITS: Record<string, number> = {
  free: 1_000,
  pro: 10_000,
  enterprise: 1_000_000,
}

// Daily edge inference limits per tier (separate counter from total requests)
const TIER_EDGE_DEFAULTS: Record<string, number> = {
  free:       50,
  pro:        2_000,
  enterprise: 50_000,
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  reset: string
}

export async function checkRateLimit(
  userId: string,
  tier: string,
  kv: KVNamespace,
): Promise<RateLimitResult> {
  const limit = LIMITS[tier] ?? LIMITS.free
  const date = new Date().toISOString().slice(0, 10)
  const kvKey = `rl:${userId}:${date}`
  const reset = `${date}T23:59:59Z`

  const current = parseInt((await kv.get(kvKey)) ?? '0', 10)

  if (current >= limit) {
    return { allowed: false, limit, remaining: 0, reset }
  }

  await kv.put(kvKey, String(current + 1), { expirationTtl: 86400 })

  return { allowed: true, limit, remaining: limit - current - 1, reset }
}

export async function checkEdgeRateLimit(
  env: { PRIVEDGE_KEYS: KVNamespace },
  keyData: KeyData,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limit = keyData.edge_limit ?? TIER_EDGE_DEFAULTS[keyData.tier] ?? 50
  const date  = new Date().toISOString().slice(0, 10)
  const kvKey = `rl:edge:${keyData.user_id}:${date}`

  const raw   = await env.PRIVEDGE_KEYS.get(kvKey)
  const count = raw ? parseInt(raw, 10) : 0

  if (count >= limit) return { allowed: false, remaining: 0, limit }

  await env.PRIVEDGE_KEYS.put(kvKey, String(count + 1), { expirationTtl: 86_400 })
  return { allowed: true, remaining: limit - count - 1, limit }
}

const LIMITS: Record<string, number> = {
  free: 1_000,
  pro: 10_000,
  enterprise: 1_000_000,
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

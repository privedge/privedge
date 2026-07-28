import type { Env } from './index'
import type { KeyData } from './auth'

export interface LogEntry {
  keyData: KeyData
  anonymized: boolean
  piiTypes: string[]
  hasSecret?: boolean
  piiMatches: number
  tokensIn: number | null
  tokensOut: number | null
  latencyMs: number
  statusCode: number
  piiStrategy?: 'anonymize' | 'edge'
  edgeModel?: string
  provider?: string
  cloudModel?: string
  providerMode?: string
  cfNode?: string | null
  requestCountry?: string | null
  requestCity?: string | null
  requestId?: string | null    // x-request-id from upstream provider response
  finishReason?: string | null // finish_reason from first choice
  // dev-only: never written to Supabase
  promptSent?: string          // anonymized body sent to provider (JSON string)
  responseRaw?: string         // raw provider response before deanonymization (JSON string)
}

/** Mutable capture bag passed into routing functions to collect dev-only payload snapshots. */
export interface DevCapture {
  promptSent?: string
  responseRaw?: string
}

/**
 * Fire-and-forget POST to the developer's configured Supabase instance.
 * Always called via ctx.waitUntil() so it never delays the proxied response.
 * Errors are swallowed — log failures must never block or alter the response.
 */
export async function writeLog(env: Env, entry: LogEntry): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/request_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: entry.keyData.user_id,
        api_key_id: entry.keyData.api_key_id || null,
        api_key_name: entry.keyData.api_key_name || null,
        anonymized: entry.anonymized,
        pii_types: entry.piiTypes,
        pii_matches: entry.piiMatches,
        tokens_in: entry.tokensIn,
        tokens_out: entry.tokensOut,
        latency_ms: entry.latencyMs,
        status_code: entry.statusCode,
        pii_strategy: entry.piiStrategy ?? 'anonymize',
        edge_model: entry.edgeModel ?? null,
        provider_mode: entry.providerMode ?? null,
        provider: entry.provider ?? null,
        cloud_model: entry.cloudModel ?? null,
        cf_node: entry.cfNode ?? null,
        request_country: entry.requestCountry ?? null,
        request_city: entry.requestCity ?? null,
        request_id: entry.requestId ?? null,
        finish_reason: entry.finishReason ?? null,
      }),
    })
  } catch {
    // Log failures are silent — never block the response
  }

  if (env.DEV_LOGGING === 'true' && env.PRIVEDGE_DEV_LOGS) {
    await writeDevLog(env, entry)
  }
}

/**
 * DEV-ONLY — NEVER runs in production.
 *
 * Writes a structured JSON log entry to the PRIVEDGE_DEV_LOGS KV namespace.
 *
 * Compliance notes:
 * - This function is unreachable in production: the PRIVEDGE_DEV_LOGS binding
 *   is declared exclusively in [env.dev] of wrangler.toml and is not present
 *   in the default (production) deployment. The env.PRIVEDGE_DEV_LOGS check
 *   provides a second layer of protection.
 * - DEV_LOGGING=true must only ever be set in the dev Worker environment.
 *   It must be absent from production secrets before any compliance audit.
 * - Stored content: prompt body sent to the provider (already anonymized —
 *   no raw PII) and the raw model response. Never written to Supabase.
 * - Automatic expiry: all entries carry a 7-day TTL (expirationTtl: 604800).
 *   No manual purge is required; Cloudflare KV deletes them automatically.
 * - To verify production has no stored entries:
 *     wrangler kv key list --namespace-id d7a001a8834d43cea88545d79e8f3d31 --prefix devlog:
 *
 * Key format: devlog:{ISO-timestamp}:{api_key_id} — sortable by time.
 */
async function writeDevLog(env: Env, entry: LogEntry): Promise<void> {
  try {
    const ts = new Date().toISOString()
    const key = `devlog:${ts}:${entry.keyData.api_key_id ?? 'unknown'}`
    const payload = {
      ts,
      user_id: entry.keyData.user_id,
      key_id: entry.keyData.api_key_id,
      key_name: entry.keyData.api_key_name,
      strategy: entry.piiStrategy,
      anonymized: entry.anonymized,
      pii_types: entry.piiTypes,
      pii_matches: entry.piiMatches,
      has_secret: entry.hasSecret ?? false,
      tokens_in: entry.tokensIn,
      tokens_out: entry.tokensOut,
      latency_ms: entry.latencyMs,
      status_code: entry.statusCode,
      provider: entry.provider,
      provider_mode: entry.providerMode,
      cloud_model: entry.cloudModel,
      edge_model: entry.edgeModel,
      request_id: entry.requestId,
      finish_reason: entry.finishReason,
      cf_node: entry.cfNode,
      country: entry.requestCountry,
      city: entry.requestCity,
      prompt_sent: entry.promptSent ? JSON.parse(entry.promptSent) : undefined,
      response_raw: entry.responseRaw ? JSON.parse(entry.responseRaw) : undefined,
    }
    await env.PRIVEDGE_DEV_LOGS!.put(key, JSON.stringify(payload), { expirationTtl: 604800 })
  } catch {
    // Dev log failures are always silent
  }
}

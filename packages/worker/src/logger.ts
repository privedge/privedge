import type { Env } from './index'
import type { KeyData } from './auth'

export interface LogEntry {
  keyData: KeyData
  anonymized: boolean
  piiTypes: string[]
  secretTypes: string[]
  piiMatches: number
  tokensIn: number | null
  tokensOut: number | null
  latencyMs: number
  statusCode: number
  piiStrategy?: 'anonymize' | 'edge'
  edgeModel?: string
  colo?: string | null
}

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
        secret_types: entry.secretTypes,
        pii_matches: entry.piiMatches,
        tokens_in: entry.tokensIn,
        tokens_out: entry.tokensOut,
        latency_ms: entry.latencyMs,
        status_code: entry.statusCode,
        pii_strategy: entry.piiStrategy ?? 'anonymize',
        edge_model: entry.edgeModel ?? null,
        colo: entry.colo ?? null,
      }),
    })
  } catch {
    // Log failures are silent — never block the response
  }
}

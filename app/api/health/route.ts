// /api/health — ヘルスチェック
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const checks: Record<string, unknown> = {
    service: 'formboost',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
  }

  // Supabase接続チェック
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { count, error } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })

    checks.supabase = error ? { status: 'error', message: error.message } : { status: 'ok', campaigns: count }
  } catch (e: unknown) {
    checks.supabase = { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }

  // Cloud Run接続チェック
  const senderUrl = process.env.SENDER_URL
  if (senderUrl) {
    try {
      const res = await fetch(`${senderUrl}/health`, { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      checks.cloud_run = { status: 'ok', version: data.version }
    } catch (e: unknown) {
      checks.cloud_run = { status: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  } else {
    checks.cloud_run = { status: 'not_configured' }
  }

  const allOk = (checks.supabase as Record<string, string>)?.status === 'ok'
  return NextResponse.json(checks, { status: allOk ? 200 : 503 })
}

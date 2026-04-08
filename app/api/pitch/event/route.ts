// /api/pitch/event — ピッチイベント記録（スライド閲覧/質問/CTA/離脱など）
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { session_id, event_type, slide_index, payload } = body
  if (!session_id || !event_type) {
    return NextResponse.json({ error: 'session_id, event_type は必須' }, { status: 400 })
  }

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('pitch_events') as any).insert({
    session_id,
    event_type,
    slide_index: slide_index ?? null,
    payload: payload ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

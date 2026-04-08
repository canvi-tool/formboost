// /api/companies/search — 候補企業検索（フィルタ + 重複除外）
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const criteria = body.criteria || {}
  const limit = Math.min(Number(body.limit) || 50, 500)

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc('get_candidate_companies', {
    p_user_id: userId,
    p_criteria: criteria,
    p_limit: limit,
  })

  if (error) {
    console.error('[companies/search] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ companies: data || [], count: (data || []).length })
}

// 統計情報取得（ダッシュボード用）
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: total } = await (sb.from('companies') as any)
    .select('*', { count: 'exact', head: true })
    .eq('defunct', false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: withForm } = await (sb.from('companies') as any)
    .select('*', { count: 'exact', head: true })
    .eq('defunct', false)
    .not('form_url', 'is', null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: needsDiscovery } = await (sb.from('companies') as any)
    .select('*', { count: 'exact', head: true })
    .eq('defunct', false)
    .is('form_url', null)
    .eq('discovery_stage', 'pending')

  return NextResponse.json({
    total: total || 0,
    with_form_url: withForm || 0,
    needs_discovery: needsDiscovery || 0,
  })
}

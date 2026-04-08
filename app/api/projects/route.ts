// /api/projects — プロジェクト一覧/作成（テナント配下、プラン上限はDBトリガで強制）
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const tenant_id = req.nextUrl.searchParams.get('tenant_id')
  if (!tenant_id) return NextResponse.json({ error: 'tenant_id必須' }, { status: 400 })
  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('projects') as any)
    .select('id, name, created_by, created_at').eq('tenant_id', tenant_id).order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ projects: data || [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { user_id, tenant_id, name } = body
  if (!user_id || !tenant_id || !name) {
    return NextResponse.json({ error: 'user_id, tenant_id, name必須' }, { status: 400 })
  }
  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mem } = await (sb.from('tenant_members') as any)
    .select('role').eq('tenant_id', tenant_id).eq('user_id', user_id).single()
  if (!mem || !['owner', 'admin'].includes(mem.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('projects') as any)
    .insert({ tenant_id, name, created_by: user_id }).select().single()
  if (error) {
    // トリガの上限エラー
    if (error.message.includes('project limit reached')) {
      return NextResponse.json({
        error: error.message,
        upgrade: 'Plusプランで3プロジェクト、エンタープライズで無制限になります',
      }, { status: 402 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ project: data })
}

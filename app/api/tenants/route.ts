// /api/tenants — テナント一覧取得/新規作成
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

// 自分が所属するテナント一覧
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ error: 'user_id必須' }, { status: 400 })

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: members, error } = await (sb.from('tenant_members') as any)
    .select('role, tenant_id, tenants(id, name, plan, plus, max_projects, created_at)')
    .eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenants = (members || []).map((m: any) => ({ ...m.tenants, role: m.role }))
  return NextResponse.json({ tenants })
}

// 新規テナント作成（作成者＝owner）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { user_id, name, plan = 'standard', plus = false } = body
  if (!user_id || !name) return NextResponse.json({ error: 'user_id, name必須' }, { status: 400 })
  if (!['standard', 'pro', 'god', 'enterprise'].includes(plan)) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 })
  }

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenant, error: e1 } = await (sb.from('tenants') as any)
    .insert({ name, plan, plus })
    .select()
    .single()
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: e2 } = await (sb.from('tenant_members') as any).insert({
    tenant_id: tenant.id,
    user_id,
    role: 'owner',
    joined_at: new Date().toISOString(),
  })
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  return NextResponse.json({ tenant })
}

// プラン変更（owner/admin のみ）
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { user_id, tenant_id, plan, plus } = body
  if (!user_id || !tenant_id) return NextResponse.json({ error: 'user_id, tenant_id必須' }, { status: 400 })

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mem } = await (sb.from('tenant_members') as any)
    .select('role').eq('tenant_id', tenant_id).eq('user_id', user_id).single()
  if (!mem || !['owner', 'admin'].includes(mem.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = {}
  if (plan !== undefined) patch.plan = plan
  if (plus !== undefined) patch.plus = plus

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('tenants') as any)
    .update(patch).eq('id', tenant_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tenant: data })
}

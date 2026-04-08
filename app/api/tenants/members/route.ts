// /api/tenants/members — メンバー招待/ロール変更/削除
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

// 権限チェックヘルパー
async function assertRole(sb: ReturnType<typeof createServiceClient>, tenant_id: string, user_id: string, allow: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from('tenant_members') as any)
    .select('role').eq('tenant_id', tenant_id).eq('user_id', user_id).single()
  return data && allow.includes(data.role)
}

// メンバー一覧
export async function GET(req: NextRequest) {
  const tenant_id = req.nextUrl.searchParams.get('tenant_id')
  if (!tenant_id) return NextResponse.json({ error: 'tenant_id必須' }, { status: 400 })
  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('tenant_members') as any)
    .select('user_id, role, invited_at, joined_at').eq('tenant_id', tenant_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: data || [] })
}

// 招待（追加）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { actor_user_id, tenant_id, user_id, role = 'member' } = body
  if (!actor_user_id || !tenant_id || !user_id) {
    return NextResponse.json({ error: 'actor_user_id, tenant_id, user_id必須' }, { status: 400 })
  }
  if (!['owner', 'admin', 'member'].includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }
  const sb = createServiceClient()
  if (!(await assertRole(sb, tenant_id, actor_user_id, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('tenant_members') as any).insert({ tenant_id, user_id, role })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ロール変更
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { actor_user_id, tenant_id, user_id, role } = body
  if (!actor_user_id || !tenant_id || !user_id || !role) {
    return NextResponse.json({ error: '必須項目不足' }, { status: 400 })
  }
  const sb = createServiceClient()
  if (!(await assertRole(sb, tenant_id, actor_user_id, ['owner']))) {
    return NextResponse.json({ error: 'owner only' }, { status: 403 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('tenant_members') as any)
    .update({ role }).eq('tenant_id', tenant_id).eq('user_id', user_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// 削除
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { actor_user_id, tenant_id, user_id } = body
  if (!actor_user_id || !tenant_id || !user_id) {
    return NextResponse.json({ error: '必須項目不足' }, { status: 400 })
  }
  const sb = createServiceClient()
  if (!(await assertRole(sb, tenant_id, actor_user_id, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('tenant_members') as any)
    .delete().eq('tenant_id', tenant_id).eq('user_id', user_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

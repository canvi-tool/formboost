// /api/campaigns/[id] — キャンペーン詳細・更新・削除
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: キャンペーン詳細 + targets一覧
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'キャンペーンが見つかりません' }, { status: 404 })

  const page = parseInt(req.nextUrl.searchParams.get('page') || '1')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100')
  const offset = (page - 1) * limit

  const { data: targets, count } = await supabase
    .from('targets')
    .select('*', { count: 'exact' })
    .eq('campaign_id', id)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ campaign, targets: targets || [], total_targets: count || 0, page, limit })
}

// PATCH: キャンペーン更新
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  const allowedFields = ['name', 'status', 'template', 'sender_company', 'sender_name', 'sender_email', 'sender_phone']
  const update: Record<string, string> = {}
  for (const key of allowedFields) {
    if (body[key] !== undefined) update[key] = body[key]
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign: data })
}

// DELETE: キャンペーン削除
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const { error } = await supabase.from('campaigns').delete().eq('id', id).eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

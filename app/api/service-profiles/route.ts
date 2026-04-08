// /api/service-profiles — サービスプロフィール CRUD
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('service_profiles') as any)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: data || [] })
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name は必須' }, { status: 400 })

  const sb = createServiceClient()
  const row = {
    user_id: userId,
    name: body.name,
    service_description: body.service_description || null,
    target_pain_points: body.target_pain_points || null,
    value_proposition: body.value_proposition || null,
    differentiators: body.differentiators || null,
    case_study: body.case_study || null,
    desired_cta: body.desired_cta || null,
    sales_goal: body.sales_goal || 'online_appointment',
    goal_url: body.goal_url || null,
    tone: body.tone || 'formal',
    target_criteria: body.target_criteria || {},
    daily_budget_yen: body.daily_budget_yen || 1000,
    daily_target_count: body.daily_target_count || 50,
    is_active: body.is_active ?? true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('service_profiles') as any)
    .insert(row).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}

export async function PATCH(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'id は必須' }, { status: 400 })

  const sb = createServiceClient()
  const { id, ...updates } = body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('service_profiles') as any)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}

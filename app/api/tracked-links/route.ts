// /api/tracked-links — トラッキングリンク発行 & ホットリード一覧取得
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import crypto from 'crypto'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const hotOnly = req.nextUrl.searchParams.get('hot') === '1'
  const sb = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (sb.from('tracked_links') as any)
    .select('*')
    .eq('user_id', userId)
    .order('last_clicked_at', { ascending: false, nullsFirst: false })
    .limit(200)

  if (hotOnly) q = q.gt('click_count', 0)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data || [] })
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  if (!body.destination_url) {
    return NextResponse.json({ error: 'destination_url は必須' }, { status: 400 })
  }

  const token = crypto.randomBytes(8).toString('base64url')
  const sb = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from('tracked_links') as any)
    .insert({
      user_id: userId,
      target_id: body.target_id || null,
      campaign_id: body.campaign_id || null,
      hojin_number: body.hojin_number || null,
      company_name: body.company_name || null,
      token,
      destination_url: body.destination_url,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://formboost.vercel.app'
  return NextResponse.json({ link: data, tracking_url: `${base}/api/track/${token}` })
}

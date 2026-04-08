// /api/track/[token] — クリック追跡 → ホットリード化 → リダイレクト
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const sb = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link } = await (sb.from('tracked_links') as any)
    .select('id, destination_url, click_count')
    .eq('token', token)
    .single()

  if (!link) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const now = new Date().toISOString()
  const ip = req.headers.get('x-forwarded-for') || ''
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('tracked_links') as any)
    .update({
      click_count: (link.click_count || 0) + 1,
      last_clicked_at: now,
      first_clicked_at: link.click_count ? undefined : now,
    })
    .eq('id', link.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('link_click_events') as any).insert({
    tracked_link_id: link.id,
    ip_hash: ipHash,
    user_agent: req.headers.get('user-agent'),
    referer: req.headers.get('referer'),
  })

  return NextResponse.redirect(link.destination_url, { status: 302 })
}

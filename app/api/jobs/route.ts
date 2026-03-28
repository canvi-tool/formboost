// /api/jobs — 送信ジョブ管理（Vercel → Cloud Run 連携）
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const SENDER_URL = process.env.SENDER_URL || ''

// POST: 送信ジョブ開始（targets を Cloud Run に順次送信）
export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  if (!SENDER_URL) return NextResponse.json({ error: 'SENDER_URL未設定' }, { status: 500 })

  const { campaign_id, target_ids } = await req.json()
  if (!campaign_id) return NextResponse.json({ error: 'campaign_id が必要です' }, { status: 400 })

  // キャンペーン確認
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaign_id)
    .eq('user_id', userId)
    .single()

  if (cErr || !campaign) return NextResponse.json({ error: 'キャンペーンが見つかりません' }, { status: 404 })

  // 対象targets取得
  let query = supabase
    .from('targets')
    .select('*')
    .eq('campaign_id', campaign_id)

  if (target_ids?.length) {
    query = query.in('id', target_ids)
  } else {
    // 全pending targetsを対象
    query = query.in('send_status', ['pending', 'failed'])
  }

  const { data: targets, error: tErr } = await query
  if (tErr || !targets?.length) {
    return NextResponse.json({ error: '送信対象がありません' }, { status: 400 })
  }

  // キャンペーンを sending に更新
  await supabase
    .from('campaigns')
    .update({ status: 'sending' })
    .eq('id', campaign_id)

  // targets を queued に更新
  const targetIds = targets.map(t => t.id)
  await supabase
    .from('targets')
    .update({ send_status: 'queued' })
    .in('id', targetIds)

  // Cloud Run にバッチ送信を依頼
  const webhookUrl = `${req.nextUrl.origin}/api/webhook`
  const sender = {
    company: campaign.sender_company || '',
    name: campaign.sender_name || '',
    email: campaign.sender_email || '',
    phone: campaign.sender_phone || '',
    message: campaign.template || '',
  }

  const batchTargets = targets.map(t => ({
    id: t.id,
    campaign_id: t.campaign_id,
    company: t.company,
    form_url: t.form_url || null,
    hp_url: t.hp_url || t.site_url || null,
  }))

  // per-target custom_message があればsenderのmessageを上書き
  const targetMessages: Record<string, string> = {}
  for (const t of targets) {
    if (t.custom_message) targetMessages[t.id] = t.custom_message
  }

  // Cloud Runに非同期でバッチ送信を依頼（結果はwebhookで受け取る）
  fetch(`${SENDER_URL}/submit-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targets: batchTargets,
      sender,
      target_messages: targetMessages,
      webhook_url: webhookUrl,
      interval_ms: 3000,
    }),
  }).catch(e => {
    console.error('[jobs] Cloud Run batch request failed:', e.message)
  })

  await supabase.from('execution_logs').insert({
    campaign_id,
    level: 'info',
    phase: 'send',
    message: `送信ジョブ開始: ${targets.length}社`,
  })

  return NextResponse.json({
    success: true,
    campaign_id,
    queued_count: targets.length,
    message: `${targets.length}社の送信を開始しました`,
  })
}

// GET: キャンペーンの送信進捗
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const campaignId = req.nextUrl.searchParams.get('campaign_id')
  if (!campaignId) return NextResponse.json({ error: 'campaign_id が必要です' }, { status: 400 })

  // キャンペーン情報
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single()

  if (!campaign) return NextResponse.json({ error: 'キャンペーンが見つかりません' }, { status: 404 })

  // ステータス別集計
  const { data: allTargets } = await supabase
    .from('targets')
    .select('send_status')
    .eq('campaign_id', campaignId)

  const counts: Record<string, number> = {
    pending: 0, queued: 0, sending: 0,
    success: 0, failed: 0, skipped: 0, captcha: 0,
  }
  for (const t of allTargets || []) {
    const s = t.send_status as string
    if (s in counts) counts[s]++
  }

  return NextResponse.json({ campaign, counts })
}

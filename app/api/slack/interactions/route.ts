// /api/slack/interactions — Slackボタン押下ハンドラ
// approve_briefing / reject_briefing / edit_briefing
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

async function findUserByBotToken(token: string): Promise<string | null> {
  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from('slack_workspaces') as any)
    .select('user_id').eq('bot_token', token).single()
  return data?.user_id || null
}

export async function POST(req: NextRequest) {
  // Slack Interactivityは application/x-www-form-urlencoded で payload= にJSON
  const formData = await req.formData()
  const payloadStr = formData.get('payload') as string
  if (!payloadStr) return NextResponse.json({ error: 'payload missing' }, { status: 400 })

  const payload = JSON.parse(payloadStr)
  const action = payload.actions?.[0]
  if (!action) return NextResponse.json({ error: 'action missing' }, { status: 400 })

  const briefingId = action.value
  const sb = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefing } = await (sb.from('daily_briefings') as any)
    .select('*').eq('id', briefingId).single()
  if (!briefing) return NextResponse.json({ error: 'briefing not found' }, { status: 404 })

  const userName = payload.user?.name || 'unknown'

  if (action.action_id === 'approve_briefing') {
    // 承認 → campaigns作成 → targets移行 → /api/jobs でCloud Run起動
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (sb.from('profiles') as any)
      .select('*').eq('id', briefing.user_id).single()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sp } = await (sb.from('service_profiles') as any)
      .select('*').eq('id', briefing.service_profile_id).single()

    // campaign作成
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: camp, error: cErr } = await (sb.from('campaigns') as any)
      .insert({
        user_id: briefing.user_id,
        name: `[AI] ${sp?.name || 'AI Briefing'} ${briefing.briefing_date}`,
        status: 'ready',
        total_targets: briefing.target_count,
        template: briefing.message_template,
        sender_company: profile?.company_name,
        sender_name: profile?.sender_name,
        sender_email: profile?.sender_email,
        sender_phone: profile?.sender_phone,
        estimated_cost: briefing.estimated_cost,
      })
      .select().single()
    if (cErr) {
      console.error('[slack/interactions] campaign error:', cErr)
      return NextResponse.json({ error: cErr.message }, { status: 500 })
    }

    // briefing_targets → targets 移行
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bts } = await (sb.from('briefing_targets') as any)
      .select('*').eq('briefing_id', briefingId)

    const targetRows = (bts || []).map((bt: { company_name: string; hp_url: string | null; form_url: string | null; hojin_number: string; custom_message: string | null }) => ({
      campaign_id: camp.id,
      company: bt.company_name,
      hp_url: bt.hp_url,
      form_url: bt.form_url,
      hojin_number: bt.hojin_number,
      custom_message: bt.custom_message,
      send_status: 'pending',
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from('targets') as any).insert(targetRows)

    // ブリーフィング承認状態更新
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from('daily_briefings') as any)
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userName,
        campaign_id: camp.id,
      })
      .eq('id', briefingId)

    // /api/jobs を非同期でキック
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://formboost.vercel.app'
    fetch(`${appUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': briefing.user_id },
      body: JSON.stringify({ campaign_id: camp.id, dry_run: false }),
    }).catch(e => console.error('[jobs kick] error:', e))

    // Slack元メッセージ更新
    return NextResponse.json({
      response_action: 'update',
      replace_original: 'true',
      text: `✅ 承認済み: ${userName}さんが承認しました。キャンペーン実行中...`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `✅ *承認済み* - ${userName}さんが ${new Date().toLocaleTimeString('ja-JP')} に承認\nキャンペーン実行中... (${briefing.target_count}社)` },
        },
      ],
    })
  }

  if (action.action_id === 'reject_briefing') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from('daily_briefings') as any)
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        approved_by: userName,
      })
      .eq('id', briefingId)

    return NextResponse.json({
      response_action: 'update',
      replace_original: 'true',
      text: `❌ 却下: ${userName}さんが却下しました`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `❌ *却下* - ${userName}さんが却下しました` } },
      ],
    })
  }

  return NextResponse.json({ ok: true })
}

// /api/slack/notify — ブリーフィングをSlackに通知（承認ボタン付き）
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  const briefingId: string = body.briefing_id
  if (!briefingId) return NextResponse.json({ error: 'briefing_id が必要' }, { status: 400 })

  const sb = createServiceClient()

  // Slack連携設定取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws, error: wErr } = await (sb.from('slack_workspaces') as any)
    .select('bot_token, channel_id').eq('user_id', userId).single()
  if (wErr || !ws) {
    return NextResponse.json({ error: 'Slack連携が未設定です' }, { status: 404 })
  }

  // ブリーフィング取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefing, error: bErr } = await (sb.from('daily_briefings') as any)
    .select('*, service_profiles(name, sales_goal)').eq('id', briefingId).single()
  if (bErr || !briefing) return NextResponse.json({ error: 'ブリーフィングが見つかりません' }, { status: 404 })

  // サンプルメッセージ取得（最初の3社）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sampleTargets } = await (sb.from('briefing_targets') as any)
    .select('company_name').eq('briefing_id', briefingId).limit(3)
  const sampleNames = (sampleTargets || []).map((t: { company_name: string }) => `• ${t.company_name}`).join('\n')

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '☀️ 本日の営業プラン - AI Agent Briefing', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*サービス:*\n${briefing.service_profiles?.name || '-'}` },
        { type: 'mrkdwn', text: `*ゴール:*\n${briefing.service_profiles?.sales_goal || '-'}` },
        { type: 'mrkdwn', text: `*ターゲット数:*\n${briefing.target_count}社` },
        { type: 'mrkdwn', text: `*見積コスト:*\n¥${Number(briefing.estimated_cost).toLocaleString()}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*📊 前日の結果:*\n${briefing.summary_prev_day}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🔍 分析:*\n${briefing.analysis}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*💡 今日の改善ポイント:*\n${briefing.improvements}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🎯 本日の戦略:*\n${briefing.today_plan}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🏢 ターゲット例:*\n${sampleNames || '-'}\n_他${Math.max(0, briefing.target_count - 3)}社_` },
    },
    { type: 'divider' },
    {
      type: 'actions',
      block_id: `briefing_${briefingId}`,
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: '✅ 承認して実行', emoji: true },
          value: briefingId,
          action_id: 'approve_briefing',
          confirm: {
            title: { type: 'plain_text', text: '本当に実行しますか？' },
            text: { type: 'mrkdwn', text: `${briefing.target_count}社に送信します（見積¥${Number(briefing.estimated_cost).toLocaleString()}）` },
            confirm: { type: 'plain_text', text: '実行する' },
            deny: { type: 'plain_text', text: 'キャンセル' },
          },
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ 内容を編集', emoji: true },
          value: briefingId,
          action_id: 'edit_briefing',
          url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://formboost.vercel.app'}/briefings/${briefingId}`,
        },
        {
          type: 'button',
          style: 'danger',
          text: { type: 'plain_text', text: '❌ 却下', emoji: true },
          value: briefingId,
          action_id: 'reject_briefing',
        },
      ],
    },
  ]

  // Slack送信
  const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${ws.bot_token}`,
    },
    body: JSON.stringify({
      channel: ws.channel_id,
      text: `☀️ 本日の営業プラン: ${briefing.target_count}社 / 見積¥${briefing.estimated_cost}`,
      blocks,
    }),
  })
  const slackData = await slackRes.json()
  if (!slackData.ok) {
    console.error('[slack/notify] error:', slackData)
    return NextResponse.json({ error: slackData.error || 'Slack送信失敗' }, { status: 500 })
  }

  // ブリーフィングにSlack msg_ts保存
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('daily_briefings') as any)
    .update({
      status: 'sent_to_slack',
      slack_channel: ws.channel_id,
      slack_message_ts: slackData.ts,
      updated_at: new Date().toISOString(),
    })
    .eq('id', briefingId)

  return NextResponse.json({ ok: true, slack_ts: slackData.ts })
}

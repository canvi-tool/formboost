// /api/slack/workspace — Slack連携設定の登録・取得
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from('slack_workspaces') as any)
    .select('channel_id, channel_name, workspace_id, connected_at').eq('user_id', userId).single()

  return NextResponse.json({ workspace: data || null })
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  if (!body.bot_token || !body.channel_id) {
    return NextResponse.json({ error: 'bot_token と channel_id は必須' }, { status: 400 })
  }

  // トークンの有効性チェック
  const authTest = await fetch('https://slack.com/api/auth.test', {
    headers: { 'Authorization': `Bearer ${body.bot_token}` },
  })
  const authData = await authTest.json()
  if (!authData.ok) {
    return NextResponse.json({ error: `Slack token無効: ${authData.error}` }, { status: 400 })
  }

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('slack_workspaces') as any)
    .upsert({
      user_id: userId,
      workspace_id: authData.team_id,
      bot_token: body.bot_token,
      signing_secret: body.signing_secret || null,
      channel_id: body.channel_id,
      channel_name: body.channel_name || null,
      updated_at: new Date().toISOString(),
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, workspace: authData.team, bot_user: authData.user })
}

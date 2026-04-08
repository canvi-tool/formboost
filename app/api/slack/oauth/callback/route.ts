// /api/slack/oauth/callback — Slack OAuthコールバック
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const agentUrl = `${baseUrl}/agent?tab=slack`

  if (error) return NextResponse.redirect(`${agentUrl}&slack_error=${encodeURIComponent(error)}`)
  if (!code || !state) return NextResponse.redirect(`${agentUrl}&slack_error=invalid_request`)

  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    userId = decoded.user_id
  } catch {
    return NextResponse.redirect(`${agentUrl}&slack_error=invalid_state`)
  }

  const clientId = process.env.SLACK_CLIENT_ID || ''
  const clientSecret = process.env.SLACK_CLIENT_SECRET || ''
  const redirectUri = `${baseUrl}/api/slack/oauth/callback`

  // トークン交換
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.ok) {
    return NextResponse.redirect(`${agentUrl}&slack_error=${encodeURIComponent(tokenData.error || 'oauth_failed')}`)
  }

  const botToken: string = tokenData.access_token
  const workspaceId: string = tokenData.team?.id
  const workspaceName: string = tokenData.team?.name

  // DB保存（チャンネル未選択状態）
  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('slack_workspaces') as any).upsert({
    user_id: userId,
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    bot_token: botToken,
    channel_id: null,
    channel_name: null,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.redirect(`${agentUrl}&slack_connected=1`)
}

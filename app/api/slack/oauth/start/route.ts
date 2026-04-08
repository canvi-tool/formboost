// /api/slack/oauth/start — Slack OAuth開始（「Slackと連携する」ボタンから）
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) return NextResponse.json({ error: 'user_id必須' }, { status: 400 })

  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'SLACK_CLIENT_ID未設定' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const redirectUri = `${baseUrl}/api/slack/oauth/callback`
  const scopes = 'chat:write,channels:read,groups:read,chat:write.public'

  // state に user_id を埋め込む（CSRF対策兼ねる）
  const state = Buffer.from(JSON.stringify({ user_id: userId, ts: Date.now() })).toString('base64url')

  const authUrl = new URL('https://slack.com/oauth/v2/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)

  return NextResponse.redirect(authUrl.toString())
}

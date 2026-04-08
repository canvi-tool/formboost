// /api/slack/channels — Slackチャンネル一覧取得（bot_tokenで conversations.list 実行）
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const botToken: string = body.bot_token
  if (!botToken) return NextResponse.json({ error: 'bot_token必須' }, { status: 400 })

  try {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '1000',
    })
    const res = await fetch(`https://slack.com/api/conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const data = await res.json()
    if (!data.ok) {
      return NextResponse.json({ error: `Slack API: ${data.error}` }, { status: 400 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channels = (data.channels || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      is_private: c.is_private,
      is_member: c.is_member,
      num_members: c.num_members,
    }))
    channels.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
    return NextResponse.json({ channels })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

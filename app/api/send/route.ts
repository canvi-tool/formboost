import { NextRequest, NextResponse } from 'next/server'

const SENDER_URL = process.env.SENDER_URL || ''

export async function POST(req: NextRequest) {
  const { form_url, hp_url, sender, mode, dry_run } = await req.json()

  if (!form_url && !hp_url) return NextResponse.json({ success: false, error: 'form_url or hp_url is required' })
  if (!SENDER_URL) return NextResponse.json({ success: false, error: 'SENDER_URL\u672a\u8a2d\u5b9a' })

  // Mode A: form_url直指定 → AI解析→送信
  // Mode B: hp_urlのみ → Playwright巡回→フォーム発見→AI解析→送信
  const effectiveMode = mode || (form_url ? 'A' : 'B')

  try {
    const res = await fetch(`${SENDER_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form_url: form_url || null,
        hp_url: hp_url || null,
        sender,
        mode: effectiveMode,
        dry_run: dry_run || false,
      }),
      signal: AbortSignal.timeout(90000) // 90s for complex forms
    })

    const data = await res.json()
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Sender error:', msg)
    return NextResponse.json({ success: false, error: msg })
  }
}

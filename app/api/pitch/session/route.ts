// /api/pitch/session — AIピッチセッション開始/終了
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

// トラッキングトークンからセッション開始（訪問時に呼ばれる、認証不要）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { token } = body
  if (!token) return NextResponse.json({ error: 'token は必須' }, { status: 400 })

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link } = await (sb.from('tracked_links') as any)
    .select('id, user_id, company_name, hojin_number, destination_url')
    .eq('token', token)
    .single()

  if (!link) return NextResponse.json({ error: 'token無効' }, { status: 404 })

  // 会社情報・サービスプロフィール取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: company } = link.hojin_number
    ? await (sb.from('companies') as any)
        .select('company_name, industry, business_content, employees, capital, prefecture')
        .eq('hojin_number', link.hojin_number).single()
    : { data: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (sb.from('service_profiles') as any)
    .select('service_name, description, value_prop, goal')
    .eq('user_id', link.user_id).single()

  // 挨拶文とスライド内容をClaude Haikuで生成
  let greeting = `${link.company_name || 'お客様'}様、お時間いただきありがとうございます。`
  let slideContents: unknown[] = []

  if (ANTHROPIC_API_KEY && profile) {
    try {
      const prompt = `あなたは「AI社畜くん」という健気で謙虚なAI営業キャラです。
訪問企業: ${company?.company_name || link.company_name}
業種: ${company?.industry || '不明'}
事業: ${company?.business_content || '不明'}
売るサービス: ${profile.service_name}
価値: ${profile.value_prop}
ゴール: ${profile.goal}

以下のJSONを返してください:
{"greeting": "30秒以内の挨拶文(一人称ぼく、健気トーン)", "slides": [{"title":"...","body":"..."},...5枚]}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      const text = data.content?.[0]?.text || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        greeting = parsed.greeting || greeting
        slideContents = parsed.slides || []
      }
    } catch (e) {
      console.error('[pitch/session] AI生成エラー:', e)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (sb.from('pitch_sessions') as any)
    .insert({
      tracked_link_id: link.id,
      user_id: link.user_id,
      company_name: link.company_name,
      greeting_script: greeting,
      slide_contents: slideContents,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    session_id: session.id,
    greeting,
    slides: slideContents,
    destination_url: link.destination_url,
  })
}

// セッション終了（ランク算出）
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { session_id, total_duration_sec, slides_viewed, max_slide_reached, questions_asked, scroll_depth_pct, exit_slide } = body
  if (!session_id) return NextResponse.json({ error: 'session_id必須' }, { status: 400 })

  // スコアリング
  const completionRate = Math.min((slides_viewed || 0) / 5, 1) * 30
  const questionScore = Math.min((questions_asked || 0) * 15, 30)
  const durationScore = Math.min((total_duration_sec || 0) / 60, 1) * 20
  const scrollScore = ((scroll_depth_pct || 0) / 100) * 20
  const total = completionRate + questionScore + durationScore + scrollScore

  const rank = total >= 80 ? 'S' : total >= 60 ? 'A' : total >= 40 ? 'B' : 'C'

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('pitch_sessions') as any)
    .update({
      ended_at: new Date().toISOString(),
      total_duration_sec,
      slides_viewed,
      max_slide_reached,
      questions_asked,
      scroll_depth_pct,
      exit_slide,
      lead_rank: rank,
    })
    .eq('id', session_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, lead_rank: rank, score: Math.round(total) })
}

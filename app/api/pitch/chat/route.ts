// /api/pitch/chat — 紙芝居中の質問にClaude Haikuが即答
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { session_id, user_message } = body
  if (!session_id || !user_message) {
    return NextResponse.json({ error: 'session_id, user_message は必須' }, { status: 400 })
  }

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (sb.from('pitch_sessions') as any)
    .select('id, user_id, company_name, greeting_script, slide_contents')
    .eq('id', session_id)
    .single()
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (sb.from('service_profiles') as any)
    .select('service_name, description, value_prop, goal')
    .eq('user_id', session.user_id).single()

  // 過去のチャット履歴
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: history } = await (sb.from('pitch_chats') as any)
    .select('role, content')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(20)

  // ユーザーメッセージ保存
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('pitch_chats') as any).insert({
    session_id,
    role: 'user',
    content: user_message,
  })

  let reply = 'ごめんなさい、ぼくいま少し調子が悪いみたいです…。もう一度聞いてもらえますか？'

  if (ANTHROPIC_API_KEY) {
    try {
      const systemPrompt = `あなたは「AI社畜くん」という健気で謙虚なAI営業キャラ。一人称は「ぼく」。語尾は丁寧だが少し申し訳なさそう。
訪問企業: ${session.company_name || 'お客様'}
売るサービス: ${profile?.service_name || '（未設定）'}
価値: ${profile?.value_prop || ''}
ゴール: ${profile?.goal || ''}
紙芝居の内容: ${JSON.stringify(session.slide_contents || [])}

ルール:
- 必ず150文字以内で返答
- 売り込みすぎず、相手の立場に寄り添う
- 分からないことは正直に「確認します」と言う`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = (history || []).map((h: any) => ({ role: h.role, content: h.content }))
      messages.push({ role: 'user', content: user_message })

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPrompt,
          messages,
        }),
      })
      const data = await res.json()
      reply = data.content?.[0]?.text || reply
    } catch (e) {
      console.error('[pitch/chat] AI生成エラー:', e)
    }
  }

  // アシスタント返答保存
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('pitch_chats') as any).insert({
    session_id,
    role: 'assistant',
    content: reply,
  })

  // questions_asked カウントアップ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.rpc as any)('increment_questions', { p_session_id: session_id }).catch(() => {})

  return NextResponse.json({ reply })
}

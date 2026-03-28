// /api/generate-message — AIメッセージ生成（Claude Haiku）
import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

type ServiceProfile = {
  service_name: string
  service_description: string
  target_pain_points: string
  value_proposition: string
  differentiators?: string
  case_study?: string
  desired_cta?: string
  tone?: 'formal' | 'semi-formal' | 'casual'
}

type GenerateRequest = {
  service_profile: ServiceProfile
  company: {
    name: string
    hp_url?: string
    address?: string
  }
  sender: {
    company: string
    name: string
    email: string
    phone: string
  }
}

const TONE_MAP = {
  formal: '丁寧でフォーマルなビジネス文体。「貴社」「ご担当者様」等の敬語を使用。',
  'semi-formal': 'やや柔らかいビジネス文体。丁寧だが堅すぎない。',
  casual: '親しみやすいビジネス文体。フレンドリーだが失礼にならない程度。',
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 500 })
  }

  const body: GenerateRequest = await req.json()
  const { service_profile, company, sender } = body

  if (!service_profile?.service_name || !company?.name) {
    return NextResponse.json({ error: 'service_profile.service_name と company.name は必須です' }, { status: 400 })
  }

  const tone = TONE_MAP[service_profile.tone || 'formal']
  const cta = service_profile.desired_cta || 'ご面談のお時間をいただけましたら幸いです'

  const systemPrompt = `あなたはBtoBフォーム営業のプロフェッショナルコピーライターです。
企業のお問い合わせフォームから送信する営業メッセージを生成します。

【絶対ルール】
- 全体で300〜400文字以内（長すぎると読まれない）
- ${tone}
- 構成: ①宛名 → ②自己紹介（1文） → ③相手の課題への共感（1-2文） → ④提案（2-3文） → ⑤CTA（1文） → ⑥署名
- 宛名は「{会社名} ご担当者様」
- 自己紹介は送信者の会社名・氏名・サービス名を含める
- 相手企業の業種や事業内容を推測し、課題への共感を自然に入れる
- 差別化ポイントや実績があれば具体的に織り込む
- CTAは「${cta}」の趣旨で
- 署名ブロックは含めない（システムが自動付与する）
- 「突然のご連絡失礼いたします」で始めるのは避ける（ありきたりすぎる）
- 改行を適切に入れて読みやすくする
- メッセージ本文のみを出力。説明や注釈は不要`

  const companyContext = [
    `会社名: ${company.name}`,
    company.hp_url ? `HP: ${company.hp_url}` : null,
    company.address ? `所在地: ${company.address}` : null,
  ].filter(Boolean).join('\n')

  const userPrompt = `以下の情報をもとに、${company.name}宛ての営業メッセージを生成してください。

【送信者情報】
会社名: ${sender.company}
担当者: ${sender.name}
メール: ${sender.email}
電話: ${sender.phone}

【サービス情報】
サービス名: ${service_profile.service_name}
概要: ${service_profile.service_description}
解決する課題: ${service_profile.target_pain_points}
提供価値: ${service_profile.value_proposition}
${service_profile.differentiators ? `差別化ポイント: ${service_profile.differentiators}` : ''}
${service_profile.case_study ? `実績: ${service_profile.case_study}` : ''}

【送信先企業】
${companyContext}

上記をもとに、この企業に最適化されたメッセージを生成してください。`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[generate] Claude API error ${res.status}: ${errText}`)
      return NextResponse.json({ error: `AI API error: ${res.status}` }, { status: 502 })
    }

    const data = await res.json()
    const message = data.content?.[0]?.text?.trim() || ''
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)

    return NextResponse.json({
      message,
      tokens_used: tokensUsed,
      model: 'claude-haiku-4-5-20251001',
      estimated_cost_yen: tokensUsed * 0.00004, // approximate
    })
  } catch (e: unknown) {
    console.error('[generate] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

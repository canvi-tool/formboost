// /api/briefings/generate — 日次AIブリーフィング生成
// 前日結果を分析 → 今日のターゲットリストと改善提案を生成 → Slack通知
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

async function callClaude(system: string, user: string, maxTokens = 2000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return {
    text: data.content?.[0]?.text?.trim() || '',
    tokensIn: data.usage?.input_tokens || 0,
    tokensOut: data.usage?.output_tokens || 0,
  }
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY未設定' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const serviceProfileId: string = body.service_profile_id
  if (!serviceProfileId) {
    return NextResponse.json({ error: 'service_profile_id が必要' }, { status: 400 })
  }

  const sb = createServiceClient()

  // 1. サービスプロフィール取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile, error: pErr } = await (sb.from('service_profiles') as any)
    .select('*').eq('id', serviceProfileId).eq('user_id', userId).single()
  if (pErr || !profile) {
    return NextResponse.json({ error: 'service_profile が見つかりません' }, { status: 404 })
  }

  // 2. 前日のブリーフィング結果取得
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prevBriefings } = await (sb.from('daily_briefings') as any)
    .select('id, briefing_date, status, target_count, actual_cost')
    .eq('user_id', userId)
    .eq('service_profile_id', serviceProfileId)
    .gte('briefing_date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
    .order('briefing_date', { ascending: false })
    .limit(7)

  // 前日の実送信結果
  let prevResultsSummary = '（過去の実績なし）'
  if (prevBriefings && prevBriefings.length > 0) {
    const prevIds = prevBriefings.map((b: { id: string }) => b.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prevTargets } = await (sb.from('briefing_targets') as any)
      .select('send_status')
      .in('briefing_id', prevIds)
    const totals = (prevTargets || []).reduce((acc: Record<string, number>, t: { send_status: string }) => {
      acc[t.send_status] = (acc[t.send_status] || 0) + 1
      return acc
    }, {})
    prevResultsSummary = `直近7日: 送信${totals.success || 0}件成功 / ${totals.failed || 0}件失敗 / ${totals.pending || 0}件未送信`
  }

  // 3. 今日の候補企業リストを取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates, error: cErr } = await (sb as any).rpc('get_candidate_companies', {
    p_user_id: userId,
    p_criteria: profile.target_criteria || {},
    p_limit: profile.daily_target_count || 50,
  })
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ error: '候補企業が見つかりません。ターゲット条件を調整してください。' }, { status: 404 })
  }

  // 4. AIで分析・改善提案を生成
  const systemPrompt = `あなたは優秀なBtoB営業マネージャーです。毎朝、部下（AI営業社員）に本日の営業計画を提示します。
前日までの結果を踏まえて、本日の戦略を簡潔に提案してください。

出力フォーマット（JSON）:
{
  "summary_prev_day": "前日までの結果サマリ（2-3行）",
  "analysis": "何が上手くいき、何が課題か（3-5行）",
  "improvements": "今日の改善ポイント（箇条書き3項目）",
  "today_plan": "本日の戦略（2-3行、具体的なトーン・訴求ポイント）"
}

JSONのみを出力。余計な説明は不要。`

  const userPrompt = `【サービス】${profile.name}
${profile.service_description || ''}
【ゴール】${profile.sales_goal}
【差別化】${profile.differentiators || '（未設定）'}

【前日までの結果】
${prevResultsSummary}

【本日の候補リスト】
${candidates.length}社（業種: ${[...new Set(candidates.map((c: { industry_major: string }) => c.industry_major).filter(Boolean))].slice(0, 5).join('、')}等）

本日の戦略を提案してください。`

  let analysis: { summary_prev_day: string; analysis: string; improvements: string; today_plan: string }
  let tokensIn = 0, tokensOut = 0
  try {
    const result = await callClaude(systemPrompt, userPrompt, 1500)
    tokensIn = result.tokensIn
    tokensOut = result.tokensOut
    // JSON抽出（Markdownコードブロックを除去）
    const jsonText = result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    analysis = JSON.parse(jsonText)
  } catch (e) {
    console.error('[briefings/generate] Claude parse error:', e)
    analysis = {
      summary_prev_day: prevResultsSummary,
      analysis: 'AI分析の生成に失敗しました',
      improvements: '手動で戦略を確認してください',
      today_plan: profile.service_description || '',
    }
  }

  // 5. コスト見積もり（別途 /api/cost-estimate ロジックと揃える）
  const aiCostPerMsg = (800 / 1000) * 0.12 + (300 / 1000) * 0.6  // ≈ ¥0.28
  const sendCostPerMsg = 0.3 * 0.5
  const needsDiscovery = candidates.filter((c: { form_url: string | null }) => !c.form_url).length
  const discoveryCost = needsDiscovery * 0.5
  const estimatedCost = Math.ceil(
    candidates.length * aiCostPerMsg +
    candidates.length * sendCostPerMsg +
    discoveryCost
  )

  // 6. daily_briefings INSERT
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefing, error: bErr } = await (sb.from('daily_briefings') as any)
    .insert({
      user_id: userId,
      service_profile_id: serviceProfileId,
      briefing_date: new Date().toISOString().slice(0, 10),
      status: 'draft',
      summary_prev_day: analysis.summary_prev_day,
      analysis: analysis.analysis,
      improvements: analysis.improvements,
      today_plan: analysis.today_plan,
      target_criteria_used: profile.target_criteria || {},
      target_count: candidates.length,
      message_template: profile.service_description || '',
      estimated_cost: estimatedCost,
    })
    .select()
    .single()

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  // 7. briefing_targets INSERT
  const btRows = candidates.map((c: { hojin_number: string; company_name: string; hp_url: string | null; form_url: string | null }) => ({
    briefing_id: briefing.id,
    hojin_number: c.hojin_number,
    company_name: c.company_name,
    hp_url: c.hp_url,
    form_url: c.form_url,
    send_status: 'pending',
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('briefing_targets') as any).insert(btRows)

  // 8. agent_decisions ログ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('agent_decisions') as any).insert({
    user_id: userId,
    briefing_id: briefing.id,
    decision_type: 'daily_briefing',
    input: { service_profile_id: serviceProfileId, candidate_count: candidates.length },
    output: analysis,
    model: 'claude-haiku-4-5-20251001',
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost: (tokensIn / 1000) * 0.12 + (tokensOut / 1000) * 0.6,
  })

  return NextResponse.json({
    briefing,
    analysis,
    candidates_count: candidates.length,
    estimated_cost: estimatedCost,
  })
}

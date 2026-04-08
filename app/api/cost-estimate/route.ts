// /api/cost-estimate — 実行前コスト見積もり
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// 単価（円）— 概算
const COST = {
  haiku_input_per_1k: 0.12,   // $0.8/1M tokens ≈ ¥0.12/1k
  haiku_output_per_1k: 0.60,  // $4/1M tokens ≈ ¥0.6/1k
  brave_per_query: 0.5,       // Brave Search API: ~$0.003/q ≈ ¥0.5
  cloud_run_per_min: 0.3,     // Cloud Run: ~¥0.3/分（Playwright実行）
  supabase_per_record: 0.01,  // Supabase: ほぼ無視できるが加算
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  const targetCount: number = Number(body.target_count) || 0
  const needsFormDiscovery: number = Number(body.needs_form_discovery) || 0
  const needsAiGeneration: boolean = !!body.needs_ai_generation

  if (targetCount <= 0) {
    return NextResponse.json({ error: 'target_count > 0 が必要' }, { status: 400 })
  }

  // 1. AIメッセージ生成コスト（全社に個別生成）
  const aiInputTokensPerMsg = 800
  const aiOutputTokensPerMsg = 300
  const aiCostPerMsg =
    (aiInputTokensPerMsg / 1000) * COST.haiku_input_per_1k +
    (aiOutputTokensPerMsg / 1000) * COST.haiku_output_per_1k
  const aiTotal = needsAiGeneration ? aiCostPerMsg * targetCount : 0

  // 2. フォームURL探索コスト（3段階）
  // Stage 2 (HP crawl): Cloud Runで1社30秒想定
  // Stage 3 (AI search): Brave検索 + Claude解析
  const hpCrawlCost = (needsFormDiscovery * 0.7) * COST.cloud_run_per_min * 0.5 // 50%がHP解析で完了
  const aiSearchCost = (needsFormDiscovery * 0.3) * (COST.brave_per_query + aiCostPerMsg * 0.5)
  const discoveryTotal = hpCrawlCost + aiSearchCost

  // 3. フォーム送信コスト（Cloud Run Playwright）
  const sendCostPerMsg = COST.cloud_run_per_min * 0.5 // 30秒/件
  const sendTotal = targetCount * sendCostPerMsg

  // 4. DB/ログコスト
  const dbCost = targetCount * COST.supabase_per_record * 3

  const total = Math.ceil(aiTotal + discoveryTotal + sendTotal + dbCost)

  return NextResponse.json({
    target_count: targetCount,
    breakdown: {
      ai_message_generation: Math.ceil(aiTotal),
      form_discovery: Math.ceil(discoveryTotal),
      form_submission: Math.ceil(sendTotal),
      database_logging: Math.ceil(dbCost),
    },
    total_yen: total,
    per_company_yen: Math.ceil(total / targetCount),
    estimated_duration_min: Math.ceil((targetCount * 30 + needsFormDiscovery * 45) / 60 / 5), // 5並列想定
    notes: [
      'Claude Haiku概算: 入力¥0.12/1k + 出力¥0.6/1k',
      'Cloud Run Playwright: 1件あたり約30秒',
      'フォームURL探索: 70%がHP解析で解決、30%がAI探索',
    ],
  })
}

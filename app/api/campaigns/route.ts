// /api/campaigns — キャンペーンCRUD + CSVインポート
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET: キャンペーン一覧
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaigns: data })
}

// POST: キャンペーン作成 + targets一括登録
export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json()
  const { name, targets, sender } = body

  if (!name || !targets?.length) {
    return NextResponse.json({ error: 'name と targets が必要です' }, { status: 400 })
  }

  // コスト見積もり
  let estimatedCost = 0
  for (const t of targets) {
    if (t.form_url) estimatedCost += 0.56
    else if (t.hp_url) estimatedCost += 0.67
    else estimatedCost += 2.89
  }

  // キャンペーン作成
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      user_id: userId,
      name,
      total_targets: targets.length,
      template: sender?.message || '',
      sender_company: sender?.company || '',
      sender_name: sender?.name || '',
      sender_email: sender?.email || '',
      sender_phone: sender?.phone || '',
      estimated_cost: estimatedCost,
    })
    .select()
    .single()

  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 })

  // targets一括登録（1000件ずつ）
  const campaignId = campaign.id
  const batchSize = 1000
  let insertedCount = 0

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize).map((t: Record<string, string>) => ({
      campaign_id: campaignId,
      company: t.company,
      form_url: t.form_url || null,
      hp_url: t.hp_url || null,
      hojin_number: t.hojin_number || null,
      address: t.address || null,
    }))

    const { error } = await supabase.from('targets').insert(batch)
    if (error) {
      console.error(`[campaigns] target insert error at batch ${i}:`, error.message)
      continue
    }
    insertedCount += batch.length
  }

  // ログ記録
  await supabase.from('execution_logs').insert({
    campaign_id: campaignId,
    level: 'info',
    phase: 'campaign',
    message: `キャンペーン「${name}」作成: ${insertedCount}社`,
    metadata: { estimated_cost: estimatedCost },
  })

  return NextResponse.json({
    campaign: { ...campaign, inserted_targets: insertedCount },
    estimated_cost: estimatedCost,
  })
}

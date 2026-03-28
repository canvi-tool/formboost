// /api/webhook — Cloud Run 完了通知受け口
// Cloud Runが1社送信完了するたびにPOSTしてくる
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''

export async function POST(req: NextRequest) {
  // 簡易認証（Cloud RunからのリクエストのみOK）
  const authHeader = req.headers.get('x-webhook-secret')
  if (WEBHOOK_SECRET && authHeader !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const {
    target_id,
    campaign_id,
    success,
    form_url,
    final_url,
    page_title,
    filled_fields,
    complete_detected,
    complete_keyword,
    screenshot_url,
    elapsed_ms,
    error: sendError,
    captcha_detected,
    mode,
  } = body

  if (!target_id) {
    return NextResponse.json({ error: 'target_id is required' }, { status: 400 })
  }

  // target更新
  const sendStatus = captcha_detected ? 'captcha'
    : success ? 'success'
    : sendError?.includes('フォームフィールド') ? 'skipped'
    : 'failed'

  const { error: updateError } = await supabase
    .from('targets')
    .update({
      send_status: sendStatus,
      form_url: form_url || undefined,
      final_url: final_url || null,
      page_title: page_title || null,
      filled_fields: filled_fields || null,
      complete_detected: complete_detected || false,
      complete_keyword: complete_keyword || null,
      screenshot_url: screenshot_url || null,
      elapsed_ms: elapsed_ms || null,
      send_error: sendError || null,
      sent_at: success ? new Date().toISOString() : null,
    })
    .eq('id', target_id)

  if (updateError) {
    console.error(`[webhook] target update failed: ${updateError.message}`)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // キャンペーンカウンター更新（Atomic RPC）
  if (campaign_id) {
    const field = sendStatus === 'success' ? 'success_count'
      : sendStatus === 'failed' ? 'failed_count'
      : 'skipped_count'

    // Atomic increment via RPC
    await supabase.rpc('increment_campaign_counter', {
      p_campaign_id: campaign_id,
      p_field: field,
      p_amount: 1,
    })

    // コスト加算 + 完了チェック
    const costPerSend = mode === 'A' ? 0.56 : mode === 'B' ? 0.67 : 2.89
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('sent_count, total_targets, actual_cost')
      .eq('id', campaign_id)
      .single()

    if (campaign) {
      const update: Record<string, unknown> = {
        actual_cost: (campaign.actual_cost || 0) + costPerSend,
      }
      if (campaign.sent_count >= campaign.total_targets) {
        update.status = 'done'
      }
      await supabase.from('campaigns').update(update).eq('id', campaign_id)
    }

    // 実行ログ
    await supabase.from('execution_logs').insert({
      campaign_id,
      target_id,
      level: success ? 'info' : 'warn',
      phase: 'webhook',
      message: success
        ? `送信成功: ${filled_fields?.length || 0}項目入力${complete_detected ? ' / 完了確認済' : ''}`
        : `送信${sendStatus}: ${sendError || '不明'}`,
      metadata: { mode, elapsed_ms, captcha_detected },
    })
  }

  return NextResponse.json({ success: true, status: sendStatus })
}

// app/api/batch/route.ts
// バッチ処理エンドポイント — Mode A/B対応
// POST /api/batch でジョブ開始、GET /api/batch?jobId=xxx で進捗確認

import { NextRequest, NextResponse } from 'next/server'

const SENDER_URL = process.env.SENDER_URL || ''

// ジョブの状態をメモリ管理（本番はFirestoreに変更推奨）
const jobs = new Map<string, {
  id: string
  status: 'running' | 'done' | 'error'
  total: number
  current: number
  results: {
    company: string
    status: 'success' | 'failed' | 'skipped'
    form_url?: string
    error?: string
    sent_at?: string
    complete_detected?: boolean
    mode?: string
    captcha_detected?: boolean
    elapsed_ms?: number
  }[]
  startedAt: string
  finishedAt?: string
}>()

// 1社分の処理（フォーム検索→送信）
async function processCompany(
  company: string,
  sender: Record<string, string>,
  baseUrl: string,
  record?: { form_url?: string; hp_url?: string; hojin_number?: string; address?: string }
): Promise<{
  status: 'success' | 'failed' | 'skipped'
  form_url?: string
  error?: string
  complete_detected?: boolean
  mode?: string
  captcha_detected?: boolean
  elapsed_ms?: number
}> {
  try {
    // ① フォームURL検索
    const searchRes = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company,
        form_url: record?.form_url || '',
        hp_url: record?.hp_url || '',
        hojin_number: record?.hojin_number || '',
        address: record?.address || '',
      }),
      signal: AbortSignal.timeout(30000)
    })
    const searchData = await searchRes.json()

    // Mode判定
    const mode = searchData.mode || 'search'
    const formUrl = searchData.form_url || null
    const hpUrl = searchData.hp_url || searchData.site_url || null

    if (searchData.status !== 'success') {
      return { status: 'skipped', error: searchData.message || '\u30d5\u30a9\u30fc\u30e0URL\u672a\u691c\u51fa', mode }
    }

    // ② 自動送信（リトライ1回）— Mode A/B対応
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const sendRes = await fetch(`${SENDER_URL}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_url: formUrl,
            hp_url: (!formUrl && hpUrl) ? hpUrl : null,
            sender,
            mode: formUrl ? 'A' : 'B',
          }),
          signal: AbortSignal.timeout(90000)
        })
        const sendData = await sendRes.json()

        if (sendData.success) {
          return {
            status: 'success',
            form_url: sendData.form_url || formUrl,
            complete_detected: sendData.complete_detected,
            mode: sendData.mode || mode,
            elapsed_ms: sendData.elapsed_ms,
          }
        }

        // CAPTCHA検出: リトライしない
        if (sendData.captcha_detected) {
          return {
            status: 'skipped',
            form_url: sendData.form_url || formUrl,
            error: 'CAPTCHA\u691c\u51fa',
            captcha_detected: true,
            mode: sendData.mode || mode,
          }
        }

        // フォーム未検出エラー: リトライしない
        if (sendData.error?.includes('\u30d5\u30a9\u30fc\u30e0\u30d5\u30a3\u30fc\u30eb\u30c9\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093')) {
          return { status: 'skipped', form_url: sendData.form_url || formUrl, error: sendData.error, mode: sendData.mode || mode }
        }

        if (attempt === 2) {
          return { status: 'failed', form_url: sendData.form_url || formUrl, error: sendData.error || '\u9001\u4fe1\u5931\u6557', mode: sendData.mode || mode }
        }

        await new Promise(r => setTimeout(r, 3000))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (attempt === 2) return { status: 'failed', error: msg, mode }
        await new Promise(r => setTimeout(r, 3000))
      }
    }
    return { status: 'failed', error: '\u6700\u5927\u30ea\u30c8\u30e9\u30a4\u8d85\u904e', mode }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'skipped', error: msg }
  }
}

// バッチ実行（バックグラウンドで動かす）
async function runBatch(
  jobId: string,
  companies: string[],
  companyRecords: Record<string, { form_url?: string; hp_url?: string; hojin_number?: string; address?: string }>,
  sender: Record<string, string>,
  baseUrl: string,
  intervalMs: number
) {
  const job = jobs.get(jobId)!

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i].trim()
    if (!company) continue

    job.current = i + 1
    const record = companyRecords[company] || {}
    const result = await processCompany(company, sender, baseUrl, record)

    job.results.push({
      company,
      ...result,
      sent_at: new Date().toISOString()
    })

    // 会社間の送信間隔（デフォルト3秒）
    if (i < companies.length - 1) {
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }

  job.status = 'done'
  job.finishedAt = new Date().toISOString()
}

// POST: バッチジョブ開始
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { companies, company_records = [], sender, interval_ms = 3000 } = body

  // company_records配列をRecord形式に変換
  const recordMap: Record<string, { form_url?: string; hp_url?: string; hojin_number?: string; address?: string }> = {}
  if (Array.isArray(company_records)) {
    for (const r of company_records) {
      if (r.company) recordMap[r.company] = r
    }
  }

  if (!companies?.length) {
    return NextResponse.json({ error: '\u4f1a\u793e\u30ea\u30b9\u30c8\u304c\u7a7a\u3067\u3059' }, { status: 400 })
  }
  if (!SENDER_URL) {
    return NextResponse.json({ error: 'SENDER_URL\u672a\u8a2d\u5b9a' }, { status: 500 })
  }

  const jobId = `job_${Date.now()}`
  const baseUrl = req.nextUrl.origin

  jobs.set(jobId, {
    id: jobId,
    status: 'running',
    total: companies.length,
    current: 0,
    results: [],
    startedAt: new Date().toISOString()
  })

  // バックグラウンド実行（awaitしない）
  runBatch(jobId, companies, recordMap, sender, baseUrl, interval_ms).catch(e => {
    const job = jobs.get(jobId)
    if (job) { job.status = 'error'; job.finishedAt = new Date().toISOString() }
    console.error('Batch error:', e)
  })

  return NextResponse.json({ jobId, total: companies.length, status: 'running' })
}

// GET: ジョブ進捗確認
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId')

  if (!jobId) {
    const list = Array.from(jobs.values()).map(j => ({
      id: j.id, status: j.status, total: j.total,
      current: j.current, startedAt: j.startedAt, finishedAt: j.finishedAt,
      successCount: j.results.filter(r => r.status === 'success').length,
      failedCount: j.results.filter(r => r.status === 'failed').length,
      skippedCount: j.results.filter(r => r.status === 'skipped').length,
    }))
    return NextResponse.json({ jobs: list })
  }

  const job = jobs.get(jobId)
  if (!job) return NextResponse.json({ error: '\u30b8\u30e7\u30d6\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093' }, { status: 404 })

  const successCount = job.results.filter(r => r.status === 'success').length
  const failedCount = job.results.filter(r => r.status === 'failed').length
  const skippedCount = job.results.filter(r => r.status === 'skipped').length

  return NextResponse.json({
    ...job,
    successCount,
    failedCount,
    skippedCount,
    progressPct: job.total ? Math.round((job.current / job.total) * 100) : 0
  })
}

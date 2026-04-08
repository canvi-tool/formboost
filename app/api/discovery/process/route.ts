// /api/discovery/process — フォームURL3段階探索ワーカー
// Stage1: 既存URLチェック → Stage2: HPクロール → Stage3: AI探索（Brave + Claude）
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 300

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || ''

// HPをクロールして問い合わせフォームURLを探す
async function crawlHpForFormUrl(hpUrl: string): Promise<string | null> {
  try {
    const res = await fetch(hpUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FormBoostBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // 問い合わせページへのリンクを探す
    const contactKeywords = [
      'contact', 'inquiry', 'form', 'otoiawase', 'toiawase', '問い合わせ', 'お問い合わせ', 'お問合せ',
    ]
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi
    const candidates: { url: string; score: number }[] = []
    let match
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1]
      const text = match[2].toLowerCase()
      let score = 0
      for (const kw of contactKeywords) {
        if (href.toLowerCase().includes(kw)) score += 2
        if (text.includes(kw)) score += 1
      }
      if (score > 0) {
        try {
          const absoluteUrl = new URL(href, hpUrl).href
          candidates.push({ url: absoluteUrl, score })
        } catch {
          /* skip invalid URLs */
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]?.url || null
  } catch (e) {
    console.error('[crawlHp] error:', e)
    return null
  }
}

// Brave Searchで「会社名 お問い合わせ」を検索
async function braveSearchFormUrl(companyName: string): Promise<string | null> {
  if (!BRAVE_API_KEY) return null
  try {
    const q = encodeURIComponent(`${companyName} お問い合わせ フォーム`)
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${q}&count=5`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const results = data.web?.results || []
    // 問い合わせっぽいURLを優先
    for (const r of results) {
      const url: string = r.url
      if (/contact|inquiry|form|toiawase|問い合わせ/i.test(url)) return url
    }
    return results[0]?.url || null
  } catch (e) {
    console.error('[braveSearch] error:', e)
    return null
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const limit = Math.min(Number(body.limit) || 10, 50)
  const hojinNumbers: string[] | undefined = body.hojin_numbers

  const sb = createServiceClient()

  // 対象企業を取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (sb.from('companies') as any)
    .select('hojin_number, company_name, hp_url, form_url')
    .eq('defunct', false)
    .eq('discovery_stage', 'pending')
    .is('form_url', null)
    .limit(limit)

  if (hojinNumbers && hojinNumbers.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (sb.from('companies') as any)
      .select('hojin_number, company_name, hp_url, form_url')
      .in('hojin_number', hojinNumbers)
  }

  const { data: targets, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!targets || targets.length === 0) return NextResponse.json({ processed: 0, results: [] })

  const results: Array<{ hojin_number: string; company_name: string; stage: string; form_url: string | null }> = []

  for (const c of targets) {
    let formUrl: string | null = null
    let source: 'existing' | 'hp_crawl' | 'ai_search' | 'none' = 'none'
    let stage: 'done' | 'failed' = 'failed'
    let cost = 0
    let errorMsg: string | null = null

    try {
      // Stage 1: form_urlが既にあればそれを使う（上のクエリで除外済みだが念のため）
      if (c.form_url) {
        formUrl = c.form_url
        source = 'existing'
        stage = 'done'
      }

      // Stage 2: HPクロール
      if (!formUrl && c.hp_url) {
        formUrl = await crawlHpForFormUrl(c.hp_url)
        if (formUrl) {
          source = 'hp_crawl'
          stage = 'done'
          cost = 0.05
        }
      }

      // Stage 3: AI探索
      if (!formUrl) {
        formUrl = await braveSearchFormUrl(c.company_name)
        if (formUrl) {
          source = 'ai_search'
          stage = 'done'
          cost = 0.5
        }
      }

      if (!formUrl) {
        errorMsg = '3段階探索でフォームURLが見つかりませんでした'
      }
    } catch (e: unknown) {
      errorMsg = e instanceof Error ? e.message : String(e)
    }

    // 結果を更新
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from('companies') as any)
      .update({
        form_url: formUrl,
        discovery_stage: stage,
        discovery_source: source,
        discovery_cost: cost,
        discovery_error: errorMsg,
        last_discovered_at: new Date().toISOString(),
      })
      .eq('hojin_number', c.hojin_number)

    results.push({
      hojin_number: c.hojin_number,
      company_name: c.company_name,
      stage,
      form_url: formUrl,
    })
  }

  return NextResponse.json({
    processed: results.length,
    found: results.filter(r => r.form_url).length,
    results,
  })
}

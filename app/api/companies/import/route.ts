// /api/companies/import — 企業マスタ取込（バッチUPSERT）
// クライアント側でCSVをパースし、1000件ずつPOSTする
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

type CompanyRow = {
  hojin_number: string
  company_name: string
  industry_major?: string
  industry_minor?: string
  business_content?: string
  employees?: number | null
  capital?: number | null
  revenue_range?: string
  postal_code?: string
  prefecture?: string
  city?: string
  address?: string
  founded_date?: string
  ceo_name?: string
  listing_status?: string
  phone?: string
  emails?: string
  hp_url?: string
  form_url?: string
  branches_count?: number | null
  defunct?: boolean
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  let body: { rows: CompanyRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { rows } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows は空にできません' }, { status: 400 })
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: '1回のバッチは2000件まで' }, { status: 400 })
  }

  // 最低限の検証・クリーニング
  const cleaned = rows
    .filter(r => r.hojin_number && r.company_name)
    .map(r => ({
      hojin_number: String(r.hojin_number).trim(),
      company_name: String(r.company_name).trim(),
      industry_major: r.industry_major || null,
      industry_minor: r.industry_minor || null,
      business_content: r.business_content || null,
      employees: r.employees ?? null,
      capital: r.capital ?? null,
      revenue_range: r.revenue_range || null,
      postal_code: r.postal_code || null,
      prefecture: r.prefecture || null,
      city: r.city || null,
      address: r.address || null,
      founded_date: r.founded_date || null,
      ceo_name: r.ceo_name || null,
      listing_status: r.listing_status || null,
      phone: r.phone || null,
      emails: r.emails || null,
      hp_url: r.hp_url || null,
      form_url: r.form_url || null,
      branches_count: r.branches_count ?? null,
      defunct: r.defunct || false,
      discovery_stage: r.form_url ? 'done' : 'pending',
      discovery_source: r.form_url ? 'existing' : 'none',
    }))

  if (cleaned.length === 0) {
    return NextResponse.json({ error: '有効な行がありません' }, { status: 400 })
  }

  const sb = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.from('companies') as any)
    .upsert(cleaned, { onConflict: 'hojin_number', ignoreDuplicates: false })

  if (error) {
    console.error('[companies/import] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    inserted: cleaned.length,
    with_form_url: cleaned.filter(c => c.form_url).length,
    needs_discovery: cleaned.filter(c => !c.form_url).length,
  })
}

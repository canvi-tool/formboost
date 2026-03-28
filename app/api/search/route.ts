import { NextRequest, NextResponse } from 'next/server'

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const SENDER_URL = process.env.SENDER_URL || ''

const EXCLUDE_DOMAINS = [
  'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'instagram.com',
  'indeed.com', 'wantedly.com', 'wikipedia.org', 'youtube.com',
  'amazon.co.jp', 'rakuten.co.jp', 'nikkei.com', 'prtimes.jp', 'note.com',
  'jobcan.ne.jp', 'mynavi.jp', 'rikunabi.com', 'en-japan.com',
  'anotherworks.com', 'green-japan.com', 'type.jp',
]

const CORP_SUBDOMAINS = ['corp.', 'ir.', 'investor.', 'careers.', 'recruit.', 'media.', 'news.']

const CONTACT_KEYWORDS = [
  'contact', '\u304a\u554f\u3044\u5408\u308f\u305b', '\u554f\u3044\u5408\u308f\u305b', 'inquiry',
  '\u304a\u554f\u5408\u305b', '\u554f\u5408\u305b', '\u3054\u76f8\u8ac7', '\u8cc7\u6599\u8acb\u6c42', 'contact-us', 'form', 'contacts'
]

// ─── コスト追跡 ───
type CostBreakdown = {
  brave_queries: number    // Brave Search回数
  claude_verify: number    // Claude verify回数
  claude_form: number      // Claude form解析回数
  estimated_yen: number    // 推定コスト（円）
}

function createCostTracker(): CostBreakdown {
  return { brave_queries: 0, claude_verify: 0, claude_form: 0, estimated_yen: 0 }
}

function calcCost(cost: CostBreakdown): number {
  // Brave: ¥0.75/query, Claude Haiku verify: ¥0.08/call, Claude form: ¥0.44/call, Cloud Run: ¥0.11
  return cost.brave_queries * 0.75 + cost.claude_verify * 0.08 + cost.claude_form * 0.44 + 0.11
}

async function braveSearch(query: string, cost: CostBreakdown): Promise<any[]> {
  try {
    cost.brave_queries++
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&country=jp`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY
        },
        next: { revalidate: 0 }
      }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.web?.results || []
  } catch { return [] }
}

function getBaseDomain(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length > 2 ? parts.slice(1).join('.') : hostname
}

function isCorpSubdomain(hostname: string): boolean {
  return CORP_SUBDOMAINS.some(prefix => hostname.startsWith(prefix))
}

// ─── 国税庁API ───
async function getCompanyByHojinNumber(hojinNumber: string): Promise<{ name: string; address: string } | null> {
  const cleaned = hojinNumber.replace(/[-\s]/g, '')
  if (!/^\d{13}$/.test(cleaned)) {
    console.warn(`[hojin] invalid format: "${hojinNumber}"`)
    return null
  }

  const endpoints = [
    `https://api.houjin-bangou.nta.go.jp/4/num?id=formboost&number=${cleaned}&type=12`,
    `https://api.houjin-bangou.nta.go.jp/3/num?id=formboost&number=${cleaned}&type=12`,
  ]

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) { console.warn(`[hojin] HTTP ${res.status} from ${url}`); continue }
      const data = await res.json()
      if (data.message) { console.warn(`[hojin] API message: ${data.message}`); continue }
      const corp = data.corporation?.[0]
      if (!corp) { console.warn(`[hojin] no corp found for number ${cleaned}`); return null }
      const address = [corp.prefectureName, corp.cityName, corp.streetNumber].filter(Boolean).join('')
      console.log(`[hojin] found: ${corp.name} / ${address}`)
      return { name: corp.name || '', address }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[hojin] error: ${url} -> ${msg}`)
    }
  }

  console.warn(`[hojin] all endpoints failed, continuing without hojin info`)
  return null
}

// ─── Claude verify ───
async function verifyCompanyUrl(
  company: string,
  url: string,
  snippets: string[],
  cost: CostBreakdown,
  hojinInfo?: { name: string; address: string } | null
): Promise<boolean> {
  if (!ANTHROPIC_API_KEY) return true

  try {
    cost.claude_verify++
    const hojinContext = hojinInfo
      ? `\nOfficial name in corporate registry: ${hojinInfo.name}\nAddress: ${hojinInfo.address}`
      : ''

    const prompt = `Is this URL the official website of "${company}"?${hojinContext}

URL: ${url}
Search snippet: ${snippets.slice(0, 2).join(' / ')}

Rules:
- Same company or affiliate: YES
- Clearly a different company: NO
- Uncertain: YES

Answer with only "YES" or "NO".`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    if (!res.ok) {
      console.warn(`[verify] API error ${res.status}, defaulting to true`)
      return true
    }
    const data = await res.json()
    const answer = data.content?.[0]?.text?.trim().toUpperCase() || ''
    const isNo = answer.startsWith('NO')
    console.log(`[verify] ${company} | ${url} -> "${answer}" -> ${isNo ? 'REJECT' : 'PASS'}`)
    return !isNo
  } catch (e) {
    console.warn(`[verify] exception: ${e}, defaulting to true`)
    return true
  }
}

// ─── HP URLからフォーム発見（sender経由 Playwright巡回） ───
async function discoverFormViaSender(hpUrl: string): Promise<string | null> {
  if (!SENDER_URL) return null

  try {
    const res = await fetch(`${SENDER_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form_url: hpUrl }),
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.success && data.field_count > 0) {
      return hpUrl // HPページ自体にフォームがある場合
    }
    return null
  } catch {
    return null
  }
}

// ─── HP URLのフォームページ巡回（HEAD requests） ───
async function findFormFromHpUrl(company: string, hpUrl: string, cost: CostBreakdown): Promise<{ form_url: string | null, confidence: string }> {
  // 1. HPのURL自体がcontactページの場合
  if (CONTACT_KEYWORDS.some(kw => hpUrl.toLowerCase().includes(kw))) {
    return { form_url: hpUrl, confidence: 'high' }
  }

  const parsed = new URL(hpUrl)
  const hostname = parsed.hostname
  const baseDomain = getBaseDomain(hostname)

  // 2. 既知パスをHEADで巡回（Brave不要・コスト0）
  const candidates = [
    hpUrl.replace(/\/$/, ''),
    `${parsed.protocol}//${baseDomain}`,
    `${parsed.protocol}//www.${baseDomain}`,
  ].filter((v, i, a) => a.indexOf(v) === i) // 重複除去

  const commonPaths = [
    '/contact', '/contact/', '/contact-us', '/contact-us/',
    '/inquiry', '/inquiry/', '/inquire', '/inquire/',
    '/contactus', '/form', '/form/', '/forms',
    '/support', '/support/', '/help', '/request',
    '/consultation', '/ask', '/reach-us',
    '/otoiawase', '/toiawase', '/soudan',
    '/mail', '/mailform', '/mail-form',
    '/about/contact', '/company/contact', '/ir/contact',
    '/contents/contact', '/page/contact',
    '/contacts', '/contacts/',
  ]

  for (const base of candidates) {
    for (const path of commonPaths) {
      try {
        const r = await fetch(base + path, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3000) })
        if (r.ok) {
          console.log(`[form] HEAD hit: ${r.url || base + path}`)
          return { form_url: r.url || base + path, confidence: 'medium' }
        }
      } catch { continue }
    }
  }

  // 3. Brave検索でフォーム検索（フォールバック）
  if (BRAVE_API_KEY) {
    const items = await braveSearch(`${company} \u304a\u554f\u3044\u5408\u308f\u305b \u30d5\u30a9\u30fc\u30e0`, cost)
    for (const item of items) {
      const url: string = item.url || ''
      try {
        const urlDomain = new URL(url).hostname
        const isRelated = urlDomain === hostname || urlDomain.endsWith('.' + baseDomain) || urlDomain === baseDomain
        if (isRelated && CONTACT_KEYWORDS.some(kw =>
          url.toLowerCase().includes(kw) || (item.title || '').toLowerCase().includes(kw)
        )) {
          return { form_url: url, confidence: 'high' }
        }
        if (isRelated) return { form_url: url, confidence: 'medium' }
      } catch { continue }
    }
  }

  return { form_url: null, confidence: 'none' }
}

// ─── Brave Search フロー（会社名のみの場合） ───
async function getSiteUrl(
  company: string,
  address: string | undefined,
  cost: CostBreakdown,
  hojinInfo?: { name: string; address: string } | null
): Promise<string | null> {
  const locationHint = address ? address.slice(0, 6) : ''

  const queries = locationHint
    ? [
        `${company} ${locationHint} \u516c\u5f0f\u30b5\u30a4\u30c8`,
        `${company} \u516c\u5f0f\u30b5\u30a4\u30c8`,
        `"${company}" site`,
      ]
    : [
        `${company} \u516c\u5f0f\u30b5\u30a4\u30c8`,
        `"${company}" site`,
      ]

  // 先にcontactページを直接検索
  const contactQuery = `${company} ${locationHint} \u304a\u554f\u3044\u5408\u308f\u305b`.trim()
  console.log(`[search] contact query: ${contactQuery}`)
  const contactItems = await braveSearch(contactQuery, cost)
  console.log(`[search] contact results: ${contactItems.length}`)

  for (const item of contactItems) {
    const url: string = item.url || ''
    if (!url || EXCLUDE_DOMAINS.some(d => url.includes(d))) continue
    try {
      const u = new URL(url)
      if (CONTACT_KEYWORDS.some(kw => u.pathname.toLowerCase().includes(kw))) {
        const isMatch = await verifyCompanyUrl(company, url, [item.title || '', item.description || ''], cost, hojinInfo)
        if (isMatch) {
          console.log(`[search] contact URL found: ${url}`)
          return url
        }
      }
    } catch { continue }
  }

  // 公式サイト検索
  for (const searchQuery of queries) {
    console.log(`[search] site query: ${searchQuery}`)
    const items = await braveSearch(searchQuery, cost)
    console.log(`[search] site results: ${items.length}`)
    let corpUrl: string | null = null

    for (const item of items) {
      const url: string = item.url || ''
      if (!url || EXCLUDE_DOMAINS.some(d => url.includes(d))) continue
      try {
        const u = new URL(url)
        const hostname = u.hostname
        const isMatch = await verifyCompanyUrl(company, url, [item.title || '', item.description || ''], cost, hojinInfo)
        if (!isMatch) continue

        if (isCorpSubdomain(hostname)) {
          if (!corpUrl) corpUrl = `${u.protocol}//${hostname}`
        } else {
          console.log(`[search] site URL found: ${u.protocol}//${hostname}`)
          return `${u.protocol}//${hostname}`
        }
      } catch { continue }
    }
    if (corpUrl) {
      console.log(`[search] corp subdomain URL found: ${corpUrl}`)
      return corpUrl
    }
  }

  console.warn(`[search] no site URL found for: ${company}`)
  return null
}

async function findContactForm(company: string, siteUrl: string, cost: CostBreakdown): Promise<{ form_url: string | null, confidence: string }> {
  if (CONTACT_KEYWORDS.some(kw => siteUrl.toLowerCase().includes(kw))) {
    return { form_url: siteUrl, confidence: 'high' }
  }

  const hostname = new URL(siteUrl).hostname
  const baseDomain = getBaseDomain(hostname)

  const items = await braveSearch(`${company} \u304a\u554f\u3044\u5408\u308f\u305b \u30d5\u30a9\u30fc\u30e0`, cost)

  for (const item of items) {
    const url: string = item.url || ''
    const title = (item.title || '').toLowerCase()
    const desc = (item.description || '').toLowerCase()
    try {
      const urlDomain = new URL(url).hostname
      const isRelated = urlDomain === hostname || urlDomain.endsWith('.' + baseDomain) || urlDomain === baseDomain
      if (isRelated && CONTACT_KEYWORDS.some(kw =>
        url.toLowerCase().includes(kw) || title.includes(kw) || desc.includes(kw)
      )) {
        return { form_url: url, confidence: 'high' }
      }
    } catch { continue }
  }

  for (const item of items) {
    const url: string = item.url || ''
    try {
      const urlDomain = new URL(url).hostname
      const isRelated = urlDomain === hostname || urlDomain.endsWith('.' + baseDomain) || urlDomain === baseDomain
      if (isRelated) return { form_url: url, confidence: 'medium' }
    } catch { continue }
  }

  // HEAD巡回
  const protocol = new URL(siteUrl).protocol
  const candidates = [
    siteUrl,
    baseDomain !== hostname ? `${protocol}//${baseDomain}` : null,
    `${protocol}//www.${baseDomain}`,
  ].filter(Boolean) as string[]

  const commonPaths = [
    '/contact', '/contact/', '/contact-us', '/contact-us/',
    '/inquiry', '/inquiry/', '/inquire', '/inquire/',
    '/contactus', '/form', '/form/', '/forms',
    '/support', '/support/', '/help', '/request',
    '/consultation', '/ask', '/reach-us',
    '/otoiawase', '/toiawase', '/soudan',
    '/mail', '/mailform', '/mail-form',
    '/about/contact', '/company/contact', '/ir/contact',
    '/contents/contact', '/page/contact',
    '/contacts', '/contacts/',
  ]

  for (const base of candidates) {
    for (const path of commonPaths) {
      try {
        const r = await fetch(base + path, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3000) })
        if (r.ok) {
          console.log(`[form] HEAD hit: ${r.url || base + path}`)
          return { form_url: r.url || base + path, confidence: 'low' }
        }
      } catch { continue }
    }
  }

  return { form_url: null, confidence: 'none' }
}

// ─── メインエンドポイント ───
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    company,
    form_url: directFormUrl,
    hp_url: hpUrl,
    hojin_number: hojinNumber,
    address,
  } = body

  if (!company) return NextResponse.json({ company, status: 'error', message: 'company name is empty' })

  const cost = createCostTracker()

  // ─── Priority 1: フォームURL直指定（¥0.56/社 — Brave不要） ───
  if (directFormUrl && directFormUrl.trim()) {
    cost.estimated_yen = calcCost(cost)
    return NextResponse.json({
      company,
      status: 'success',
      site_url: hpUrl || directFormUrl,
      form_url: directFormUrl.trim(),
      confidence: 'direct',
      source: 'direct_url',
      mode: 'A',
      cost,
    })
  }

  // ─── Priority 2: HP URL指定 → HEAD巡回でフォーム発見（¥0.67/社 — Brave不要） ───
  if (hpUrl && hpUrl.trim()) {
    const siteUrl = hpUrl.trim()
    console.log(`[search] Mode B: HP URL provided -> ${siteUrl}`)

    const { form_url, confidence } = await findFormFromHpUrl(company, siteUrl, cost)
    if (form_url) {
      cost.estimated_yen = calcCost(cost)
      return NextResponse.json({
        company, status: 'success', site_url: siteUrl,
        form_url, confidence, source: 'hp_url',
        mode: 'B', cost,
      })
    }
    // HP URLでフォームが見つからない場合 → sender側のMode Bに委譲（Playwright巡回）
    // この場合、form_urlはnullのままsender側がhp_urlからフォームを発見する
    cost.estimated_yen = calcCost(cost)
    return NextResponse.json({
      company, status: 'success', site_url: siteUrl,
      form_url: null, hp_url: siteUrl,
      confidence: 'pending_crawl',
      source: 'hp_url',
      mode: 'B', cost,
      message: 'sender\u5074\u3067Playwright\u5de1\u56de\u304c\u5fc5\u8981',
    })
  }

  // ─── Priority 3: 会社名のみ → Brave Search（¥2.89/社） ───
  if (!BRAVE_API_KEY) return NextResponse.json({ company, status: 'error', message: 'BRAVE_API_KEY not set' })

  let hojinInfo: { name: string; address: string } | null = null
  if (hojinNumber && hojinNumber.trim()) {
    hojinInfo = await getCompanyByHojinNumber(hojinNumber.trim())
  }

  const hojinUsed = hojinInfo ? { name: hojinInfo.name, address: hojinInfo.address } : null

  const siteUrl = await getSiteUrl(company, address, cost, hojinInfo)
  if (!siteUrl) {
    cost.estimated_yen = calcCost(cost)
    return NextResponse.json({ company, status: 'not_found', message: 'site URL not found', hojin_used: hojinUsed, cost })
  }

  if (CONTACT_KEYWORDS.some(kw => siteUrl.toLowerCase().includes(kw))) {
    cost.estimated_yen = calcCost(cost)
    return NextResponse.json({
      company, status: 'success', site_url: siteUrl, form_url: siteUrl,
      confidence: 'high', source: 'search', mode: 'search',
      hojin_used: hojinUsed, cost,
    })
  }

  const { form_url, confidence } = await findContactForm(company, siteUrl, cost)
  cost.estimated_yen = calcCost(cost)
  if (form_url) {
    return NextResponse.json({
      company, status: 'success', site_url: siteUrl, form_url,
      confidence, source: 'search', mode: 'search',
      hojin_used: hojinUsed, cost,
    })
  }

  return NextResponse.json({
    company, status: 'not_found', site_url: siteUrl,
    message: 'form URL not found', hojin_used: hojinUsed, cost,
  })
}

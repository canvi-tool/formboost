'use client'
// /agent — AI営業社員ダッシュボード
// サービスプロフィール管理 + 企業マスタインポート + 日次ブリーフィング + Slack連携

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase'

type ServiceProfile = {
  id: string
  name: string
  service_description: string | null
  target_pain_points: string | null
  value_proposition: string | null
  differentiators: string | null
  case_study: string | null
  desired_cta: string | null
  sales_goal: string
  goal_url: string | null
  tone: string
  target_criteria: Record<string, unknown>
  daily_budget_yen: number
  daily_target_count: number
  is_active: boolean
}

type Briefing = {
  id: string
  briefing_date: string
  status: string
  summary_prev_day: string | null
  analysis: string | null
  improvements: string | null
  today_plan: string | null
  target_count: number
  estimated_cost: number
  actual_cost: number
  created_at: string
}

type CompaniesStats = {
  total: number
  with_form_url: number
  needs_discovery: number
}

const SALES_GOALS = [
  { value: 'online_appointment', label: 'オンラインアポ' },
  { value: 'free_signup', label: '無料会員登録' },
  { value: 'phone_appointment', label: '電話アポ' },
  { value: 'download_material', label: '資料DL' },
  { value: 'trial', label: '無料トライアル' },
  { value: 'purchase', label: '直接購入' },
  { value: 'other', label: 'その他' },
]

export default function AgentDashboard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'briefing' | 'service' | 'companies' | 'slack' | 'history'>('briefing')

  const [profiles, setProfiles] = useState<ServiceProfile[]>([])
  const [activeProfile, setActiveProfile] = useState<ServiceProfile | null>(null)
  const [companyStats, setCompanyStats] = useState<CompaniesStats>({ total: 0, with_form_url: 0, needs_discovery: 0 })
  const [todayBriefing, setTodayBriefing] = useState<Briefing | null>(null)
  const [briefingHistory, setBriefingHistory] = useState<Briefing[]>([])
  const [slackConnected, setSlackConnected] = useState<{ channel_id: string; channel_name: string } | null>(null)

  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [generating, setGenerating] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [message, setMessage] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  // 初期化
  useEffect(() => {
    const init = async () => {
      const sb = createBrowserClient()
      const { data: { session } } = await sb.auth.getSession()
      if (!session) {
        window.location.href = '/'
        return
      }
      setUserId(session.user.id)
      setLoading(false)
    }
    init()
  }, [])

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!userId) return null
    return fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId, ...(init?.headers || {}) },
    })
  }, [userId])

  const loadAll = useCallback(async () => {
    if (!userId) return
    const [pRes, sRes, bRes, wRes] = await Promise.all([
      authFetch('/api/service-profiles'),
      authFetch('/api/companies/search'),
      authFetch(`/api/briefings?limit=7`),
      authFetch('/api/slack/workspace'),
    ])
    if (pRes?.ok) {
      const { profiles: ps } = await pRes.json()
      setProfiles(ps || [])
      const active = (ps || []).find((p: ServiceProfile) => p.is_active) || ps?.[0] || null
      setActiveProfile(active)
    }
    if (sRes?.ok) setCompanyStats(await sRes.json())
    if (bRes?.ok) {
      const { briefings } = await bRes.json()
      setBriefingHistory(briefings || [])
      const today = new Date().toISOString().slice(0, 10)
      setTodayBriefing((briefings || []).find((b: Briefing) => b.briefing_date === today) || null)
    }
    if (wRes?.ok) {
      const { workspace } = await wRes.json()
      setSlackConnected(workspace || null)
    }
  }, [userId, authFetch])

  useEffect(() => {
    if (userId) loadAll()
  }, [userId, loadAll])

  // ─── CSVインポート（クライアント側パース + バッチPOST） ───
  const parseCSVLine = (line: string): string[] => {
    const r: string[] = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { inQ = !inQ; continue }
      if (c === ',' && !inQ) { r.push(cur); cur = ''; continue }
      cur += c
    }
    r.push(cur); return r
  }

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !userId) return
    setImporting(true)
    setMessage('')
    setImportProgress({ done: 0, total: 0 })

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 2) { setImporting(false); return }

      const header = parseCSVLine(lines[0])
      const col = (name: string) => header.findIndex(h => h.includes(name))
      const iName = col('会社名')
      const iIndustryMajor = col('大業界')
      const iIndustryMinor = col('小業界')
      const iBusiness = col('事業内容')
      const iEmp = col('従業員数')
      const iCapital = col('資本金')
      const iRevenue = col('売上高')
      const iZip = col('郵便番号')
      const iPref = col('都道府県')
      const iCity = col('市区町村')
      const iAddress = col('住所')
      const iFounded = col('設立')
      const iCeo = col('代表者')
      const iListing = col('上場')
      const iPhone = col('電話')
      const iEmails = col('メール')
      const iHp = col('url')
      const iForm = col('問い合わせ')
      const iHojin = col('法人番号')
      const iBranches = col('事業所数')
      const iDefunct = col('廃業')

      const rows = []
      for (let i = 1; i < lines.length; i++) {
        const c = parseCSVLine(lines[i])
        const hojin = c[iHojin]?.trim()
        const name = c[iName]?.trim()
        if (!hojin || !name) continue
        rows.push({
          hojin_number: hojin,
          company_name: name,
          industry_major: c[iIndustryMajor] || null,
          industry_minor: c[iIndustryMinor] || null,
          business_content: c[iBusiness] || null,
          employees: c[iEmp] ? Number(c[iEmp]) : null,
          capital: c[iCapital] ? Number(c[iCapital]) : null,
          revenue_range: c[iRevenue] || null,
          postal_code: c[iZip] || null,
          prefecture: c[iPref] || null,
          city: c[iCity] || null,
          address: c[iAddress] || null,
          founded_date: c[iFounded] || null,
          ceo_name: c[iCeo] || null,
          listing_status: c[iListing] || null,
          phone: c[iPhone] || null,
          emails: c[iEmails] || null,
          hp_url: c[iHp] || null,
          form_url: c[iForm] || null,
          branches_count: c[iBranches] ? Number(c[iBranches]) : null,
          defunct: c[iDefunct] === 'true',
        })
      }

      setImportProgress({ done: 0, total: rows.length })
      const batchSize = 1000
      let done = 0, inserted = 0
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        try {
          const res = await authFetch('/api/companies/import', { method: 'POST', body: JSON.stringify({ rows: batch }) })
          if (res?.ok) {
            const d = await res.json()
            inserted += d.inserted || 0
          }
        } catch (err) {
          console.error('batch error:', err)
        }
        done += batch.length
        setImportProgress({ done, total: rows.length })
      }

      setMessage(`✅ ${inserted}社をインポートしました`)
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
      await loadAll()
    }
    reader.readAsText(file, 'UTF-8')
  }

  // ─── サービスプロフィール保存 ───
  const saveProfile = async (p: Partial<ServiceProfile>) => {
    const isNew = !p.id
    const res = await authFetch('/api/service-profiles', {
      method: isNew ? 'POST' : 'PATCH',
      body: JSON.stringify(p),
    })
    if (res?.ok) {
      const { profile } = await res.json()
      setMessage(`✅ プロフィール「${profile.name}」を保存しました`)
      await loadAll()
    } else {
      setMessage('❌ 保存に失敗しました')
    }
  }

  // ─── 日次ブリーフィング生成 ───
  const generateBriefing = async () => {
    if (!activeProfile) { setMessage('❌ サービスプロフィールを先に作成してください'); return }
    setGenerating(true)
    setMessage('')
    const res = await authFetch('/api/briefings/generate', {
      method: 'POST',
      body: JSON.stringify({ service_profile_id: activeProfile.id }),
    })
    if (res?.ok) {
      const d = await res.json()
      setMessage(`✅ ブリーフィング生成完了: ${d.candidates_count}社 / ¥${d.estimated_cost}`)
      await loadAll()
    } else {
      const e = await res?.json()
      setMessage(`❌ ${e?.error || '生成失敗'}`)
    }
    setGenerating(false)
  }

  // ─── Slack通知送信 ───
  const notifySlack = async (briefingId: string) => {
    if (!slackConnected) { setMessage('❌ Slack連携を先に設定してください'); return }
    setNotifying(true)
    const res = await authFetch('/api/slack/notify', {
      method: 'POST',
      body: JSON.stringify({ briefing_id: briefingId }),
    })
    if (res?.ok) setMessage('✅ Slackに通知しました。承認をお待ちください。')
    else {
      const e = await res?.json()
      setMessage(`❌ ${e?.error || '通知失敗'}`)
    }
    setNotifying(false)
    await loadAll()
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono">
      {/* Header */}
      <header className="border-b border-green-900 p-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">🤖 FORMBOOST AI AGENT</h1>
          <p className="text-xs text-gray-500">v4.0 — 自律型BtoB営業社員</p>
        </div>
        <div className="flex gap-2 text-xs">
          <a href="/" className="px-3 py-1 border border-green-700 hover:bg-green-900/30">← キャンペーン画面</a>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-green-900 text-sm">
        {[
          { key: 'briefing', label: '☀️ 今日のブリーフィング' },
          { key: 'service', label: '🎯 サービス設定' },
          { key: 'companies', label: '🏢 企業マスタ' },
          { key: 'slack', label: '💬 Slack連携' },
          { key: 'history', label: '📊 履歴' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-3 ${tab === t.key ? 'border-b-2 border-green-400 text-green-300' : 'text-gray-500 hover:text-green-400'}`}
          >{t.label}</button>
        ))}
      </nav>

      {message && (
        <div className="mx-4 mt-4 p-3 border border-yellow-700 bg-yellow-900/20 text-yellow-300 text-sm">
          {message}
        </div>
      )}

      <main className="p-6 max-w-6xl mx-auto">
        {/* ─── Tab: Briefing ─── */}
        {tab === 'briefing' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 text-xs">
              <Stat label="企業マスタ" value={`${companyStats.total.toLocaleString()}社`} />
              <Stat label="フォームURL判明" value={`${companyStats.with_form_url.toLocaleString()}社`} />
              <Stat label="要探索" value={`${companyStats.needs_discovery.toLocaleString()}社`} />
              <Stat label="Slack" value={slackConnected ? '✅ 接続済' : '❌ 未接続'} />
            </div>

            <div className="border border-green-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg">☀️ 本日のAIブリーフィング</h2>
                <button
                  onClick={generateBriefing}
                  disabled={generating || !activeProfile}
                  className="px-4 py-2 bg-green-700 text-black hover:bg-green-600 disabled:opacity-50 text-xs"
                >{generating ? '⚙️ 生成中...' : '🤖 今日のプランを生成'}</button>
              </div>
              {!activeProfile && <p className="text-gray-500 text-sm">「サービス設定」タブでサービスプロフィールを作成してください。</p>}
              {todayBriefing ? (
                <div className="space-y-3 text-sm">
                  <Section title="📊 前日の結果">{todayBriefing.summary_prev_day}</Section>
                  <Section title="🔍 分析">{todayBriefing.analysis}</Section>
                  <Section title="💡 改善ポイント">{todayBriefing.improvements}</Section>
                  <Section title="🎯 本日の戦略">{todayBriefing.today_plan}</Section>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>ターゲット: {todayBriefing.target_count}社</span>
                    <span>見積: ¥{Number(todayBriefing.estimated_cost).toLocaleString()}</span>
                    <span>ステータス: {todayBriefing.status}</span>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-green-900">
                    <button
                      onClick={() => notifySlack(todayBriefing.id)}
                      disabled={notifying || todayBriefing.status !== 'draft' || !slackConnected}
                      className="px-4 py-2 bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-50 text-xs"
                    >{notifying ? '送信中...' : '📤 Slackに送って承認を求める'}</button>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm mt-3">本日のブリーフィングはまだ生成されていません。</p>
              )}
            </div>
          </div>
        )}

        {/* ─── Tab: Service ─── */}
        {tab === 'service' && (
          <ServiceProfileEditor activeProfile={activeProfile} profiles={profiles} onSave={saveProfile} />
        )}

        {/* ─── Tab: Companies ─── */}
        {tab === 'companies' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <Stat label="企業総数" value={`${companyStats.total.toLocaleString()}社`} />
              <Stat label="フォームURL判明" value={`${companyStats.with_form_url.toLocaleString()}社`} />
              <Stat label="要探索" value={`${companyStats.needs_discovery.toLocaleString()}社`} />
            </div>
            <div className="border border-green-900 p-4">
              <h2 className="text-lg mb-3">📂 企業マスタCSVインポート</h2>
              <p className="text-xs text-gray-500 mb-3">21カラムのCSV（会社名、法人番号、都道府県、事業内容等）をアップロードしてください。</p>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVImport}
                className="text-xs text-gray-400 file:mr-3 file:px-3 file:py-1 file:bg-green-700 file:text-black file:border-0 file:cursor-pointer" />
              {importing && (
                <div className="mt-3 text-xs">
                  <div>⚙️ インポート中: {importProgress.done.toLocaleString()} / {importProgress.total.toLocaleString()}</div>
                  <div className="w-full bg-gray-800 h-2 mt-1">
                    <div className="bg-green-500 h-2" style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Tab: Slack ─── */}
        {tab === 'slack' && <SlackSettings connected={slackConnected} authFetch={authFetch} onSaved={loadAll} setMessage={setMessage} />}

        {/* ─── Tab: History ─── */}
        {tab === 'history' && (
          <div className="space-y-2">
            <h2 className="text-lg mb-3">📊 過去のブリーフィング</h2>
            {briefingHistory.length === 0 && <p className="text-gray-500 text-sm">履歴はまだありません。</p>}
            {briefingHistory.map(b => (
              <div key={b.id} className="border border-green-900 p-3 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold">{b.briefing_date}</span>
                  <span className={b.status === 'completed' ? 'text-green-400' : 'text-gray-500'}>{b.status}</span>
                </div>
                <div className="text-gray-400 mt-1">{b.target_count}社 / 見積¥{Number(b.estimated_cost).toLocaleString()} / 実績¥{Number(b.actual_cost).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Stat Component ───
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-green-900 p-3">
      <div className="text-gray-500">{label}</div>
      <div className="text-lg text-green-300 mt-1">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{title}</div>
      <div className="text-sm text-green-300 whitespace-pre-wrap">{children || '-'}</div>
    </div>
  )
}

// ─── ServiceProfileEditor ───
function ServiceProfileEditor({
  activeProfile,
  profiles,
  onSave,
}: {
  activeProfile: ServiceProfile | null
  profiles: ServiceProfile[]
  onSave: (p: Partial<ServiceProfile>) => void
}) {
  const [form, setForm] = useState<Partial<ServiceProfile>>(activeProfile || {
    name: '',
    service_description: '',
    target_pain_points: '',
    value_proposition: '',
    differentiators: '',
    case_study: '',
    desired_cta: '',
    sales_goal: 'online_appointment',
    goal_url: '',
    tone: 'formal',
    daily_target_count: 50,
    daily_budget_yen: 1000,
    is_active: true,
  })

  useEffect(() => { if (activeProfile) setForm(activeProfile) }, [activeProfile])

  const set = <K extends keyof ServiceProfile>(k: K, v: ServiceProfile[K]) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-xs">
        {profiles.map(p => (
          <button key={p.id} onClick={() => setForm(p)} className={`px-3 py-1 border ${form.id === p.id ? 'border-green-400 text-green-300' : 'border-green-900 text-gray-500'}`}>{p.name}</button>
        ))}
        <button onClick={() => setForm({ name: '', sales_goal: 'online_appointment', tone: 'formal', daily_target_count: 50, daily_budget_yen: 1000, is_active: true })} className="px-3 py-1 border border-green-900 text-gray-500">+ 新規</button>
      </div>

      <div className="border border-green-900 p-4 space-y-3 text-sm">
        <Field label="サービス名 *"><input value={form.name || ''} onChange={e => set('name', e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="サービス概要"><textarea value={form.service_description || ''} onChange={e => set('service_description', e.target.value)} rows={2} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="顧客の課題（ペインポイント）"><textarea value={form.target_pain_points || ''} onChange={e => set('target_pain_points', e.target.value)} rows={2} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="提供価値"><textarea value={form.value_proposition || ''} onChange={e => set('value_proposition', e.target.value)} rows={2} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="差別化ポイント・競争優位性"><textarea value={form.differentiators || ''} onChange={e => set('differentiators', e.target.value)} rows={2} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="実績・数値エビデンス"><textarea value={form.case_study || ''} onChange={e => set('case_study', e.target.value)} rows={2} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="営業ゴール">
            <select value={form.sales_goal || 'online_appointment'} onChange={e => set('sales_goal', e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1">
              {SALES_GOALS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </Field>
          <Field label="ゴールURL（アポ予約等）"><input value={form.goal_url || ''} onChange={e => set('goal_url', e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
          <Field label="トーン">
            <select value={form.tone || 'formal'} onChange={e => set('tone', e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1">
              <option value="formal">フォーマル</option>
              <option value="semi-formal">セミフォーマル</option>
              <option value="casual">カジュアル</option>
            </select>
          </Field>
          <Field label="CTA（行動喚起）"><input value={form.desired_cta || ''} onChange={e => set('desired_cta', e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
          <Field label="1日のターゲット数"><input type="number" value={form.daily_target_count || 50} onChange={e => set('daily_target_count', Number(e.target.value))} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
          <Field label="1日の予算 (円)"><input type="number" value={form.daily_budget_yen || 1000} onChange={e => set('daily_budget_yen', Number(e.target.value))} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        </div>
        <button onClick={() => onSave(form)} disabled={!form.name} className="px-4 py-2 bg-green-700 text-black hover:bg-green-600 disabled:opacity-50 text-xs">💾 保存</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

// ─── SlackSettings ───
function SlackSettings({
  connected,
  authFetch,
  onSaved,
  setMessage,
}: {
  connected: { channel_id: string; channel_name: string } | null
  authFetch: (url: string, init?: RequestInit) => Promise<Response | null>
  onSaved: () => void
  setMessage: (m: string) => void
}) {
  const [botToken, setBotToken] = useState('')
  const [channelId, setChannelId] = useState('')
  const [channelName, setChannelName] = useState('')

  const save = async () => {
    const res = await authFetch('/api/slack/workspace', {
      method: 'POST',
      body: JSON.stringify({ bot_token: botToken, channel_id: channelId, channel_name: channelName }),
    })
    if (res?.ok) {
      setMessage('✅ Slack連携を設定しました')
      setBotToken('')
      onSaved()
    } else {
      const e = await res?.json()
      setMessage(`❌ ${e?.error || '設定失敗'}`)
    }
  }

  return (
    <div className="border border-green-900 p-4 space-y-3 text-sm">
      <h2 className="text-lg">💬 Slack連携設定</h2>
      {connected ? (
        <div className="text-xs text-green-300">
          ✅ 接続済み: {connected.channel_name || connected.channel_id}
        </div>
      ) : (
        <div className="text-xs text-gray-500">未接続</div>
      )}
      <div className="space-y-3">
        <Field label="Bot User OAuth Token (xoxb-...)"><input type="password" value={botToken} onChange={e => setBotToken(e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="チャンネルID (C0123...)"><input value={channelId} onChange={e => setChannelId(e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <Field label="チャンネル名 (表示用)"><input value={channelName} onChange={e => setChannelName(e.target.value)} className="w-full bg-black border border-green-900 px-2 py-1" /></Field>
        <button onClick={save} disabled={!botToken || !channelId} className="px-4 py-2 bg-green-700 text-black hover:bg-green-600 disabled:opacity-50 text-xs">💾 保存・接続テスト</button>
        <div className="text-xs text-gray-500 border-t border-green-900 pt-3 mt-3">
          <p>📘 セットアップ手順:</p>
          <ol className="list-decimal list-inside space-y-1 mt-1">
            <li>api.slack.com/apps で新規App作成</li>
            <li>OAuth &amp; Permissions で <code>chat:write</code> スコープ追加</li>
            <li>Interactivity &amp; Shortcuts を有効化し、Request URLに <code>https://formboost.vercel.app/api/slack/interactions</code> を設定</li>
            <li>Appをワークスペースにインストール → Bot User OAuth Tokenをコピー</li>
            <li>通知したいチャンネルでAppを招待 → チャンネルIDを取得</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

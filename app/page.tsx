'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase'
import { authFetch } from '@/lib/auth'
import type { Campaign, Target, SendStatus, ServiceProfile } from '@/lib/types'

type CompanyRecord = {
  company: string
  form_url?: string
  hp_url?: string
  hojin_number?: string
  address?: string
  custom_message?: string
}

type AuthState = {
  user: { id: string; email: string } | null
  loading: boolean
}

const STORAGE_KEY = 'formboost_sender'
const SERVICE_PROFILE_KEY = 'formboost_service_profile'

const DEFAULT_SERVICE_PROFILE: ServiceProfile = {
  service_name: '',
  service_description: '',
  target_pain_points: '',
  value_proposition: '',
  differentiators: '',
  case_study: '',
  desired_cta: 'ご面談のお時間をいただけましたら幸いです',
  tone: 'formal',
}

export default function Home() {
  // ── Auth ──
  const [auth, setAuth] = useState<AuthState>({ user: null, loading: true })
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const supabase = createBrowserClient()

  // ── Campaign ──
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null)
  const [targets, setTargets] = useState<Target[]>([])

  // ── Import ──
  const [companyRecords, setCompanyRecords] = useState<CompanyRecord[]>([])
  const [campaignName, setCampaignName] = useState('')

  // ── Sender ──
  const [senderCompany, setSenderCompany] = useState('株式会社Canvi')
  const [senderName, setSenderName] = useState('岡林優治')
  const [senderEmail, setSenderEmail] = useState('yuji.okabayashi@canvi.co.jp')
  const [senderPhone, setSenderPhone] = useState('03-6271-4900')
  const [template, setTemplate] = useState('')

  // ── AI Message Generation ──
  const [useAi, setUseAi] = useState(false)
  const [serviceProfile, setServiceProfile] = useState<ServiceProfile>(DEFAULT_SERVICE_PROFILE)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 })
  const [aiPreview, setAiPreview] = useState('')
  const [showServiceForm, setShowServiceForm] = useState(true)
  const [selectedCompanyIdx, setSelectedCompanyIdx] = useState<number | null>(null)

  // ── UI State ──
  const [activeTab, setActiveTab] = useState<'campaigns' | 'import' | 'detail'>('campaigns')
  const [loading, setLoading] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  // ── Auth Effects ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth({ user: session?.user ? { id: session.user.id, email: session.user.email || '' } : null, loading: false })
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth({ user: session?.user ? { id: session.user.id, email: session.user.email || '' } : null, loading: false })
    })
    return () => subscription.unsubscribe()
  }, [supabase.auth])

  // ── Load sender from localStorage ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const d = JSON.parse(saved)
        if (d.senderCompany) setSenderCompany(d.senderCompany)
        if (d.senderName) setSenderName(d.senderName)
        if (d.senderEmail) setSenderEmail(d.senderEmail)
        if (d.senderPhone) setSenderPhone(d.senderPhone)
        if (d.template !== undefined) setTemplate(d.template)
      }
    } catch { /* ignore */ }
    try {
      const savedProfile = localStorage.getItem(SERVICE_PROFILE_KEY)
      if (savedProfile) {
        const p = JSON.parse(savedProfile)
        setServiceProfile(prev => ({ ...prev, ...p }))
        if (p.service_name) setUseAi(true)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ senderCompany, senderName, senderEmail, senderPhone, template }))
    } catch { /* ignore */ }
  }, [senderCompany, senderName, senderEmail, senderPhone, template])

  useEffect(() => {
    try {
      localStorage.setItem(SERVICE_PROFILE_KEY, JSON.stringify(serviceProfile))
    } catch { /* ignore */ }
  }, [serviceProfile])

  // ── Load campaigns ──
  const loadCampaigns = useCallback(async () => {
    if (!auth.user) return
    try {
      const res = await authFetch('/api/campaigns')
      const data = await res.json()
      setCampaigns(data.campaigns || [])
    } catch (e) {
      console.error('Failed to load campaigns:', e)
    }
  }, [auth.user])

  useEffect(() => {
    if (auth.user) loadCampaigns()
  }, [auth.user, loadCampaigns])

  // ── Realtime subscription ──
  useEffect(() => {
    if (!activeCampaign) return
    const channel = supabase
      .channel(`targets-${activeCampaign.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'targets', filter: `campaign_id=eq.${activeCampaign.id}` }, (payload) => {
        setTargets(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } as Target : t))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${activeCampaign.id}` }, (payload) => {
        setActiveCampaign(prev => prev ? { ...prev, ...payload.new } as Campaign : null)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [activeCampaign, supabase])

  // ── Auth handlers ──
  const handleLogin = async () => {
    setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) setAuthError(error.message)
  }

  const handleSignup = async () => {
    setAuthError('')
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
    if (error) setAuthError(error.message)
    else setAuthError('確認メールを送信しました')
  }

  // ── CSV Import ──
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []; let current = ''; let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') inQuote = !inQuote
      else if (ch === ',' && !inQuote) { result.push(current.trim()); current = '' }
      else current += ch
    }
    result.push(current.trim()); return result
  }

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      if (!lines.length) return
      const cols = lines[0].split(',').map(c => c.replace(/"/g, '').trim())
      const idxC = cols.findIndex(c => c.includes('会社名'))
      const idxF = cols.findIndex(c => c.includes('お問い合わせフォーム') || c.includes('フォームURL'))
      const idxH = cols.findIndex(c => c === 'HP' || c.includes('HP URL') || c.includes('ホームページ') || c === 'URL' || c.includes('公式サイト'))
      const idxJ = cols.findIndex(c => c.includes('法人番号'))
      const idxP = cols.findIndex(c => c.includes('都道府県'))
      const idxCity = cols.findIndex(c => c.includes('市区町村'))

      if (idxC >= 0) {
        const records: CompanyRecord[] = []; const seen = new Set<string>()
        for (let i = 1; i < lines.length; i++) {
          const row = parseCSVLine(lines[i]); const co = row[idxC] || ''
          if (!co || seen.has(co)) continue; seen.add(co)
          records.push({ company: co, form_url: idxF >= 0 ? (row[idxF] || '') : '', hp_url: idxH >= 0 ? (row[idxH] || '') : '', hojin_number: idxJ >= 0 ? (row[idxJ] || '') : '', address: ((idxP >= 0 ? row[idxP] : '') + (idxCity >= 0 ? row[idxCity] : '')) || '' })
        }
        setCompanyRecords(records)
        if (!campaignName) setCampaignName(file.name.replace('.csv', ''))
      }
    }
    reader.readAsText(file, 'UTF-8'); e.target.value = ''
  }

  // ── AI Message Generation ──
  const generateMessage = async (company: CompanyRecord): Promise<string> => {
    const res = await authFetch('/api/generate-message', {
      method: 'POST',
      body: JSON.stringify({
        service_profile: serviceProfile,
        company: { name: company.company, hp_url: company.hp_url, address: company.address },
        sender: { company: senderCompany, name: senderName, email: senderEmail, phone: senderPhone },
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'AI生成エラー')
    return data.message
  }

  const generatePreview = async () => {
    if (!companyRecords.length || !serviceProfile.service_name) return
    setAiGenerating(true)
    try {
      const target = companyRecords[selectedCompanyIdx ?? 0]
      const msg = await generateMessage(target)
      setAiPreview(msg)
      setCompanyRecords(prev => prev.map((r, i) => i === (selectedCompanyIdx ?? 0) ? { ...r, custom_message: msg } : r))
    } catch (e) {
      console.error('AI generate error:', e)
      setAiPreview('エラー: ' + (e instanceof Error ? e.message : '不明'))
    }
    setAiGenerating(false)
  }

  const generateAll = async () => {
    if (!companyRecords.length || !serviceProfile.service_name) return
    setAiGenerating(true)
    setAiProgress({ done: 0, total: companyRecords.length })
    const updated = [...companyRecords]
    for (let i = 0; i < updated.length; i++) {
      try {
        const msg = await generateMessage(updated[i])
        updated[i] = { ...updated[i], custom_message: msg }
        setAiProgress({ done: i + 1, total: updated.length })
        setCompanyRecords([...updated])
      } catch (e) {
        console.error(`AI generate error for ${updated[i].company}:`, e)
        updated[i] = { ...updated[i], custom_message: '' }
      }
    }
    setAiGenerating(false)
  }

  // ── Create Campaign ──
  const createCampaign = async () => {
    if (!companyRecords.length || !campaignName) return
    setLoading(true)
    try {
      const targetsPayload = companyRecords.map(r => ({
        ...r,
        custom_message: useAi ? (r.custom_message || '') : '',
      }))
      const res = await authFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campaignName,
          targets: targetsPayload,
          sender: { company: senderCompany, name: senderName, email: senderEmail, phone: senderPhone, message: template },
        }),
      })
      const data = await res.json()
      if (data.campaign) {
        await loadCampaigns()
        setCompanyRecords([])
        setCampaignName('')
        setAiPreview('')
        setActiveTab('campaigns')
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // ── Open Campaign Detail ──
  const openCampaign = async (c: Campaign) => {
    setActiveCampaign(c)
    setActiveTab('detail')
    try {
      const res = await authFetch(`/api/campaigns/${c.id}?limit=500`)
      const data = await res.json()
      setTargets(data.targets || [])
    } catch (e) { console.error(e) }
  }

  // ── Start Sending ──
  const startSending = async () => {
    if (!activeCampaign) return
    setLoading(true)
    try {
      await authFetch('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ campaign_id: activeCampaign.id }),
      })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // ── Stats ──
  const statusColor = (s: SendStatus) => {
    const map: Record<string, string> = { pending: 'text-gray-500', queued: 'text-yellow-400', sending: 'text-yellow-400', success: 'text-[#00ff88]', failed: 'text-red-400', skipped: 'text-gray-500', captcha: 'text-orange-400' }
    return map[s] || 'text-gray-500'
  }
  const statusIcon = (s: SendStatus) => {
    const map: Record<string, string> = { pending: '\u25cb', queued: '\u27f3', sending: '\u27f3', success: '\u2713', failed: '\u2717', skipped: '\u2014', captcha: '\u26a0' }
    return map[s] || '\u25cb'
  }

  const withFormUrl = companyRecords.filter(r => r.form_url).length
  const withHpUrl = companyRecords.filter(r => r.hp_url && !r.form_url).length
  const searchOnly = companyRecords.length > 0 ? companyRecords.length - withFormUrl - withHpUrl : 0
  const estimatedCost = withFormUrl * 0.56 + withHpUrl * 0.67 + searchOnly * 2.89
  const aiGenerated = companyRecords.filter(r => r.custom_message).length

  const senderFields = [
    { label: '会社名', value: senderCompany, set: setSenderCompany },
    { label: '担当者名', value: senderName, set: setSenderName },
    { label: 'メール', value: senderEmail, set: setSenderEmail },
    { label: '電話番号', value: senderPhone, set: setSenderPhone },
  ] as const

  const updateProfile = (key: keyof ServiceProfile, val: string) => {
    setServiceProfile(prev => ({ ...prev, [key]: val }))
  }

  // ── Auth Screen ──
  if (auth.loading) return <main className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center font-mono"><div className="text-gray-500 text-xs">{'Loading...'}</div></main>

  if (!auth.user) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center font-mono text-sm">
        <div className="w-80 border border-[#1a1a2e] p-6">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-[#00ff88] font-bold">FB</span>
            <span className="font-bold tracking-widest">FORMBOOST</span>
            <span className="text-gray-600 text-xs">v3.0</span>
          </div>
          <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="メールアドレス" className="w-full bg-transparent border border-[#1a1a2e] text-white text-xs p-2 mb-3 outline-none focus:border-[#00ff88] placeholder-gray-700" />
          <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="パスワード" className="w-full bg-transparent border border-[#1a1a2e] text-white text-xs p-2 mb-3 outline-none focus:border-[#00ff88] placeholder-gray-700" onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          {authError && <div className="text-xs text-red-400 mb-3">{authError}</div>}
          <div className="flex gap-2">
            <button onClick={handleLogin} className="flex-1 py-2 bg-[#00ff88] text-black font-bold text-xs hover:bg-[#00cc70]">{'ログイン'}</button>
            <button onClick={handleSignup} className="flex-1 py-2 border border-[#1a1a2e] text-gray-400 text-xs hover:text-white hover:border-white">{'新規登録'}</button>
          </div>
        </div>
      </main>
    )
  }

  // ── Main Dashboard ──
  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white font-mono text-sm">
      {/* Header */}
      <div className="border-b border-[#1a1a2e] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#00ff88] font-bold text-xs">FB</span>
          <span className="text-white font-bold tracking-widest text-xs">FORMBOOST</span>
          <span className="text-gray-600 text-xs">{'v3.0 — AIフォーム営業自動化'}</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/agent" className="text-xs text-[#00ff88] hover:text-white border border-[#00ff88] px-3 py-1">{'🤖 AI Agent'}</a>
          <span className="text-xs text-gray-500">{auth.user.email}</span>
          <button onClick={() => supabase.auth.signOut()} className="text-xs text-gray-500 hover:text-white border border-[#1a1a2e] px-3 py-1">{'ログアウト'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#1a1a2e] flex">
        {([
          { key: 'campaigns' as const, label: 'キャンペーン一覧' },
          { key: 'import' as const, label: 'CSVインポート' },
          ...(activeCampaign ? [{ key: 'detail' as const, label: `${activeCampaign.name}` }] : []),
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={'px-4 py-2 text-xs border-b-2 transition-colors ' + (activeTab === tab.key ? 'border-[#00ff88] text-[#00ff88]' : 'border-transparent text-gray-500 hover:text-gray-300')}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="h-[calc(100vh-88px)] overflow-y-auto">

        {/* ===== Campaigns List ===== */}
        {activeTab === 'campaigns' && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-gray-600">{'// キャンペーン一覧'}</span>
              <button onClick={() => setActiveTab('import')} className="text-xs text-[#00ff88] border border-[#00ff88] px-3 py-1 hover:bg-[#00ff88] hover:text-black">{'+ 新規キャンペーン'}</button>
            </div>
            {campaigns.length === 0 ? (
              <div className="text-center text-gray-600 text-xs py-12">{'キャンペーンがありません。CSVをインポートして作成してください。'}</div>
            ) : (
              <div className="space-y-2">
                {campaigns.map(c => (
                  <button key={c.id} onClick={() => openCampaign(c)} className="w-full text-left border border-[#1a1a2e] hover:border-[#00ff88]/50 p-4 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-white font-bold">{c.name}</div>
                        <div className="text-xs text-gray-500 mt-1">{c.total_targets}{'社 / '}{'作成: '}{new Date(c.created_at).toLocaleDateString('ja-JP')}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-xs text-[#00ff88]">{c.success_count}{'成功'}</div>
                          <div className="text-xs text-gray-500">{c.sent_count}/{c.total_targets}{'送信'}</div>
                        </div>
                        <span className={'text-xs px-2 py-1 ' + (c.status === 'done' ? 'bg-[#00ff88]/10 text-[#00ff88]' : c.status === 'sending' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-gray-500/10 text-gray-400')}>
                          {c.status === 'done' ? '完了' : c.status === 'sending' ? '送信中' : c.status === 'ready' ? '準備完了' : c.status}
                        </span>
                      </div>
                    </div>
                    {c.actual_cost > 0 && (
                      <div className="text-xs text-yellow-600 mt-2">{'実コスト: ¥'}{c.actual_cost.toFixed(0)}{' / 見積: ¥'}{c.estimated_cost.toFixed(0)}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== CSV Import ===== */}
        {activeTab === 'import' && (
          <div className="flex h-full">
            <div className="w-[420px] border-r border-[#1a1a2e] flex flex-col p-4 overflow-y-auto">
              <div className="text-xs text-gray-600 mb-3">{'// CSVインポート'}</div>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} className="hidden" />
              <button onClick={() => fileRef.current?.click()} className="w-full py-3 border border-dashed border-[#1a1a2e] hover:border-[#00ff88] text-gray-500 hover:text-[#00ff88] text-xs mb-4 transition-colors">
                {'CSVファイルを選択（会社名 / HP URL / フォームURL列対応）'}
              </button>

              {companyRecords.length > 0 && (
                <>
                  <div className="text-xs text-white font-bold mb-2">{companyRecords.length}{'社読み込み済'}</div>
                  <div className="flex gap-2 flex-wrap mb-3">
                    {withFormUrl > 0 && <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-1">{'A: '}{withFormUrl}{'社 ¥'}{(withFormUrl * 0.56).toFixed(0)}</span>}
                    {withHpUrl > 0 && <span className="text-xs bg-cyan-500/10 text-cyan-400 px-2 py-1">{'B: '}{withHpUrl}{'社 ¥'}{(withHpUrl * 0.67).toFixed(0)}</span>}
                    {searchOnly > 0 && <span className="text-xs bg-yellow-500/10 text-yellow-500 px-2 py-1">{'検索: '}{searchOnly}{'社 ¥'}{(searchOnly * 2.89).toFixed(0)}</span>}
                  </div>
                  <div className="text-xs text-gray-600 mb-4">{'推定総額: ¥'}{estimatedCost.toFixed(0)}</div>

                  <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="キャンペーン名" className="w-full bg-transparent border border-[#1a1a2e] text-white text-xs p-2 mb-3 outline-none focus:border-[#00ff88] placeholder-gray-700" />

                  <div className="text-xs text-gray-600 mb-2">{'// 送信者情報'}</div>
                  {senderFields.map(({ label, value, set }) => (
                    <div key={label} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 w-16 shrink-0">{label}</span>
                      <input type="text" value={value} onChange={e => (set as (v: string) => void)(e.target.value)} className="flex-1 bg-transparent border border-[#1a1a2e] text-white text-xs p-1.5 outline-none focus:border-[#00ff88]" />
                    </div>
                  ))}

                  {/* ── AI Toggle ── */}
                  <div className="flex items-center gap-3 mt-4 mb-3 border-t border-[#1a1a2e] pt-4">
                    <button
                      onClick={() => setUseAi(!useAi)}
                      className={'text-xs px-3 py-1.5 font-bold transition-all ' + (useAi ? 'bg-purple-600 text-white' : 'border border-[#1a1a2e] text-gray-500 hover:text-purple-400 hover:border-purple-400')}
                    >
                      {'AI'} {useAi ? 'ON' : 'OFF'}
                    </button>
                    <span className="text-xs text-gray-500">{'AIがメッセージを企業ごとに自動生成'}</span>
                  </div>

                  {/* ── Manual Template (when AI is off) ── */}
                  {!useAi && (
                    <>
                      <div className="text-xs text-gray-600 mb-1">{'メッセージテンプレート'}</div>
                      <textarea value={template} onChange={e => setTemplate(e.target.value)} className="w-full bg-transparent border border-[#1a1a2e] text-white text-xs p-2 resize-none outline-none h-32 focus:border-[#00ff88] placeholder-gray-700" placeholder="全社共通の送信メッセージ..." />
                    </>
                  )}

                  {/* ── AI Service Profile (when AI is on) ── */}
                  {useAi && (
                    <div className="border border-purple-500/30 bg-purple-500/5 p-3 mb-3">
                      <button onClick={() => setShowServiceForm(!showServiceForm)} className="flex items-center justify-between w-full text-xs text-purple-400 font-bold mb-2">
                        <span>{'// サービス情報（AI生成用）'}</span>
                        <span>{showServiceForm ? '▲' : '▼'}</span>
                      </button>

                      {showServiceForm && (
                        <div className="space-y-2">
                          {([
                            { key: 'service_name' as const, label: 'サービス名', placeholder: '例: FormBoost', type: 'input' },
                            { key: 'service_description' as const, label: 'サービス概要', placeholder: '何をするサービスか（1-2文で）', type: 'textarea' },
                            { key: 'target_pain_points' as const, label: '顧客の課題', placeholder: 'ターゲット企業が抱える課題・ペイン', type: 'textarea' },
                            { key: 'value_proposition' as const, label: '提供価値', placeholder: 'このサービスで得られる具体的な成果', type: 'textarea' },
                            { key: 'differentiators' as const, label: '差別化ポイント', placeholder: '競合との違い・独自の強み', type: 'textarea' },
                            { key: 'case_study' as const, label: '実績・数値', placeholder: '例: 導入企業200社、問い合わせ3倍増', type: 'input' },
                            { key: 'desired_cta' as const, label: 'CTA', placeholder: 'ご面談のお時間をいただけましたら幸いです', type: 'input' },
                          ] as const).map(({ key, label, placeholder, type }) => (
                            <div key={key}>
                              <div className="text-xs text-gray-500 mb-1">{label}</div>
                              {type === 'input' ? (
                                <input
                                  type="text"
                                  value={serviceProfile[key]}
                                  onChange={e => updateProfile(key, e.target.value)}
                                  placeholder={placeholder}
                                  className="w-full bg-transparent border border-purple-500/20 text-white text-xs p-1.5 outline-none focus:border-purple-400 placeholder-gray-700"
                                />
                              ) : (
                                <textarea
                                  value={serviceProfile[key]}
                                  onChange={e => updateProfile(key, e.target.value)}
                                  placeholder={placeholder}
                                  className="w-full bg-transparent border border-purple-500/20 text-white text-xs p-1.5 resize-none outline-none h-14 focus:border-purple-400 placeholder-gray-700"
                                />
                              )}
                            </div>
                          ))}

                          <div>
                            <div className="text-xs text-gray-500 mb-1">{'トーン'}</div>
                            <div className="flex gap-2">
                              {([
                                { v: 'formal' as const, l: 'フォーマル' },
                                { v: 'semi-formal' as const, l: 'やや柔らかめ' },
                                { v: 'casual' as const, l: 'カジュアル' },
                              ]).map(({ v, l }) => (
                                <button key={v} onClick={() => updateProfile('tone', v)} className={'text-xs px-2 py-1 transition-colors ' + (serviceProfile.tone === v ? 'bg-purple-600 text-white' : 'border border-purple-500/20 text-gray-500 hover:text-purple-400')}>
                                  {l}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* AI Actions */}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={generatePreview}
                          disabled={aiGenerating || !serviceProfile.service_name}
                          className="flex-1 py-1.5 text-xs font-bold bg-purple-600 text-white disabled:opacity-40 hover:bg-purple-500"
                        >
                          {aiGenerating ? '生成中...' : 'プレビュー生成'}
                        </button>
                        <button
                          onClick={generateAll}
                          disabled={aiGenerating || !serviceProfile.service_name}
                          className="flex-1 py-1.5 text-xs font-bold border border-purple-500 text-purple-400 disabled:opacity-40 hover:bg-purple-500/10"
                        >
                          {aiGenerating ? `${aiProgress.done}/${aiProgress.total}` : `全${companyRecords.length}社生成`}
                        </button>
                      </div>

                      {/* AI Stats */}
                      {aiGenerated > 0 && (
                        <div className="text-xs text-purple-400 mt-2">
                          {'AI生成済: '}{aiGenerated}{'/'}{companyRecords.length}{'社'}
                        </div>
                      )}

                      {/* AI Preview */}
                      {aiPreview && (
                        <div className="mt-3 border-t border-purple-500/20 pt-3">
                          <div className="text-xs text-gray-500 mb-1">{'// プレビュー: '}{companyRecords[selectedCompanyIdx ?? 0]?.company}</div>
                          <div className="text-xs text-white whitespace-pre-wrap bg-[#0a0a15] border border-[#1a1a2e] p-2 max-h-48 overflow-y-auto">
                            {aiPreview}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button onClick={createCampaign} disabled={loading || !campaignName} className="w-full py-2 mt-3 bg-[#00ff88] text-black font-bold text-xs disabled:opacity-40 hover:bg-[#00cc70]">
                    {loading ? '作成中...' : `▶ キャンペーン作成 (${companyRecords.length}社${useAi && aiGenerated > 0 ? ` / AI ${aiGenerated}件` : ''})`}
                  </button>
                </>
              )}
            </div>

            {/* Right Panel: Company Preview */}
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="text-xs text-gray-600 mb-2">{'// プレビュー'}{useAi && aiGenerated > 0 ? ` (AI生成済: ${aiGenerated}社)` : ''}</div>
              {companyRecords.slice(0, 100).map((r, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setSelectedCompanyIdx(i)
                    if (r.custom_message) setAiPreview(r.custom_message)
                  }}
                  className={'border-b border-[#1a1a2e] px-3 py-2 flex items-center gap-3 text-xs cursor-pointer transition-colors ' + (selectedCompanyIdx === i ? 'bg-purple-500/10' : 'hover:bg-[#1a1a2e]/50')}
                >
                  <span className="text-gray-500 w-8">{i + 1}</span>
                  <span className="text-white w-44 truncate">{r.company}</span>
                  <span className={'flex-1 truncate ' + (r.form_url ? 'text-blue-400' : r.hp_url ? 'text-cyan-400' : 'text-gray-600')}>
                    {r.form_url || r.hp_url || '検索が必要'}
                  </span>
                  <span className={'shrink-0 w-6 ' + (r.form_url ? 'text-blue-400' : r.hp_url ? 'text-cyan-400' : 'text-yellow-500')}>
                    {r.form_url ? 'A' : r.hp_url ? 'B' : 'S'}
                  </span>
                  {r.custom_message && (
                    <span className="text-purple-400 shrink-0">{'AI'}</span>
                  )}
                </div>
              ))}
              {companyRecords.length > 100 && <div className="text-xs text-gray-600 py-2 text-center">{'...他 '}{companyRecords.length - 100}{'社'}</div>}
            </div>
          </div>
        )}

        {/* ===== Campaign Detail ===== */}
        {activeTab === 'detail' && activeCampaign && (
          <div className="flex h-full">
            <div className="w-72 border-r border-[#1a1a2e] p-4 flex flex-col">
              <div className="text-xs text-gray-600 mb-3">{'// キャンペーン情報'}</div>
              <div className="text-xs text-white font-bold mb-4">{activeCampaign.name}</div>

              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-xs"><span className="text-gray-500">{'総対象'}</span><span className="text-white">{activeCampaign.total_targets}{'社'}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">{'送信済'}</span><span className="text-white">{activeCampaign.sent_count}</span></div>
                <div className="flex justify-between text-xs"><span className="text-[#00ff88]">{'成功'}</span><span className="text-[#00ff88]">{activeCampaign.success_count}</span></div>
                <div className="flex justify-between text-xs"><span className="text-red-400">{'失敗'}</span><span className="text-red-400">{activeCampaign.failed_count}</span></div>
                <div className="flex justify-between text-xs"><span className="text-gray-500">{'スキップ'}</span><span className="text-gray-400">{activeCampaign.skipped_count}</span></div>
              </div>

              {activeCampaign.total_targets > 0 && (
                <div className="mb-4">
                  <div className="h-1.5 bg-[#1a1a2e] rounded overflow-hidden">
                    <div className="h-full bg-[#00ff88] transition-all duration-500" style={{ width: `${(activeCampaign.sent_count / activeCampaign.total_targets) * 100}%` }} />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{Math.round((activeCampaign.sent_count / activeCampaign.total_targets) * 100)}{'%'}</div>
                </div>
              )}

              <div className="flex justify-between text-xs mb-4">
                <span className="text-gray-500">{'コスト'}</span>
                <span className="text-yellow-500">{'¥'}{activeCampaign.actual_cost.toFixed(0)}{' / ¥'}{activeCampaign.estimated_cost.toFixed(0)}</span>
              </div>

              <div className="mt-auto space-y-2">
                {activeCampaign.status !== 'sending' && (
                  <button onClick={startSending} disabled={loading} className="w-full py-2 bg-[#00ff88] text-black font-bold text-xs disabled:opacity-40 hover:bg-[#00cc70]">
                    {loading ? '処理中...' : '▶ 送信開始'}
                  </button>
                )}
                {activeCampaign.status === 'sending' && (
                  <div className="text-xs text-yellow-400 text-center py-2">{'送信中... リアルタイム更新中'}</div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-2 border-b border-[#1a1a2e] text-xs text-gray-600">{'// 送信対象 ('}{targets.length}{'件)'}</div>
              {targets.map(t => (
                <div key={t.id} className="border-b border-[#1a1a2e] px-4 py-2 flex items-center gap-3">
                  <span className={`text-xs w-4 shrink-0 ${statusColor(t.send_status)}`}>{statusIcon(t.send_status)}</span>
                  <span className="text-xs text-white w-44 truncate shrink-0">{t.company}</span>
                  <span className="text-xs text-gray-400 flex-1 truncate">{t.form_url || t.hp_url || t.site_url || ''}</span>
                  <span className={'text-xs shrink-0 ' + (t.search_source === 'direct_url' ? 'text-blue-400' : t.search_source === 'hp_url' ? 'text-cyan-400' : 'text-gray-600')}>
                    {t.search_mode === 'A' ? 'A' : t.search_mode === 'B' ? 'B' : t.search_source || ''}
                  </span>
                  {t.custom_message && <span className="text-xs text-purple-400 shrink-0">{'AI'}</span>}
                  {t.send_status === 'success' && (
                    <span className="text-xs text-[#00ff88] shrink-0">{t.complete_detected ? '完了確認済' : '送信済'}</span>
                  )}
                  {t.send_status === 'failed' && (
                    <span className="text-xs text-red-400 shrink-0 truncate max-w-48">{t.send_error || '失敗'}</span>
                  )}
                  {t.send_status === 'captcha' && (
                    <span className="text-xs text-orange-400 shrink-0">CAPTCHA</span>
                  )}
                  {t.elapsed_ms && (
                    <span className="text-xs text-gray-600 shrink-0">{(t.elapsed_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}

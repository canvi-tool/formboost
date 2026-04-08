// /agent/tenants — テナント・プラン・メンバー・プロジェクト管理UI
'use client'
import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase'

type Tenant = {
  id: string
  name: string
  plan: 'standard' | 'pro' | 'god' | 'enterprise'
  plus: boolean
  max_projects: number
  role: 'owner' | 'admin' | 'member'
}
type Member = { user_id: string; role: string; joined_at: string | null }
type Project = { id: string; name: string; created_at: string }

const PLAN_LABEL: Record<string, string> = {
  standard: 'AI社畜くん',
  pro: 'AI社畜くん PRO',
  god: 'AI社畜くん GOD',
  enterprise: 'Enterprise',
}
const PLAN_COLOR: Record<string, string> = {
  standard: 'bg-slate-100 text-slate-700 border-slate-300',
  pro: 'bg-lime-100 text-lime-800 border-lime-300',
  god: 'bg-amber-100 text-amber-800 border-amber-300',
  enterprise: 'bg-violet-100 text-violet-800 border-violet-300',
}

export default function TenantsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [activeTenant, setActiveTenant] = useState<Tenant | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [msg, setMsg] = useState<string>('')
  const [newTenantName, setNewTenantName] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [inviteUserId, setInviteUserId] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')

  // ユーザー取得
  useEffect(() => {
    ;(async () => {
      const sb = createBrowserClient()
      const { data: { user } } = await sb.auth.getUser()
      if (user) setUserId(user.id)
    })()
  }, [])

  const loadTenants = useCallback(async () => {
    if (!userId) return
    const res = await fetch(`/api/tenants?user_id=${userId}`)
    const data = await res.json()
    setTenants(data.tenants || [])
    if (data.tenants?.[0] && !activeTenant) setActiveTenant(data.tenants[0])
  }, [userId, activeTenant])

  useEffect(() => { loadTenants() }, [loadTenants])

  const loadDetail = useCallback(async () => {
    if (!activeTenant) return
    const [mRes, pRes] = await Promise.all([
      fetch(`/api/tenants/members?tenant_id=${activeTenant.id}`),
      fetch(`/api/projects?tenant_id=${activeTenant.id}`),
    ])
    const m = await mRes.json()
    const p = await pRes.json()
    setMembers(m.members || [])
    setProjects(p.projects || [])
  }, [activeTenant])

  useEffect(() => { loadDetail() }, [loadDetail])

  const createTenant = async () => {
    if (!userId || !newTenantName.trim()) return
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, name: newTenantName.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setMsg('✅ テナントを作成しました')
      setNewTenantName('')
      loadTenants()
    } else {
      setMsg(`❌ ${data.error}`)
    }
  }

  const changePlan = async (plan: Tenant['plan'], plus: boolean) => {
    if (!userId || !activeTenant) return
    const res = await fetch('/api/tenants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, tenant_id: activeTenant.id, plan, plus }),
    })
    const data = await res.json()
    if (res.ok) {
      setMsg(`✅ ${PLAN_LABEL[plan]}${plus ? ' + Plus' : ''} に変更`)
      setActiveTenant(data.tenant ? { ...data.tenant, role: activeTenant.role } : activeTenant)
      loadTenants()
    } else setMsg(`❌ ${data.error}`)
  }

  const createProject = async () => {
    if (!userId || !activeTenant || !newProjectName.trim()) return
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, tenant_id: activeTenant.id, name: newProjectName.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setMsg('✅ プロジェクト作成')
      setNewProjectName('')
      loadDetail()
    } else if (res.status === 402) {
      setMsg(`⚠️ ${data.error} — ${data.upgrade}`)
    } else {
      setMsg(`❌ ${data.error}`)
    }
  }

  const invite = async () => {
    if (!userId || !activeTenant || !inviteUserId.trim()) return
    const res = await fetch('/api/tenants/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor_user_id: userId,
        tenant_id: activeTenant.id,
        user_id: inviteUserId.trim(),
        role: inviteRole,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setMsg('✅ 招待完了')
      setInviteUserId('')
      loadDetail()
    } else setMsg(`❌ ${data.error}`)
  }

  const changeRole = async (target_user_id: string, role: string) => {
    if (!userId || !activeTenant) return
    const res = await fetch('/api/tenants/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_user_id: userId, tenant_id: activeTenant.id, user_id: target_user_id, role }),
    })
    if (res.ok) { setMsg('✅ ロール変更'); loadDetail() }
    else { const d = await res.json(); setMsg(`❌ ${d.error}`) }
  }

  const removeMember = async (target_user_id: string) => {
    if (!userId || !activeTenant) return
    const res = await fetch('/api/tenants/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_user_id: userId, tenant_id: activeTenant.id, user_id: target_user_id }),
    })
    if (res.ok) { setMsg('✅ 除名'); loadDetail() }
    else { const d = await res.json(); setMsg(`❌ ${d.error}`) }
  }

  const canManage = activeTenant && ['owner', 'admin'].includes(activeTenant.role)
  const isOwner = activeTenant?.role === 'owner'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center text-xl">🏢</div>
          <div>
            <div className="text-lg font-bold text-slate-900">テナント管理</div>
            <div className="text-xs text-slate-500">組織・プラン・メンバー・プロジェクト</div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid md:grid-cols-[240px_1fr] gap-6">
        {/* サイドバー：テナント一覧 */}
        <aside className="space-y-3">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">所属テナント</div>
          {tenants.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTenant(t)}
              className={`w-full text-left p-3 rounded-xl border transition ${
                activeTenant?.id === t.id
                  ? 'bg-white border-lime-400 shadow-sm'
                  : 'bg-white/60 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="font-semibold text-sm text-slate-900">{t.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {PLAN_LABEL[t.plan]}{t.plus ? ' +Plus' : ''} · {t.role}
              </div>
            </button>
          ))}
          <div className="pt-3 border-t border-slate-200">
            <input
              value={newTenantName}
              onChange={(e) => setNewTenantName(e.target.value)}
              placeholder="新規テナント名"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
            />
            <button
              onClick={createTenant}
              className="mt-2 w-full px-3 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              + 作成
            </button>
          </div>
        </aside>

        {/* メイン */}
        <section className="space-y-6">
          {msg && (
            <div className="p-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-700">{msg}</div>
          )}

          {!activeTenant ? (
            <div className="p-6 bg-white rounded-2xl border border-dashed border-slate-300 text-center text-slate-500">
              テナントを選択または作成してください
            </div>
          ) : (
            <>
              {/* プラン */}
              <div className="p-6 bg-white rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-bold text-slate-900">{activeTenant.name}</h2>
                    <div className="text-xs text-slate-500 mt-0.5">あなたの権限: {activeTenant.role}</div>
                  </div>
                  <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${PLAN_COLOR[activeTenant.plan]}`}>
                    {PLAN_LABEL[activeTenant.plan]}{activeTenant.plus ? ' +Plus' : ''}
                  </span>
                </div>
                <div className="text-xs text-slate-600 mb-3">
                  プロジェクト上限: <b>{activeTenant.max_projects}</b>（現在 {projects.length}）
                </div>
                {canManage && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {(['standard', 'pro', 'god', 'enterprise'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => changePlan(p, activeTenant.plus)}
                        className={`px-3 py-2 text-xs rounded-lg border ${
                          activeTenant.plan === p
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {PLAN_LABEL[p]}
                      </button>
                    ))}
                    <label className="col-span-2 md:col-span-4 flex items-center gap-2 text-sm text-slate-700 mt-2">
                      <input
                        type="checkbox"
                        checked={activeTenant.plus}
                        disabled={activeTenant.plan === 'enterprise'}
                        onChange={(e) => changePlan(activeTenant.plan, e.target.checked)}
                        className="w-4 h-4 accent-lime-500"
                      />
                      Plusオプション（プロジェクト数 1→3）
                    </label>
                  </div>
                )}
              </div>

              {/* プロジェクト */}
              <div className="p-6 bg-white rounded-2xl border border-slate-200">
                <h2 className="font-bold text-slate-900 mb-3">プロジェクト</h2>
                <div className="space-y-2 mb-4">
                  {projects.length === 0 && <div className="text-sm text-slate-500">まだプロジェクトはありません</div>}
                  {projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="text-sm font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString('ja-JP')}</div>
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="新規プロジェクト名"
                      className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                    />
                    <button
                      onClick={createProject}
                      className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                    >
                      + 追加
                    </button>
                  </div>
                )}
              </div>

              {/* メンバー */}
              <div className="p-6 bg-white rounded-2xl border border-slate-200">
                <h2 className="font-bold text-slate-900 mb-3">メンバー</h2>
                <div className="space-y-2 mb-4">
                  {members.map((m) => (
                    <div key={m.user_id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="text-xs font-mono text-slate-700">{m.user_id.slice(0, 8)}…</div>
                        <div className="text-xs text-slate-500">
                          {m.joined_at ? `参加: ${new Date(m.joined_at).toLocaleDateString('ja-JP')}` : '招待中'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isOwner ? (
                          <select
                            value={m.role}
                            onChange={(e) => changeRole(m.user_id, e.target.value)}
                            className="text-xs px-2 py-1 border border-slate-300 rounded"
                          >
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                          </select>
                        ) : (
                          <span className="text-xs px-2 py-1 bg-white border border-slate-200 rounded">{m.role}</span>
                        )}
                        {canManage && m.role !== 'owner' && (
                          <button
                            onClick={() => removeMember(m.user_id)}
                            className="text-xs px-2 py-1 text-rose-600 hover:bg-rose-50 rounded"
                          >
                            除名
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <input
                      value={inviteUserId}
                      onChange={(e) => setInviteUserId(e.target.value)}
                      placeholder="招待するユーザーID"
                      className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                      className="px-2 text-sm border border-slate-300 rounded-lg"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      onClick={invite}
                      className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                    >
                      招待
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

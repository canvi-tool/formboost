// /agent/live — GODプラン用ライブダッシュボード
'use client'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase'

type LiveSession = {
  id: string
  company_name: string | null
  started_at: string
  ended_at: string | null
  slides_viewed: number | null
  max_slide_reached: number | null
  questions_asked: number | null
  lead_rank: string | null
}

export default function LivePage() {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const sb = createBrowserClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb.from('pitch_sessions') as any)
      .select('id, company_name, started_at, ended_at, slides_viewed, max_slide_reached, questions_asked, lead_rank')
      .order('started_at', { ascending: false })
      .limit(50)
    setSessions(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const active = sessions.filter((s) => !s.ended_at)
  const rankColor = (r: string | null) =>
    r === 'S' ? 'bg-rose-100 text-rose-700'
    : r === 'A' ? 'bg-amber-100 text-amber-700'
    : r === 'B' ? 'bg-lime-100 text-lime-700'
    : 'bg-slate-100 text-slate-600'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center text-xl">📡</div>
          <div>
            <div className="text-lg font-bold text-slate-900">AI社畜くん GOD — ライブダッシュボード</div>
            <div className="text-xs text-slate-500">今まさに紙芝居を見ている見込み客をリアルタイム監視</div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse"></span>
            5秒ごと自動更新
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* アクティブセッション */}
        <section>
          <h2 className="text-sm font-bold text-slate-900 mb-3">
            🔴 接客中 ({active.length})
          </h2>
          {loading ? (
            <div className="text-sm text-slate-500">読み込み中...</div>
          ) : active.length === 0 ? (
            <div className="p-6 bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500 text-center">
              現在接客中のセッションはありません
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {active.map((s) => (
                <div key={s.id} className="p-4 bg-white rounded-2xl border border-lime-300 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-slate-900">{s.company_name || '（不明）'}</div>
                    <span className="text-xs px-2 py-0.5 bg-lime-500 text-white rounded-full">LIVE</span>
                  </div>
                  <div className="text-xs text-slate-500 space-y-1">
                    <div>スライド: {s.max_slide_reached ?? 0} / 質問: {s.questions_asked ?? 0}</div>
                    <div>開始: {new Date(s.started_at).toLocaleTimeString('ja-JP')}</div>
                  </div>
                  <button className="mt-3 w-full px-3 py-2 text-xs bg-slate-900 text-white rounded-lg hover:bg-slate-800">
                    割り込み通話する（実装予定）
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 終了済み */}
        <section>
          <h2 className="text-sm font-bold text-slate-900 mb-3">過去セッション</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left">会社名</th>
                  <th className="px-4 py-2 text-left">ランク</th>
                  <th className="px-4 py-2 text-left">スライド</th>
                  <th className="px-4 py-2 text-left">質問数</th>
                  <th className="px-4 py-2 text-left">開始時刻</th>
                </tr>
              </thead>
              <tbody>
                {sessions.filter((s) => s.ended_at).map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{s.company_name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${rankColor(s.lead_rank)}`}>
                        {s.lead_rank || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.slides_viewed ?? 0}</td>
                    <td className="px-4 py-3 text-slate-600">{s.questions_asked ?? 0}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(s.started_at).toLocaleString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

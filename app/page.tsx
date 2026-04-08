// AI社畜くん — ランディングページ
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-lime-50">
      {/* ヘッダー */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-lime-100 flex items-center justify-center text-xl">🤖</div>
            <div className="font-bold text-slate-900">AI社畜くん</div>
            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">社内β開発中</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/agent/tenants" className="text-xs text-slate-600 hover:text-slate-900 px-3 py-2">テナント管理</Link>
            <Link href="/agent/live" className="text-xs text-slate-600 hover:text-slate-900 px-3 py-2">ライブ</Link>
            <Link href="/agent" className="text-xs px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800">
              ダッシュボード →
            </Link>
          </nav>
        </div>
      </header>

      {/* ヒーロー */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-lime-100 text-lime-800 rounded-full text-xs font-semibold mb-6">
          <span className="w-1.5 h-1.5 bg-lime-500 rounded-full animate-pulse"></span>
          BtoBフォーム営業、全自動。
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-slate-900 leading-tight tracking-tight">
          もう、あなたが<br />
          <span className="bg-gradient-to-r from-lime-600 to-emerald-600 bg-clip-text text-transparent">
            社畜にならなくていい。
          </span>
        </h1>
        <p className="mt-6 text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
          夜中に送付、朝に学習、夕方にレポート。<br />
          AI社畜くんがあなたの代わりに、営業もプレゼンも接客も。
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link href="/agent" className="px-6 py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 shadow-lg shadow-slate-900/10">
            無料で始める
          </Link>
          <a href="#plans" className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-semibold hover:border-slate-500">
            プランを見る
          </a>
        </div>
      </section>

      {/* 3プラン */}
      <section id="plans" className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="text-xs font-semibold text-lime-600 uppercase tracking-widest">PLANS</div>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">3段階で進化する、あなたの社畜</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {/* 無印 */}
          <div className="p-8 bg-white rounded-3xl border border-slate-200 shadow-sm">
            <div className="text-2xl mb-3">🤖</div>
            <div className="text-xs font-bold text-slate-500 uppercase">STANDARD</div>
            <div className="text-xl font-bold text-slate-900 mt-1">AI社畜くん</div>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              もう、あなたが社畜にならなくていい。
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-700">
              <li className="flex gap-2"><span className="text-lime-600">✓</span>フォーム自動送付</li>
              <li className="flex gap-2"><span className="text-lime-600">✓</span>夜朝夕の営業サイクル</li>
              <li className="flex gap-2"><span className="text-lime-600">✓</span>Slack連携 / ブリーフィング</li>
              <li className="flex gap-2"><span className="text-lime-600">✓</span>クリックトラッキング</li>
            </ul>
          </div>
          {/* PRO */}
          <div className="p-8 bg-slate-900 text-white rounded-3xl border border-slate-900 shadow-xl relative -mt-2">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-lime-400 text-slate-900 text-[10px] font-bold rounded-full">
              人気
            </div>
            <div className="text-2xl mb-3">💼</div>
            <div className="text-xs font-bold text-lime-300 uppercase">PRO</div>
            <div className="text-xl font-bold mt-1">AI社畜くん PRO</div>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              営業から、プレゼンまで。全部AIに任せた。
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-200">
              <li className="flex gap-2"><span className="text-lime-400">✓</span>無印の全機能</li>
              <li className="flex gap-2"><span className="text-lime-400">✓</span>AIプレゼンページ（紙芝居）</li>
              <li className="flex gap-2"><span className="text-lime-400">✓</span>チャットBot自動応答</li>
              <li className="flex gap-2"><span className="text-lime-400">✓</span>ホットリードランキング</li>
            </ul>
          </div>
          {/* GOD */}
          <div className="p-8 bg-white rounded-3xl border-2 border-amber-300 shadow-sm relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-amber-400 text-slate-900 text-[10px] font-bold rounded-full">
              5月〜
            </div>
            <div className="text-2xl mb-3">⚡</div>
            <div className="text-xs font-bold text-amber-600 uppercase">GOD</div>
            <div className="text-xl font-bold text-slate-900 mt-1">AI社畜くん GOD</div>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              AI社畜の手柄を、神がぶんどる。
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-700">
              <li className="flex gap-2"><span className="text-amber-600">✓</span>PROの全機能</li>
              <li className="flex gap-2"><span className="text-amber-600">✓</span>ライブダッシュボード</li>
              <li className="flex gap-2"><span className="text-amber-600">✓</span>割り込み通話 / 画面共有</li>
              <li className="flex gap-2"><span className="text-amber-600">✓</span>S/A/B/Cリードスコア</li>
            </ul>
          </div>
        </div>

        {/* Plus オプション */}
        <div className="mt-10 p-6 bg-gradient-to-r from-lime-50 to-emerald-50 border border-lime-200 rounded-2xl flex items-center gap-4">
          <div className="text-3xl">➕</div>
          <div className="flex-1">
            <div className="font-bold text-slate-900">Plusオプション</div>
            <div className="text-sm text-slate-600 mt-0.5">
              どのプランでも追加可能。<b>1プロジェクト → 3プロジェクト</b>に拡張。それ以上は Enterprise版へ。
            </div>
          </div>
        </div>
      </section>

      {/* サイクル */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="text-xs font-semibold text-lime-600 uppercase tracking-widest">CYCLE</div>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">夜・朝・夕、休まない営業マン</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { icon: '🌙', time: '夜', title: '過去全データをAIが学習・分析', body: '今夜の送付リスト・文面をゼロから設計' },
            { icon: '☀️', time: '朝', title: 'フォーム自動送付', body: '会社ごとに差別化した文面で夜中に完遂' },
            { icon: '🌆', time: '夕', title: 'レポート＆Slack通知', body: 'ホットリード順に今日の成果を報告' },
          ].map((c) => (
            <div key={c.time} className="p-6 bg-white rounded-2xl border border-slate-200">
              <div className="text-3xl">{c.icon}</div>
              <div className="mt-3 text-xs font-bold text-lime-600 uppercase">{c.time}</div>
              <div className="mt-1 font-bold text-slate-900">{c.title}</div>
              <div className="mt-2 text-sm text-slate-600 leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-4xl font-bold text-slate-900">今夜から、社畜はAIに任せよう。</h2>
        <p className="mt-4 text-slate-600">社内β開発中。お問い合わせは管理者まで。</p>
        <Link href="/agent" className="mt-8 inline-block px-8 py-4 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 shadow-lg shadow-slate-900/10">
          ダッシュボードへ →
        </Link>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-slate-500">
          <div>© {new Date().getFullYear()} AI社畜くん</div>
          <div className="flex gap-4">
            <Link href="/agent">Dashboard</Link>
            <Link href="/agent/tenants">Tenants</Link>
            <Link href="/agent/live">Live</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

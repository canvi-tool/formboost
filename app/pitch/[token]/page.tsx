// /pitch/[token] — AI社畜くん紙芝居ページ（訪問時に起動）
'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

type Slide = { title: string; body: string }
type ChatMsg = { role: 'user' | 'assistant'; content: string }

export default function PitchPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [greeting, setGreeting] = useState('')
  const [slides, setSlides] = useState<Slide[]>([])
  const [destinationUrl, setDestinationUrl] = useState<string | null>(null)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  const startedAt = useRef<number>(Date.now())
  const maxSlideRef = useRef(0)
  const viewedRef = useRef(new Set<number>())
  const questionsRef = useRef(0)

  // セッション開始
  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const res = await fetch('/api/pitch/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'failed')
        setSessionId(data.session_id)
        setGreeting(data.greeting || '')
        setSlides(data.slides || [])
        setDestinationUrl(data.destination_url || null)
        viewedRef.current.add(0)
        // 挨拶を音声合成
        speak(data.greeting || '')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  // 離脱時にセッション終了
  useEffect(() => {
    const end = () => {
      if (!sessionId) return
      const duration = Math.round((Date.now() - startedAt.current) / 1000)
      navigator.sendBeacon?.(
        '/api/pitch/session',
        new Blob(
          [
            JSON.stringify({
              session_id: sessionId,
              total_duration_sec: duration,
              slides_viewed: viewedRef.current.size,
              max_slide_reached: maxSlideRef.current,
              questions_asked: questionsRef.current,
              scroll_depth_pct: Math.round((maxSlideRef.current / Math.max(slides.length - 1, 1)) * 100),
              exit_slide: currentSlide,
            }),
          ],
          { type: 'application/json' }
        )
      )
      // PATCH代替でfetch (sendBeaconはPOSTのみなので別途)
      fetch('/api/pitch/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          total_duration_sec: duration,
          slides_viewed: viewedRef.current.size,
          max_slide_reached: maxSlideRef.current,
          questions_asked: questionsRef.current,
          scroll_depth_pct: Math.round((maxSlideRef.current / Math.max(slides.length - 1, 1)) * 100),
          exit_slide: currentSlide,
        }),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', end)
    return () => window.removeEventListener('beforeunload', end)
  }, [sessionId, currentSlide, slides.length])

  const speak = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ja-JP'
      u.rate = 1.05
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch {}
  }

  const logEvent = (event_type: string, slide_index?: number) => {
    if (!sessionId) return
    fetch('/api/pitch/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, event_type, slide_index }),
    }).catch(() => {})
  }

  const goSlide = (i: number) => {
    if (i < 0 || i >= slides.length) return
    setCurrentSlide(i)
    viewedRef.current.add(i)
    if (i > maxSlideRef.current) maxSlideRef.current = i
    logEvent('slide_view', i)
    const s = slides[i]
    if (s) speak(`${s.title}。${s.body}`)
  }

  const sendChat = async () => {
    if (!chatInput.trim() || !sessionId || chatBusy) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatMsgs((m) => [...m, { role: 'user', content: msg }])
    setChatBusy(true)
    questionsRef.current += 1
    logEvent('question')
    try {
      const res = await fetch('/api/pitch/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, user_message: msg }),
      })
      const data = await res.json()
      const reply = data.reply || 'すみません、お答えできませんでした…。'
      setChatMsgs((m) => [...m, { role: 'assistant', content: reply }])
      speak(reply)
    } catch {
      setChatMsgs((m) => [...m, { role: 'assistant', content: '通信エラーが起きました…' }])
    } finally {
      setChatBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-600">AI社畜くんが準備中です…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-rose-600">エラー: {error}</div>
      </div>
    )
  }

  const slide = slides[currentSlide]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-lime-50">
      {/* ヘッダー */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center text-xl">🤖</div>
            <div>
              <div className="text-sm font-bold text-slate-900">AI社畜くん</div>
              <div className="text-xs text-slate-500">お時間いただきありがとうございます</div>
            </div>
          </div>
          {destinationUrl && (
            <a
              href={destinationUrl}
              onClick={() => logEvent('cta_click')}
              className="text-xs px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              サイトを見る →
            </a>
          )}
        </div>
      </header>

      {/* 紙芝居 */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        {greeting && currentSlide === 0 && (
          <div className="mb-6 p-4 bg-white rounded-2xl border border-lime-200 shadow-sm">
            <div className="text-sm text-slate-700 leading-relaxed">{greeting}</div>
          </div>
        )}

        {slide && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-lg p-10 min-h-[400px]">
            <div className="text-xs text-lime-600 font-semibold mb-3">
              SLIDE {currentSlide + 1} / {slides.length}
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-6">{slide.title}</h2>
            <p className="text-lg text-slate-700 leading-relaxed whitespace-pre-wrap">{slide.body}</p>
          </div>
        )}

        {/* ナビ */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => goSlide(currentSlide - 1)}
            disabled={currentSlide === 0}
            className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-30 hover:bg-slate-50"
          >
            ← 前へ
          </button>
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => goSlide(i)}
                className={`w-2 h-2 rounded-full transition ${
                  i === currentSlide ? 'bg-lime-500 w-6' : 'bg-slate-300'
                }`}
                aria-label={`slide ${i + 1}`}
              />
            ))}
          </div>
          <button
            onClick={() => goSlide(currentSlide + 1)}
            disabled={currentSlide >= slides.length - 1}
            className="px-5 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-30 hover:bg-slate-800"
          >
            次へ →
          </button>
        </div>
      </main>

      {/* VOICHAT風チャットウィジェット */}
      <div className="fixed bottom-6 right-6 z-20">
        {chatOpen ? (
          <div className="w-80 h-96 bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <span className="text-sm font-semibold">AI社畜くんに質問</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/70 hover:text-white">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
              {chatMsgs.length === 0 && (
                <div className="text-xs text-slate-500 text-center mt-8">
                  なんでも聞いてください。ぼく、頑張って答えます。
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                    m.role === 'user'
                      ? 'bg-lime-500 text-white ml-auto'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {chatBusy && <div className="text-xs text-slate-400">考え中…</div>}
            </div>
            <div className="p-2 border-t border-slate-200 flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="質問を入力…"
                className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-lime-500"
              />
              <button
                onClick={sendChat}
                disabled={chatBusy || !chatInput.trim()}
                className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-40"
              >
                送信
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="w-16 h-16 rounded-full bg-slate-900 text-white shadow-2xl hover:scale-105 transition flex items-center justify-center text-2xl"
          >
            💬
          </button>
        )}
      </div>
    </div>
  )
}

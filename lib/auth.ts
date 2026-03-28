// 認証ヘルパー — Supabase Auth
import { createBrowserClient } from './supabase'

export async function getSession() {
  const supabase = createBrowserClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function getUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user?.id || null
}

// API呼び出しヘルパー（認証ヘッダー付き）
export async function authFetch(url: string, options: RequestInit = {}) {
  const session = await getSession()
  if (!session) throw new Error('認証が必要です')

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': session.user.id,
      ...options.headers,
    },
  })
}

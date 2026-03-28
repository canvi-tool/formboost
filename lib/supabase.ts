import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

// ── ブラウザ用クライアント (anon key, RLS適用) ──
export function createBrowserClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ── サーバー用クライアント (anon key, RLS適用) ──
export function createServerClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ── 管理用クライアント (service role, RLS バイパス) ──
// Cloud Run webhook、バッチ更新で使用
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

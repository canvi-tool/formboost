// Supabase Database Types (generated from schema)

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          display_name: string | null
          company_name: string | null
          sender_name: string | null
          sender_email: string | null
          sender_phone: string | null
          default_template: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          display_name?: string | null
          company_name?: string | null
          sender_name?: string | null
          sender_email?: string | null
          sender_phone?: string | null
          default_template?: string | null
        }
        Update: {
          [K in keyof Database['public']['Tables']['profiles']['Row']]?: Database['public']['Tables']['profiles']['Row'][K]
        }
      }
      campaigns: {
        Row: {
          id: string
          user_id: string
          name: string
          status: CampaignStatus
          total_targets: number
          searched_count: number
          sent_count: number
          success_count: number
          failed_count: number
          skipped_count: number
          template: string | null
          sender_company: string | null
          sender_name: string | null
          sender_email: string | null
          sender_phone: string | null
          estimated_cost: number
          actual_cost: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          status?: CampaignStatus
          total_targets?: number
          template?: string | null
          sender_company?: string | null
          sender_name?: string | null
          sender_email?: string | null
          sender_phone?: string | null
          estimated_cost?: number
        }
        Update: {
          [K in keyof Database['public']['Tables']['campaigns']['Row']]?: Database['public']['Tables']['campaigns']['Row'][K]
        }
      }
      targets: {
        Row: {
          id: string
          campaign_id: string
          company: string
          hp_url: string | null
          form_url: string | null
          hojin_number: string | null
          address: string | null
          site_url: string | null
          search_confidence: string | null
          search_source: string | null
          search_mode: string | null
          search_cost: number
          send_status: SendStatus
          send_error: string | null
          filled_fields: FilledField[] | null
          complete_detected: boolean
          complete_keyword: string | null
          screenshot_url: string | null
          final_url: string | null
          page_title: string | null
          elapsed_ms: number | null
          sent_at: string | null
          retry_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          company: string
          hp_url?: string | null
          form_url?: string | null
          hojin_number?: string | null
          address?: string | null
        }
        Update: {
          [K in keyof Database['public']['Tables']['targets']['Row']]?: Database['public']['Tables']['targets']['Row'][K]
        }
      }
      execution_logs: {
        Row: {
          id: number
          campaign_id: string | null
          target_id: string | null
          level: 'debug' | 'info' | 'warn' | 'error'
          phase: string | null
          message: string
          metadata: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          campaign_id?: string | null
          target_id?: string | null
          level?: 'debug' | 'info' | 'warn' | 'error'
          phase?: string | null
          message: string
          metadata?: Record<string, unknown> | null
        }
        Update: never
      }
    }
  }
}

export type CampaignStatus = 'draft' | 'searching' | 'ready' | 'sending' | 'paused' | 'done'
export type SendStatus = 'pending' | 'queued' | 'sending' | 'success' | 'failed' | 'skipped' | 'captcha'

export type FilledField = {
  field: string
  selector: string
  value?: string
}

// Convenience types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Campaign = Database['public']['Tables']['campaigns']['Row']
export type Target = Database['public']['Tables']['targets']['Row']
export type ExecutionLog = Database['public']['Tables']['execution_logs']['Row']

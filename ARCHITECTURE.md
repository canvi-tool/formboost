# FormBoost v3 Architecture

## 4-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub (Source)                       │
│  formboost-main/  → Vercel auto-deploy                  │
│  formboost-sender/ → Cloud Run manual deploy             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Vercel (UI + Light API)                     │
│  /              → Dashboard (認証付き)                   │
│  /api/campaigns → キャンペーンCRUD                       │
│  /api/jobs      → 送信ジョブ管理 (作成/ステータス)        │
│  /api/search    → フォームURL検索 (既存改良)             │
│  /api/webhook   → Cloud Run完了通知受け口                │
│  /api/health    → ヘルスチェック                         │
└────────────┬────────────────────────────┬───────────────┘
             │                            │
             ▼                            ▼
┌─────────────────────┐    ┌─────────────────────────────┐
│   Supabase (Data)   │    │   Cloud Run (Worker)        │
│                     │    │                             │
│  Tables:            │    │  /submit    → 1社送信        │
│  - profiles         │    │  /analyze   → フォーム解析    │
│  - campaigns        │    │  /health    → ヘルスチェック  │
│  - targets          │    │                             │
│  - send_jobs        │    │  Features:                  │
│  - send_results     │    │  - Playwright + Claude DOM  │
│  - execution_logs   │    │  - Mode A/B                 │
│                     │    │  - CAPTCHA検出               │
│  Auth:              │    │  - 確認画面対応              │
│  - Supabase Auth    │    │  - リトライ (max 2)          │
│  - RLS policies     │    │  - 完了webhook              │
│                     │    │  - 実行ログ → Supabase       │
└─────────────────────┘    └─────────────────────────────┘
```

## Data Flow

### 1. CSV Import → Campaign
```
User uploads CSV
  → Vercel parses CSV
  → Creates campaign in Supabase
  → Bulk inserts targets
  → Returns campaign_id
```

### 2. Search (フォームURL検索)
```
POST /api/search { company, form_url?, hp_url? }
  → Priority 1: form_url直指定 → ¥0.56/社
  → Priority 2: hp_url HEAD巡回 → ¥0.67/社
  → Priority 3: Brave Search    → ¥2.89/社
  → Update target.form_url in Supabase
```

### 3. Send (送信実行)
```
POST /api/jobs { campaign_id, target_ids[] }
  → Creates send_jobs in Supabase (status: queued)
  → Calls Cloud Run /submit for each
  → Cloud Run fills form via Claude DOM analysis
  → Cloud Run POSTs result to /api/webhook
  → Webhook updates send_results in Supabase
  → Realtime subscription updates UI
```

## Cost Model
| Pattern              | Cost/company | Components                |
|---------------------|-------------|---------------------------|
| Mode A (form URL)   | ¥0.56       | Claude Haiku + Cloud Run  |
| Mode B (HP URL)     | ¥0.67       | Playwright + Claude + CR  |
| Search (name only)  | ¥2.89       | Brave×3 + Claude + CR    |

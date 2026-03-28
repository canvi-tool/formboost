-- Migration: Add custom_message to targets for AI-generated per-company messages
ALTER TABLE targets ADD COLUMN IF NOT EXISTS custom_message text;

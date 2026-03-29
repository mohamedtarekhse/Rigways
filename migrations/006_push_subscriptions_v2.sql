-- ============================================================
-- Push Subscriptions v2 — Add missing columns to match spec
-- Run this in Supabase SQL Editor AFTER 005_push_subscriptions.sql
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

-- client_id: browser/device fingerprint (optional, sent by frontend)
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS client_id TEXT;

-- platform: 'android' | 'ios' | 'desktop' (optional, sent by frontend)
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform TEXT;

-- is_standalone: true when launched as an installed PWA
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS is_standalone BOOLEAN;

-- active: soft-delete flag; set to false on HTTP 410/404 from push service
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- updated_at: auto-updated on row changes (via trigger below)
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- last_used_at: set each time a push is successfully dispatched
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Backfill updated_at for existing rows
UPDATE push_subscriptions
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- Index for fast active-subscription lookups
CREATE INDEX IF NOT EXISTS idx_push_subs_user_active
  ON push_subscriptions(user_id, active);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_push_sub_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_sub_updated_at_trigger ON push_subscriptions;
CREATE TRIGGER push_sub_updated_at_trigger
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_push_sub_updated_at();

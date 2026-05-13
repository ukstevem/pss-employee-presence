-- ============================================================
-- timecard_events.uniq_tap: idempotency key for safe retry
--
-- Required for bridge SQLite outbox (timecard-bridge repo).
-- Without this, a retry after partial-success (Supabase wrote
-- the row but HTTP response was lost mid-flight) duplicates.
-- With this + PostgREST `Prefer: resolution=ignore-duplicates`,
-- retries become idempotent no-ops.
--
-- Tuple (card_id, device_id, ts) uniquely identifies a tap:
-- - reader-emitted taps: device_id = reader serial (e.g. carr-tc-02)
-- - manual taps:         device_id = 'manual'
-- - test taps:           device_id = 'test'
-- A reader cannot emit two distinct taps at the same UTC ts.
-- ============================================================

alter table public.timecard_events
  add constraint timecard_events_uniq_tap
  unique (card_id, device_id, ts);

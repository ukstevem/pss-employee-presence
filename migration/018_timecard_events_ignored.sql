-- ============================================================
-- timecard_events.ignored: manager-set boolean to exclude an
-- individual tap from the worked-hours calculation without
-- deleting it. Preserves the audit trail (the original event
-- row stays put) while letting the manager correct misreads or
-- bogus taps.
--
-- Used by the /hours edit-day modal: the manager ticks ignore
-- on the bad tap(s), and the function's pair-pairing logic
-- skips ignored rows.
--
-- Partial index since the vast majority of rows have ignored=false.
-- ============================================================

alter table timecard_events
  add column if not exists ignored boolean not null default false;

create index if not exists idx_timecard_events_ignored
  on timecard_events (ignored) where ignored = true;

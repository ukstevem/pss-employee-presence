-- ============================================================
-- employees.hire_date: when the person started, distinct from
-- created_at (when their row was inserted into our system).
--
-- Backfills from created_at since you've manually corrected those
-- values to reflect actual hire dates. After this, created_at can
-- safely revert to its plain meaning ("row inserted at") for any
-- future rows.
--
-- Idempotent: column add is conditional, backfill only fills
-- nulls.
-- ============================================================

alter table employees
  add column if not exists hire_date date;

update employees
   set hire_date = created_at::date
 where hire_date is null;

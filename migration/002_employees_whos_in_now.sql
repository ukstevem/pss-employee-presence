-- ============================================================
-- employees_whos_in_now: one row per active employee with current
-- in/out status, derived from today's taps using the parity rule
-- (odd count of taps today = currently IN, even = OUT, none = NEVER).
--
-- "Today" means today in Europe/London — handles BST/GMT correctly.
-- Reads from timecard_events_90d for the cheap recent-only scan.
-- Run this in your Supabase SQL editor after 001_employee_cards.sql.
-- ============================================================

create or replace view employees_whos_in_now
with (security_invoker = off)
as
with todays_taps as (
  select
    tc.employee_id,
    e.ts
  from timecard_events_90d e
  join employee_cards tc
    on tc.card_id = e.card_id
   and tc.active   = true
  where (e.ts at time zone 'Europe/London')::date
        = (now() at time zone 'Europe/London')::date
),
agg as (
  select
    employee_id,
    count(*)::int as tap_count_today,
    min(ts)       as first_tap_today,
    max(ts)       as last_tap_today
  from todays_taps
  group by employee_id
)
select
  emp.id                                  as employee_id,
  emp.first_name || ' ' || emp.last_name  as full_name,
  emp.first_name,
  emp.last_name,
  emp.team,
  case
    when agg.tap_count_today is null      then 'never'
    when agg.tap_count_today % 2 = 1      then 'in'
    else                                       'out'
  end                                     as status,
  agg.first_tap_today,
  agg.last_tap_today,
  coalesce(agg.tap_count_today, 0)        as tap_count_today
from employees emp
left join agg on agg.employee_id = emp.id
where emp.active = true;

-- security_invoker = off (definer mode): the view runs with its
-- OWNER's privileges, bypassing the service_role_only RLS policy
-- on timecard_events. The view returns only aggregated/derived
-- presence data, so this is a controlled read surface — the raw
-- event rows stay inaccessible to authenticated users.

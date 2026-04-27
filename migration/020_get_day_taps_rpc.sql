-- ============================================================
-- get_day_taps: returns every tap row for a single (employee,
-- work_date), including ignored ones, so the /hours edit-day
-- modal can show the full audit trail with toggles.
--
-- SECURITY DEFINER because timecard_events is service_role-only.
-- ============================================================

create or replace function get_day_taps(
  p_employee_id uuid,
  p_work_date   date,
  p_timezone    text default 'Europe/London'
)
returns table (
  id           uuid,
  ts           timestamptz,
  actor        text,
  ignored      boolean,
  raw_payload  jsonb
)
language sql stable security definer as $$
  select e.id, e.ts, e.actor, e.ignored, e.raw_payload
  from timecard_events e
  join employee_cards tc
    on tc.card_id   = e.card_id
   and tc.active    = true
  where tc.employee_id = p_employee_id
    and (e.ts at time zone p_timezone)::date = p_work_date
  order by e.ts;
$$;

grant execute on function get_day_taps(uuid, date, text) to authenticated;

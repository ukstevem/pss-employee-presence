-- ============================================================
-- employees_daily_hours(p_start_date, p_end_date, ...): per-employee
-- per-day summary used by the /hours analysis report.
--
-- Pairs taps in time order (1st+2nd, 3rd+4th, …). Worked minutes
-- come from complete pairs; an odd count of taps → missed_clock_out
-- (the lone last tap is excluded from the duration sum).
--
-- All date arithmetic is in p_timezone (default Europe/London) so
-- BST/GMT shifts and "today in London" are handled correctly.
--
-- Reads from timecard_events directly (not the 90d view) so that
-- callers can request ranges older than 90 days.
--
-- Run after 001_employee_cards.sql.
-- ============================================================

create or replace function employees_daily_hours(
  p_start_date  date,
  p_end_date    date,
  p_timezone    text default 'Europe/London',
  p_shift_start time default '08:00',
  p_shift_end   time default '17:00'
)
returns table (
  employee_id          uuid,
  full_name            text,
  team                 text,
  work_date            date,
  is_working_day       boolean,
  tap_count            int,
  first_tap            timestamptz,
  last_tap             timestamptz,
  worked_minutes       int,
  missed_clock_in      boolean,
  missed_clock_out     boolean,
  late_minutes         int,    -- positive = arrived after shift start; negative = early
  early_finish_minutes int     -- positive = left before shift end; negative = stayed late
)
language sql stable as $$
  with ordered_taps as (
    select
      tc.employee_id,
      e.ts,
      (e.ts at time zone p_timezone)::date as work_date,
      row_number() over (
        partition by tc.employee_id, (e.ts at time zone p_timezone)::date
        order by e.ts
      ) as tap_idx
    from timecard_events e
    join employee_cards tc
      on tc.card_id = e.card_id
     and tc.active   = true
    where (e.ts at time zone p_timezone)::date between p_start_date and p_end_date
  ),
  pairs as (
    select
      employee_id,
      work_date,
      max(case when tap_idx % 2 = 1 then ts end) as in_ts,
      max(case when tap_idx % 2 = 0 then ts end) as out_ts
    from ordered_taps
    group by employee_id, work_date, ((tap_idx + 1) / 2)
  ),
  worked as (
    select
      employee_id,
      work_date,
      sum(extract(epoch from (out_ts - in_ts)) / 60)::int as worked_minutes
    from pairs
    where in_ts is not null and out_ts is not null
    group by employee_id, work_date
  ),
  daily as (
    select
      employee_id,
      work_date,
      count(*)::int as tap_count,
      min(ts)       as first_tap,
      max(ts)       as last_tap
    from ordered_taps
    group by employee_id, work_date
  ),
  date_range as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as d
  )
  select
    e.id                                  as employee_id,
    e.first_name || ' ' || e.last_name    as full_name,
    e.team,
    dr.d                                  as work_date,
    (extract(isodow from dr.d) <= 5)      as is_working_day,
    coalesce(d.tap_count, 0)              as tap_count,
    d.first_tap,
    d.last_tap,
    coalesce(w.worked_minutes, 0)         as worked_minutes,
    (d.tap_count is null)                 as missed_clock_in,
    (d.tap_count is not null and d.tap_count % 2 = 1) as missed_clock_out,
    case when d.first_tap is not null then
      (extract(epoch from (
        d.first_tap - ((dr.d + p_shift_start)::timestamp at time zone p_timezone)
      )) / 60)::int
    end as late_minutes,
    case when d.last_tap is not null then
      (extract(epoch from (
        ((dr.d + p_shift_end)::timestamp at time zone p_timezone) - d.last_tap
      )) / 60)::int
    end as early_finish_minutes
  from employees e
  cross join date_range dr
  left join daily  d on d.employee_id  = e.id and d.work_date  = dr.d
  left join worked w on w.employee_id  = e.id and w.work_date  = dr.d
  where e.active = true;
$$;

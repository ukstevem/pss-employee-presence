-- ============================================================
-- employees_daily_hours(p_start_date, p_end_date, ...): per-employee
-- per-day summary used by the /hours analysis report.
--
-- Per-employee shifts: each row resolves day_start/day_finish/
-- lunch via the assigned employee_shift_pattern (+ per-weekday
-- employee_shift_pattern_day row). Employees with no pattern fall
-- back to the global p_shift_start/p_shift_end function args (Mon–Fri).
--
-- Worked minutes = sum of complete-pair durations, minus the overlap
-- with any unpaid lunch window defined for that day's shift row.
--
-- Run after 009_employee_shift_pattern.sql.
-- ============================================================

drop function if exists employees_daily_hours(date, date, text, time, time);

create function employees_daily_hours(
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
  pay_type             text,
  work_date            date,
  is_working_day       boolean,
  tap_count            int,
  first_tap            timestamptz,
  last_tap             timestamptz,
  first_tap_actor      text,
  last_tap_actor       text,
  worked_minutes       int,
  missed_clock_in      boolean,
  missed_clock_out     boolean,
  late_minutes         int,
  early_finish_minutes int
)
language sql stable security definer as $$
  with date_range as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as d
  ),
  -- Resolve effective shift hours per (employee, work_date). For
  -- employees with no pattern: fall back to the function-arg
  -- defaults; is_working_day = Mon–Fri. For employees with a pattern:
  -- use the per-weekday row, and a missing row means the pattern
  -- treats that weekday as a day off.
  shift_resolved as (
    select
      e.id                                          as employee_id,
      e.first_name || ' ' || e.last_name            as full_name,
      e.team,
      e.pay_type,
      dr.d                                          as work_date,
      coalesce(spd.day_start, p_shift_start)        as day_start,
      coalesce(spd.day_finish, p_shift_end)         as day_finish,
      spd.lunch_start,
      spd.lunch_finish,
      coalesce(sp.paid_lunch, false)                as paid_lunch,
      case
        when e.shift_pattern_id is not null then (spd.id is not null)
        else (extract(isodow from dr.d) <= 5)
      end                                           as is_working_day
    from employees e
    cross join date_range dr
    left join employee_shift_pattern sp on sp.id = e.shift_pattern_id
    left join employee_shift_pattern_day spd
      on  spd.shift_pattern_id = e.shift_pattern_id
      and spd.weekday          = extract(isodow from dr.d)
    where (e.hire_date is null or e.hire_date <= p_end_date)
      and (e.deactivated_at is null or e.deactivated_at::date >= p_start_date)
  ),
  ordered_taps as (
    select
      tc.employee_id,
      e.ts,
      e.actor,
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
  daily as (
    select
      employee_id,
      work_date,
      count(*)::int as tap_count,
      min(ts)       as first_tap,
      -- last_tap = the latest "out" tap (even index in the day's order).
      -- For a single-tap day: no even-indexed tap → null, so no spurious
      -- early-finish gets calculated against the orphan in-tap.
      -- For in-out-in (odd >1): the index-2 out is still a real
      -- last-out, so we surface it.
      max(case when tap_idx % 2 = 0 then ts end) as last_tap,
      -- Actor of the first tap and of the last "out" tap (same parity
      -- rule), so the page can show the M telltale on manually-entered
      -- corrections.
      (array_agg(actor order by ts asc))[1] as first_tap_actor,
      (array_agg(actor order by tap_idx desc) filter (where tap_idx % 2 = 0))[1] as last_tap_actor
    from ordered_taps
    group by employee_id, work_date
  ),
  -- For each completed pair, compute its raw duration and (when the
  -- shift has an unpaid lunch window) the overlap of the pair with
  -- that lunch window. lunch_deduction is in minutes.
  pair_minutes as (
    select
      p.employee_id,
      p.work_date,
      extract(epoch from (p.out_ts - p.in_ts)) / 60 as pair_minutes_raw,
      case
        when sr.lunch_start  is not null
         and sr.lunch_finish is not null
         and sr.paid_lunch   = false
        then greatest(
          0,
          extract(epoch from (
            least(p.out_ts,
                  ((p.work_date + sr.lunch_finish)::timestamp at time zone p_timezone))
            -
            greatest(p.in_ts,
                     ((p.work_date + sr.lunch_start)::timestamp at time zone p_timezone))
          )) / 60
        )
        else 0
      end as lunch_deduction
    from pairs p
    join shift_resolved sr
      on  sr.employee_id = p.employee_id
      and sr.work_date   = p.work_date
    where p.in_ts is not null and p.out_ts is not null
  ),
  worked as (
    select
      employee_id,
      work_date,
      sum(pair_minutes_raw - lunch_deduction)::int as worked_minutes
    from pair_minutes
    group by employee_id, work_date
  )
  select
    sr.employee_id,
    sr.full_name,
    sr.team,
    sr.pay_type,
    sr.work_date,
    sr.is_working_day,
    coalesce(d.tap_count, 0)              as tap_count,
    d.first_tap,
    d.last_tap,
    d.first_tap_actor,
    d.last_tap_actor,
    coalesce(w.worked_minutes, 0)         as worked_minutes,
    (d.tap_count is null)                 as missed_clock_in,
    (d.tap_count is not null and d.tap_count % 2 = 1) as missed_clock_out,
    case when d.first_tap is not null then
      (extract(epoch from (
        d.first_tap - ((sr.work_date + sr.day_start)::timestamp at time zone p_timezone)
      )) / 60)::int
    end as late_minutes,
    case when d.last_tap is not null then
      (extract(epoch from (
        ((sr.work_date + sr.day_finish)::timestamp at time zone p_timezone) - d.last_tap
      )) / 60)::int
    end as early_finish_minutes
  from shift_resolved sr
  left join daily  d on d.employee_id = sr.employee_id and d.work_date = sr.work_date
  left join worked w on w.employee_id = sr.employee_id and w.work_date = sr.work_date;
$$;

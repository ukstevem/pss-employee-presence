-- ============================================================
-- employee_shift_pattern (parent) + employee_shift_pattern_day
-- (per-weekday rows): supports 7-day patterns with different
-- hours on different days.
--
-- A weekday with no child row = day off for that pattern.
-- employees.shift_pattern_id is nullable; NULL means "use the
-- global app default" (08:00–17:00 Mon–Fri Europe/London) until
-- a pattern is assigned.
--
-- Function refactor to use per-employee shifts is a separate
-- follow-up (see beads). For now, employees_daily_hours still
-- uses its p_shift_start/p_shift_end params.
-- ============================================================

create table if not exists employee_shift_pattern (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null unique,
  description  text,
  timezone     text        not null default 'Europe/London',
  paid_lunch   boolean     not null default false,
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists employee_shift_pattern_day (
  id                uuid        primary key default gen_random_uuid(),
  shift_pattern_id  uuid        not null references employee_shift_pattern(id) on delete cascade,
  weekday           int         not null check (weekday between 1 and 7),  -- ISO 1=Mon..7=Sun
  day_start         time        not null,
  day_finish        time        not null,
  lunch_start       time,
  lunch_finish      time,
  unique (shift_pattern_id, weekday),
  check (
    (lunch_start is null and lunch_finish is null)
    or (lunch_start is not null and lunch_finish is not null)
  )
);

create index if not exists idx_employee_shift_pattern_day_pattern
  on employee_shift_pattern_day (shift_pattern_id);

-- ============================================================
-- FK on employees
-- ============================================================

alter table employees
  add column if not exists shift_pattern_id uuid
    references employee_shift_pattern(id) on delete set null;

create index if not exists idx_employees_shift_pattern
  on employees (shift_pattern_id);

-- ============================================================
-- updated_at trigger on parent (mirrors the pattern from other
-- tables; idempotent)
-- ============================================================

create or replace function employee_shift_pattern_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_employee_shift_pattern_updated_at on employee_shift_pattern;
create trigger trg_employee_shift_pattern_updated_at
  before update on employee_shift_pattern
  for each row execute function employee_shift_pattern_set_updated_at();

-- ============================================================
-- Row-Level Security
-- v1: authenticated read + write. Tightens to admin-role for
-- writes alongside the rest of the cross-table RLS sweep.
-- ============================================================

alter table employee_shift_pattern enable row level security;
alter table employee_shift_pattern_day enable row level security;

drop policy if exists "Authenticated can read employee_shift_pattern" on employee_shift_pattern;
create policy "Authenticated can read employee_shift_pattern"
  on employee_shift_pattern for select to authenticated using (true);

drop policy if exists "Authenticated can write employee_shift_pattern" on employee_shift_pattern;
create policy "Authenticated can write employee_shift_pattern"
  on employee_shift_pattern for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated can read employee_shift_pattern_day" on employee_shift_pattern_day;
create policy "Authenticated can read employee_shift_pattern_day"
  on employee_shift_pattern_day for select to authenticated using (true);

drop policy if exists "Authenticated can write employee_shift_pattern_day" on employee_shift_pattern_day;
create policy "Authenticated can write employee_shift_pattern_day"
  on employee_shift_pattern_day for all to authenticated using (true) with check (true);

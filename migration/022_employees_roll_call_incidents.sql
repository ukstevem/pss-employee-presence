-- ============================================================
-- employees_roll_call_incidents: audit log of fire-marshal roll
-- calls completed on a physical device (e.g. M5Stack PaperS3).
--
-- One row per closed incident. The device posts this row over
-- LAN to /api/roll-call/incidents at the moment the marshal hits
-- "close incident" — the body captures who was accounted-for,
-- who was outstanding, and any not-IN people the marshal flagged
-- as actually present (exception cases).
--
-- Run after the 001/002/004 employees_* migrations.
-- ============================================================

create table if not exists employees_roll_call_incidents (
  id              uuid primary key default gen_random_uuid(),
  device_id       text not null,
  started_at      timestamptz not null,            -- first tick on device
  ended_at        timestamptz not null default now(),
  snapshot_at     timestamptz,                     -- generated_at from the /api/roll-call payload
  expected_count  int  not null,                   -- people clocked IN at snapshot
  accounted_count int  not null,                   -- ticked off by marshal
  outstanding     jsonb not null default '[]'::jsonb,
  exceptions      jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists employees_roll_call_incidents_started_at_idx
  on employees_roll_call_incidents (started_at desc);

alter table employees_roll_call_incidents enable row level security;

-- Device posts via the server-side service-role client (no user JWT),
-- so allow service_role inserts. Authenticated users (the platform-portal
-- audit dashboard) can read.
drop policy if exists "service role inserts incidents" on employees_roll_call_incidents;
create policy "service role inserts incidents"
  on employees_roll_call_incidents
  for insert
  to service_role
  with check (true);

drop policy if exists "authenticated reads incidents" on employees_roll_call_incidents;
create policy "authenticated reads incidents"
  on employees_roll_call_incidents
  for select
  to authenticated
  using (true);

comment on table employees_roll_call_incidents is
  'Audit log of fire-marshal roll calls completed on a physical device. One row per closed incident.';
comment on column employees_roll_call_incidents.outstanding is
  'JSON array of {id,name,team} for people who were IN at snapshot but never accounted-for.';
comment on column employees_roll_call_incidents.exceptions is
  'JSON array of {id,name,team,status} for not-IN people the marshal flagged as physically present.';

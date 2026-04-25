-- ============================================================
-- employee_cards: maps physical tap cards (NFC UIDs) to employees.
-- Scoped to clockcard / presence use; other card use cases (door
-- access, tool checkout, etc.) get their own tables when needed.
-- Run this in your Supabase SQL editor.
-- ============================================================

create table if not exists employee_cards (
  id              uuid        primary key default gen_random_uuid(),
  card_id         text        not null,                       -- physical card UID emitted by reader
  employee_id     uuid        not null references employees(id) on delete restrict,
  active          boolean     not null default true,          -- false = lost / broken / replaced
  notes           text,                                        -- e.g. "lost on 2026-04-01, replaced by 7653ab08e"
  deactivated_at  timestamptz,                                 -- set when active flips to false; preserves history
  created_at      timestamptz not null default now()
);

-- A card_id appears in this table at most once, ever. Once a card
-- is deactivated it cannot be re-issued; a new physical card must
-- be issued with a new UID. Historical taps stay attributed via
-- the existing (now-inactive) row.
create unique index if not exists employee_cards_card_id_uniq
  on employee_cards (card_id);

-- Common lookups
create index if not exists idx_employee_cards_employee
  on employee_cards (employee_id);

create index if not exists idx_employee_cards_card_id
  on employee_cards (card_id);

-- ============================================================
-- Row-Level Security
-- v1: any authenticated user can read and write.
-- Tightened to admin-role for writes in a follow-up issue.
-- ============================================================

alter table employee_cards enable row level security;

drop policy if exists "Authenticated users can read employee_cards" on employee_cards;
create policy "Authenticated users can read employee_cards"
  on employee_cards for select to authenticated using (true);

drop policy if exists "Authenticated users can insert employee_cards" on employee_cards;
create policy "Authenticated users can insert employee_cards"
  on employee_cards for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update employee_cards" on employee_cards;
create policy "Authenticated users can update employee_cards"
  on employee_cards for update to authenticated using (true) with check (true);

-- Deletes are not allowed in v1: deactivate instead (active=false) so
-- historical taps remain attributable.

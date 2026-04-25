-- ============================================================
-- Rename objects to use employees_* prefix so they sort together
-- with the employees table in the Supabase table editor.
--
-- Idempotent: safe to re-run; renames are skipped if the old name
-- no longer exists.
--
-- Run once against an existing deployment. Fresh deploys built from
-- 001/002/003 alone will already have the new names.
-- ============================================================

alter view if exists whos_in_now rename to employees_whos_in_now;

-- ALTER FUNCTION has no IF EXISTS rename form, so guard it.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'daily_hours'
  ) then
    execute 'alter function public.daily_hours(date, date, text, time, time)
             rename to employees_daily_hours';
  end if;
end $$;

alter table if exists tap_cards rename to employee_cards;

-- Rename associated index, trigger, function, and policies so a fresh
-- deploy from 001/002/003 alone matches an existing-DB rename. Use DO
-- guards because some objects don't support IF EXISTS in their rename
-- form.

do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tap_cards_active_card_uniq'
  ) then
    execute 'alter index public.tap_cards_active_card_uniq rename to employee_cards_active_card_uniq';
  end if;
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'idx_tap_cards_employee'
  ) then
    execute 'alter index public.idx_tap_cards_employee rename to idx_employee_cards_employee';
  end if;
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'idx_tap_cards_card_id'
  ) then
    execute 'alter index public.idx_tap_cards_card_id rename to idx_employee_cards_card_id';
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tap_cards_set_updated_at'
  ) then
    execute 'alter function public.tap_cards_set_updated_at() rename to employee_cards_set_updated_at';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_tap_cards_updated_at'
  ) then
    execute 'alter trigger trg_tap_cards_updated_at on public.employee_cards rename to trg_employee_cards_updated_at';
  end if;
end $$;

-- Rename RLS policies to keep names tidy
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='employee_cards' and policyname='Authenticated users can read tap_cards') then
    execute 'alter policy "Authenticated users can read tap_cards" on public.employee_cards rename to "Authenticated users can read employee_cards"';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='employee_cards' and policyname='Authenticated users can insert tap_cards') then
    execute 'alter policy "Authenticated users can insert tap_cards" on public.employee_cards rename to "Authenticated users can insert employee_cards"';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='employee_cards' and policyname='Authenticated users can update tap_cards') then
    execute 'alter policy "Authenticated users can update tap_cards" on public.employee_cards rename to "Authenticated users can update employee_cards"';
  end if;
end $$;

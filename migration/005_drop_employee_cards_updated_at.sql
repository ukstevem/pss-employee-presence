-- ============================================================
-- Drop the unused updated_at column + its trigger from
-- employee_cards. The trigger was firing on UPDATE and erroring
-- with "record new has no field updated_at" — and nothing in the
-- app reads updated_at anyway. created_at + deactivated_at give
-- us the timeline we care about.
-- Idempotent: each statement is conditional.
-- ============================================================

drop trigger if exists trg_employee_cards_updated_at on employee_cards;
drop trigger if exists trg_tap_cards_updated_at      on employee_cards;

drop function if exists employee_cards_set_updated_at();
drop function if exists tap_cards_set_updated_at();

alter table employee_cards drop column if exists updated_at;

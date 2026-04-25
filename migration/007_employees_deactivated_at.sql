-- ============================================================
-- employees.deactivated_at: temporal tracking of when an employee
-- left, so /hours queries can include them for date ranges that
-- overlap their active period (instead of vanishing the moment
-- active flips false).
--
-- Backfills existing inactive rows using updated_at as a proxy
-- (close enough for test data; manually fix if you have the real
-- leave date). Trigger auto-syncs the column on active toggles
-- so admins don't need to set it by hand.
-- ============================================================

alter table employees
  add column if not exists deactivated_at timestamptz;

update employees
   set deactivated_at = updated_at
 where active = false
   and deactivated_at is null;

create or replace function employees_track_deactivation()
returns trigger language plpgsql as $$
begin
  if old.active = true and new.active = false and new.deactivated_at is null then
    new.deactivated_at := now();
  elsif new.active = true then
    new.deactivated_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_track_deactivation on employees;
create trigger trg_employees_track_deactivation
  before update of active on employees
  for each row execute function employees_track_deactivation();

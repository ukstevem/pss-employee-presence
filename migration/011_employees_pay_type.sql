-- ============================================================
-- employees.pay_type: 'hourly' | 'salaried' (extensible later).
-- Drives the default filter on /hours so the page only surfaces
-- the people whose hours actually need reviewing for payroll.
--
-- Backfill rule: team='office' (case-insensitive) -> 'salaried',
-- everyone else stays 'hourly'. New employee rows default to
-- 'hourly'; flip to 'salaried' as needed via the admin / SQL.
-- ============================================================

alter table employees
  add column if not exists pay_type text not null default 'hourly'
    check (pay_type in ('hourly','salaried'));

update employees
   set pay_type = 'salaried'
 where lower(team) = 'office'
   and pay_type <> 'salaried';

create index if not exists idx_employees_pay_type on employees(pay_type);

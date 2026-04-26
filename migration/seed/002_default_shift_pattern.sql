-- ============================================================
-- Seed: a "Standard 08–17" shift pattern with 30-minute unpaid
-- lunch (Mon-Fri). Useful as the default for shop workers; assign
-- via UPDATE employees SET shift_pattern_id = ... per person, or
-- via the (forthcoming) admin UI.
--
-- Idempotent: re-running is a no-op (employee_shift_pattern.name
-- is unique; each weekday row guarded by ON CONFLICT).
-- ============================================================

with new_pattern as (
  insert into employee_shift_pattern (name, description, paid_lunch, active)
  values ('Standard 08–17', 'Mon–Fri shop default, 30-min unpaid lunch 12:00–12:30', false, true)
  on conflict (name) do update set description = excluded.description
  returning id
)
insert into employee_shift_pattern_day
  (shift_pattern_id, weekday, day_start, day_finish, lunch_start, lunch_finish)
select id, weekday, '08:00'::time, '17:00'::time, '12:00'::time, '12:30'::time
from new_pattern, unnest(array[1,2,3,4,5]) as weekday
on conflict (shift_pattern_id, weekday) do nothing;

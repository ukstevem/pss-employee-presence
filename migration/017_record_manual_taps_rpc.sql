-- ============================================================
-- record_manual_taps: SECURITY DEFINER RPC for the /hours
-- manual-correction modal. Inserts up to two real timecard_events
-- rows (an "in" and/or an "out") for the given employee on the
-- given work_date, attributed to the employee's currently-active
-- employee_cards row, with actor='admin' and a manual-flag
-- raw_payload so they're cleanly distinguishable from reader-
-- emitted taps and the page can render the M telltale.
--
-- Times are interpreted in p_timezone (default Europe/London) so
-- the inserted timestamptz lands at the right UTC instant
-- regardless of where the caller is.
-- ============================================================

create or replace function record_manual_taps(
  p_employee_id uuid,
  p_work_date   date,
  p_in_time     time default null,
  p_out_time    time default null,
  p_reason      text default null,
  p_timezone    text default 'Europe/London'
)
returns int
language plpgsql security definer as $$
declare
  v_card_id  text;
  v_inserted int := 0;
  v_payload  jsonb;
begin
  if p_in_time is null and p_out_time is null then
    return 0;
  end if;

  select card_id into v_card_id
  from employee_cards
  where employee_id = p_employee_id and active = true
  limit 1;

  if v_card_id is null then
    raise exception 'Employee % has no active card; cannot record manual tap', p_employee_id
      using errcode = 'P0001';
  end if;

  v_payload := jsonb_build_object('manual', true);
  if p_reason is not null and length(trim(p_reason)) > 0 then
    v_payload := v_payload || jsonb_build_object('reason', trim(p_reason));
  end if;

  if p_in_time is not null then
    insert into timecard_events
      (ts, site, stream, card_id, device_id, event, actor, topic, raw_payload)
    values
      ((p_work_date + p_in_time)::timestamp at time zone p_timezone,
       'carrwood', 'timecard', v_card_id, 'manual', 'tap', 'admin',
       'admin/manual', v_payload);
    v_inserted := v_inserted + 1;
  end if;

  if p_out_time is not null then
    insert into timecard_events
      (ts, site, stream, card_id, device_id, event, actor, topic, raw_payload)
    values
      ((p_work_date + p_out_time)::timestamp at time zone p_timezone,
       'carrwood', 'timecard', v_card_id, 'manual', 'tap', 'admin',
       'admin/manual', v_payload);
    v_inserted := v_inserted + 1;
  end if;

  return v_inserted;
end;
$$;

grant execute on function record_manual_taps(uuid, date, time, time, text, text)
  to authenticated;

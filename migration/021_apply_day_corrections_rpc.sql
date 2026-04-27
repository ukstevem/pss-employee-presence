-- ============================================================
-- apply_day_corrections: atomic edit-day operation. In one
-- transaction:
--   - mark a set of existing taps as ignored (raw_payload gets a
--     note + optional reason),
--   - un-ignore previously-ignored taps,
--   - optionally insert a new in/out pair attributed to the
--     employee's active card with actor='admin'.
--
-- Returns the count of newly-inserted tap rows. Reason text (if
-- any) is carried into the raw_payload of every row touched, so
-- a future audit can find them.
--
-- SECURITY DEFINER because timecard_events is service_role-only.
-- Supersedes the simpler record_manual_taps RPC for the modal's
-- save flow (record_manual_taps stays in case it's wanted later).
-- ============================================================

create or replace function apply_day_corrections(
  p_employee_id    uuid,
  p_work_date      date,
  p_ignore_tap_ids uuid[]   default array[]::uuid[],
  p_unignore_tap_ids uuid[] default array[]::uuid[],
  p_in_time        time     default null,
  p_out_time       time     default null,
  p_reason         text     default null,
  p_timezone       text     default 'Europe/London'
)
returns int
language plpgsql security definer as $$
declare
  v_card_id     text;
  v_inserted    int := 0;
  v_payload     jsonb;
  v_ignore_pl   jsonb;
begin
  v_payload   := jsonb_build_object('manual', true);
  v_ignore_pl := jsonb_build_object('ignored_via_admin', true);
  if p_reason is not null and length(trim(p_reason)) > 0 then
    v_payload   := v_payload   || jsonb_build_object('reason', trim(p_reason));
    v_ignore_pl := v_ignore_pl || jsonb_build_object('reason', trim(p_reason));
  end if;

  if array_length(p_ignore_tap_ids, 1) > 0 then
    update timecard_events
       set ignored     = true,
           raw_payload = coalesce(raw_payload, '{}'::jsonb) || v_ignore_pl
     where id = any (p_ignore_tap_ids);
  end if;

  if array_length(p_unignore_tap_ids, 1) > 0 then
    update timecard_events
       set ignored     = false,
           raw_payload = coalesce(raw_payload, '{}'::jsonb) - 'ignored_via_admin'
     where id = any (p_unignore_tap_ids);
  end if;

  if p_in_time is not null or p_out_time is not null then
    select card_id into v_card_id
    from employee_cards
    where employee_id = p_employee_id and active = true
    limit 1;

    if v_card_id is null then
      raise exception 'Employee % has no active card; cannot insert manual tap', p_employee_id
        using errcode = 'P0001';
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
  end if;

  return v_inserted;
end;
$$;

grant execute on function apply_day_corrections(uuid, date, uuid[], uuid[], time, time, text, text)
  to authenticated;

-- ============================================================
-- Tighten the card_id uniqueness constraint: a physical card UID
-- should appear in employee_cards at most ONCE, ever. Once a card
-- is deactivated (lost / broken), the same physical card cannot
-- be re-issued — a new card with a new UID must be issued instead.
--
-- The previous partial unique (WHERE active = true) allowed a
-- deactivated card_id to be re-inserted with active=true, which
-- defeated the lost-card policy.
--
-- Will fail if duplicate card_id rows already exist; clean those
-- up first if so.
-- ============================================================

drop index if exists employee_cards_active_card_uniq;

create unique index if not exists employee_cards_card_id_uniq
  on employee_cards (card_id);

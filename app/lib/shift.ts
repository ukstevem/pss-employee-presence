// Single hardcoded shift for v1. Replace these constants (and the matching
// SQL in the daily_hours function) with a shift_patterns table once anyone
// has a schedule different from 08:00–17:00 Mon–Fri.

export const SHIFT_TIMEZONE = "Europe/London" as const;
export const SHIFT_START_LOCAL = "08:00" as const;
export const SHIFT_END_LOCAL = "17:00" as const;
export const WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5]; // ISO Mon..Fri

export type Shift = {
  timezone: string;
  startLocal: string; // "HH:mm" wall clock
  endLocal: string;   // "HH:mm" wall clock
  workingDays: readonly number[];
};

export const DEFAULT_SHIFT: Shift = {
  timezone: SHIFT_TIMEZONE,
  startLocal: SHIFT_START_LOCAL,
  endLocal: SHIFT_END_LOCAL,
  workingDays: WORKING_DAYS,
};

function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export function isWorkingDay(date: Date, shift: Shift = DEFAULT_SHIFT): boolean {
  return shift.workingDays.includes(isoWeekday(date));
}

export function workingDaysBetween(
  start: Date,
  end: Date,
  shift: Shift = DEFAULT_SHIFT,
): Date[] {
  const out: Date[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const finish = new Date(end);
  finish.setHours(0, 0, 0, 0);
  while (cursor <= finish) {
    if (isWorkingDay(cursor, shift)) out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function localTimeOfDay(ts: Date, timezone: string = SHIFT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ts);
}

export function isLateArrival(tapTs: Date, shift: Shift = DEFAULT_SHIFT): boolean {
  return localTimeOfDay(tapTs, shift.timezone) > shift.startLocal;
}

export function isEarlyDeparture(tapTs: Date, shift: Shift = DEFAULT_SHIFT): boolean {
  return localTimeOfDay(tapTs, shift.timezone) < shift.endLocal;
}

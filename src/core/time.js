export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const TIME_ZONE = 'Asia/Muscat';

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TIME_ZONE });
const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TIME_ZONE });

export const ts = (value) => (typeof value === 'number' ? value : Date.parse(value));
export const iso = (ms) => new Date(ms).toISOString();

/** "22 Oct" in Muscat time. */
export function shortDate(value) {
  return dayFmt.format(new Date(ts(value)));
}

/** Hour of day (0–23) in Muscat time. */
export function muscatHour(value) {
  return Number(hourFmt.format(new Date(ts(value))));
}

/** Human duration: "45 min", "5 hours", "9 days". */
export function duration(ms) {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / MINUTE))} min`;
  if (abs < 2 * DAY) {
    const h = Math.round(abs / HOUR);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(abs / DAY);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** "3 days ago" / "in 2 hours". */
export function relative(value, now) {
  const diff = ts(value) - now;
  if (Math.abs(diff) < MINUTE) return 'just now';
  return diff < 0 ? `${duration(diff)} ago` : `in ${duration(diff)}`;
}

/** SLA in words: 48 → "48-hour", 72 → "3-day". */
export function slaWords(hours) {
  return hours % 24 === 0 && hours >= 72 ? `${hours / 24}-day` : `${hours}-hour`;
}

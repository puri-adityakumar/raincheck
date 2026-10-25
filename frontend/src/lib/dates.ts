export function validTimezone(timezone: string): boolean {
  if (!timezone.trim() || /^[+-]/.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function browserTimezone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validTimezone(zone) ? zone : 'UTC';
}

/** Calendar day in the chosen zone, not the browser's or UTC's day. */
export function todayIn(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && addDays(date, 0) === date;
}

export function displayDate(date: string): string {
  if (!validDate(date)) return date || 'Choose a day';
  return new Intl.DateTimeFormat('en', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function displayTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(date) + ' UTC';
}

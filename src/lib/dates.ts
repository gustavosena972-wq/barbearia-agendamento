import { addDays, format, startOfDay } from 'date-fns'

/** Próximos N dias (incluindo hoje) em YYYY-MM-DD no fuso local. */
export function upcomingDates(days = 21): string[] {
  const out: string[] = []
  const base = startOfDay(new Date())
  for (let i = 0; i < days; i++) {
    out.push(format(addDays(base, i), 'yyyy-MM-dd'))
  }
  return out
}

export function toDateInputValue(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

import type { ISODate, MonthKey } from './types'
import { isHoliday } from './holidays'

export function toISO(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return toISO(parseISO(s)) === s
}

export function today(): ISODate {
  return toISO(new Date())
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISO(date)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

/**
 * Tarihe n ay ekler; gün, hedef ayın son gününe kırpılır.
 * 31 Ocak + 1 ay = 28/29 Şubat, 31 Ocak + 2 ay = 31 Mart.
 *
 * Tekrarlayan vadeler HER ZAMAN başlangıç tarihinden hesaplanmalıdır:
 * addMonths(start, n). Bir önceki sonuca ekleme yapmak (zincirleme) 31'ini
 * 28'ine kaydırır ve bir daha geri getirmez.
 */
export function addMonths(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const idx = y * 12 + (m - 1) + n
  const ty = Math.floor(idx / 12)
  const tm = (idx % 12) + 1
  const td = Math.min(d, daysInMonth(ty, tm))
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`
}

export function monthKey(date: ISODate): MonthKey {
  return date.slice(0, 7)
}

export function addMonthKey(key: MonthKey, n: number): MonthKey {
  return addMonths(`${key}-01`, n).slice(0, 7)
}

export function monthRange(key: MonthKey): { from: ISODate; to: ISODate } {
  const [y, m] = key.split('-').map(Number) as [number, number]
  return { from: `${key}-01`, to: `${key}-${String(daysInMonth(y, m)).padStart(2, '0')}` }
}

/** Ayın belirli günü (ay sonunu aşarsa son güne kırpılır). */
export function dayOfMonth(key: MonthKey, day: number): ISODate {
  const [y, m] = key.split('-').map(Number) as [number, number]
  return `${key}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`
}

export function monthsBetween(a: MonthKey, b: MonthKey): number {
  const [ay, am] = a.split('-').map(Number) as [number, number]
  const [by, bm] = b.split('-').map(Number) as [number, number]
  return (by - ay) * 12 + (bm - am)
}

/** Haftanın pazartesisi. */
export function startOfWeek(date: ISODate): ISODate {
  const d = parseISO(date)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return toISO(d)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)
}

export function isWeekend(date: ISODate): boolean {
  const day = parseISO(date).getDay()
  return day === 0 || day === 6
}

export function isBusinessDay(date: ISODate): boolean {
  return !isWeekend(date) && !isHoliday(date)
}

/** Tatil veya hafta sonuysa sonraki ilk iş günü. */
export function nextBusinessDay(date: ISODate): ISODate {
  let d = date
  for (let i = 0; i < 15 && !isBusinessDay(d); i++) d = addDays(d, 1)
  return d
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b
}
export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b
}

// ---- Biçimlendirme ----

export function fmtDayShort(date: ISODate): string {
  return parseISO(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })
}

export function fmtDate(date: ISODate): string {
  if (!date) return '—'
  return parseISO(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function fmtDateNumeric(date: ISODate): string {
  if (!date) return ''
  const [y, m, d] = date.split('-')
  return `${d}.${m}.${y}`
}

export function fmtWeekRange(weekStart: ISODate): string {
  const a = parseISO(weekStart).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
  const b = parseISO(addDays(weekStart, 6)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
  return `${a} – ${b}`
}

export function fmtMonth(key: MonthKey): string {
  return parseISO(`${key}-01`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
}

export function fmtMonthShort(key: MonthKey): string {
  return parseISO(`${key}-01`).toLocaleDateString('tr-TR', { month: 'short' })
}

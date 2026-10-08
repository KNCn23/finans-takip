import type { ISODate } from './types'

// Türkiye resmi tatilleri (tam gün). Arife yarım günleri bankalar çalıştığı
// için dahil değildir. Dini bayram tarihleri Diyanet takvimine göredir;
// 2028 ve sonrası astronomik hesaba dayalı tahmindir, ±1 gün sapabilir.

const FIXED = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']

const RELIGIOUS: Record<number, ISODate[]> = {
  2024: ['2024-04-10', '2024-04-11', '2024-04-12', '2024-06-16', '2024-06-17', '2024-06-18', '2024-06-19'],
  2025: ['2025-03-30', '2025-03-31', '2025-04-01', '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-09'],
  2026: ['2026-03-20', '2026-03-21', '2026-03-22', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30'],
  2027: ['2027-03-09', '2027-03-10', '2027-03-11', '2027-05-16', '2027-05-17', '2027-05-18', '2027-05-19'],
  2028: ['2028-02-26', '2028-02-27', '2028-02-28', '2028-05-05', '2028-05-06', '2028-05-07', '2028-05-08'],
  2029: ['2029-02-14', '2029-02-15', '2029-02-16', '2029-04-24', '2029-04-25', '2029-04-26', '2029-04-27'],
  2030: ['2030-02-04', '2030-02-05', '2030-02-06', '2030-04-13', '2030-04-14', '2030-04-15', '2030-04-16'],
}

const religiousSet = new Set(Object.values(RELIGIOUS).flat())

export function isHoliday(date: ISODate): boolean {
  return FIXED.includes(date.slice(5)) || religiousSet.has(date)
}

export const HOLIDAY_DATA_YEARS = Object.keys(RELIGIOUS).map(Number)

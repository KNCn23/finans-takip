import { describe, expect, it } from 'vitest'
import { addMonths, isBusinessDay, nextBusinessDay, startOfWeek } from '../src/domain/dates'
import { paymentScheduledDates } from '../src/domain/occurrences'
import type { Payment } from '../src/domain/types'

describe('addMonths', () => {
  it('ay sonuna kırpar ama sonraki aylarda geri döner', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
  })
})

describe('aylık tekrar kayması (eski hata)', () => {
  const rent: Payment = {
    id: 'p', companyId: 'c', type: 'out', title: 'Kira', category: 'Kira', currency: 'TRY',
    amount: 100, date: '2026-01-31', recurrence: 'monthly', exceptions: {},
  }
  it('31 Ocak kirası 28 Şubat sonrasında tekrar 31 Mart olur', () => {
    expect(paymentScheduledDates(rent, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ])
  })
  it('aralık ortadan başlasa da aynı tarihler', () => {
    expect(paymentScheduledDates(rent, '2026-04-01', '2026-05-31')).toEqual(['2026-04-30', '2026-05-31'])
  })
  it('bitiş tarihine uyar', () => {
    expect(paymentScheduledDates({ ...rent, endDate: '2026-03-31' }, '2026-01-01', '2026-12-31')).toHaveLength(3)
  })
  it('haftalık tekrar', () => {
    const w = { ...rent, date: '2026-01-05', recurrence: 'weekly' as const }
    expect(paymentScheduledDates(w, '2026-01-10', '2026-01-31')).toEqual(['2026-01-12', '2026-01-19', '2026-01-26'])
  })
})

describe('iş günü kaydırma', () => {
  it('hafta sonu → pazartesi', () => {
    expect(nextBusinessDay('2026-10-10')).toBe('2026-10-12') // Cumartesi
  })
  it('resmi tatil: 29 Ekim 2026 Perşembe → 30 Ekim', () => {
    expect(isBusinessDay('2026-10-29')).toBe(false)
    expect(nextBusinessDay('2026-10-29')).toBe('2026-10-30')
  })
  it('Kurban Bayramı 2026 (27-30 Mayıs) → 1 Haziran Pazartesi', () => {
    expect(nextBusinessDay('2026-05-27')).toBe('2026-06-01')
  })
  it('iş günü değişmez', () => {
    expect(nextBusinessDay('2026-10-08')).toBe('2026-10-08')
  })
  it('haftanın pazartesisi', () => {
    expect(startOfWeek('2026-10-08')).toBe('2026-10-05')
  })
})

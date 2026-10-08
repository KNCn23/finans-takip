import { describe, expect, it } from 'vitest'
import { annuityPayment, impliedAnnualRate, loanKey, loanSchedule, loanSummary } from '../src/domain/loans'
import { generateOccurrences } from '../src/domain/occurrences'
import { loan, stateWith } from './helpers'

describe('anüite ve faiz', () => {
  it('100.000 TL, yıllık %36, 12 ay ≈ 10.046,22 TL taksit', () => {
    expect(annuityPayment(10000000, 36, 12)).toBe(1004621)
  })
  it('taksit tutarından faiz oranını geri bulur', () => {
    const rate = impliedAnnualRate(10000000, 1004621, 12)!
    expect(rate).toBeCloseTo(36, 1)
  })
  it('anapara biliniyorsa son taksitte kalan anapara ~0', () => {
    const l = loan({ principal: 10000000, installmentAmount: 1004621, annualRate: 36 })
    const sch = loanSchedule(l, {})
    expect(sch[11]!.remainingPrincipal).toBeLessThanOrEqual(12)
    expect(sch[0]!.interest).toBe(300000)
  })
})

describe('kalan borç etiketi (eski hata)', () => {
  it('kalan taksit toplamı ile kalan anapara ayrı', () => {
    const l = loan({ principal: 10000000, installmentAmount: 1004621, annualRate: 36 })
    const settled = { [loanKey('l1', 1)]: { key: loanKey('l1', 1), date: '2026-01-15', amount: 1004621, currency: 'TRY' as const } }
    const s = loanSummary(l, loanSchedule(l, settled))
    expect(s.remainingInstallmentsTotal).toBe(1004621 * 11)
    expect(s.remainingPrincipal).toBeLessThan(s.remainingInstallmentsTotal)
    expect(s.remainingPrincipal).toBe(10000000 - (1004621 - 300000))
  })
})

describe('değişken taksit ve erken kapama', () => {
  it('farklı tutarlı taksit', () => {
    const l = loan({ installmentOverrides: { 3: 150000 } })
    expect(loanSchedule(l, {})[2]!.amount).toBe(150000)
  })
  it('erken kapama sonraki taksitleri takvimden kaldırır', () => {
    const l = loan({ earlyClosure: { date: '2026-04-20', amount: 700000, afterInstallment: 3 } })
    const occ = generateOccurrences(stateWith({ loans: [l] }), '2026-01-01', '2027-12-31')
    expect(occ.filter((o) => o.subtitle.includes('Taksit'))).toHaveLength(3)
    expect(occ.find((o) => o.key === loanKey('l1', 'payoff'))?.amount).toBe(700000)
    const sum = loanSummary(l, loanSchedule(l, {}))
    expect(sum.closed).toBe(true)
  })
})

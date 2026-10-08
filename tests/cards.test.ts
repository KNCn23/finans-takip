import { describe, expect, it } from 'vitest'
import { cardKey, cardStatements, cardSummary, periodForDate, statementCloseDate } from '../src/domain/cards'
import { generateOccurrences, overdueOccurrences } from '../src/domain/occurrences'
import type { CardExpense } from '../src/domain/types'
import { card, stateWith } from './helpers'

const exp = (p: Partial<CardExpense>): CardExpense => ({
  id: 'e' + Math.random(), cardId: 'k1', date: '2026-10-05', category: 'Yemek', title: '', amount: 10000, installments: 1, countsToStatement: true, ...p,
})

describe('ekstre dönemi', () => {
  it('kesim 1 / ödeme 11: kesimden sonraki harcama sonraki aya düşer', () => {
    const c = card({ statementDay: 1, dueDay: 11 })
    expect(periodForDate(c, '2026-10-01')).toBe('2026-10') // kesim günü dahil
    expect(periodForDate(c, '2026-10-02')).toBe('2026-11')
    expect(statementCloseDate(c, '2026-11')).toBe('2026-11-01')
  })
  it('kesim 18 / ödeme 8: ekstre önceki ay kesilir', () => {
    const c = card({ statementDay: 18, dueDay: 8 })
    expect(periodForDate(c, '2026-10-10')).toBe('2026-11') // 18 Eki kesimi → 8 Kas ödeme
    expect(periodForDate(c, '2026-10-20')).toBe('2026-12')
    expect(statementCloseDate(c, '2026-11')).toBe('2026-10-18')
  })
})

describe('taksitli alışveriş', () => {
  it('6 taksit 6 ayrı döneme bölünür, toplam korunur', () => {
    const c = card()
    const st = cardStatements(c, [exp({ amount: 100000, installments: 6, date: '2026-10-05' })], {})
    expect(st.map((s) => s.period)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'])
    expect(st.reduce((t, s) => t + s.amount, 0)).toBe(100000)
  })
})

describe('ödeme sonrası borç (eski hata)', () => {
  it('ödenen ekstre toplam borçtan düşer, sonraki ay aynı tutar tekrarlanmaz', () => {
    const c = card({ openingDebt: 218000, openingPeriod: '2026-10' })
    const settled = { [cardKey('k1', '2026-10')]: { key: cardKey('k1', '2026-10'), date: '2026-10-11', amount: 218000, currency: 'TRY' as const } }
    const st = cardStatements(c, [], settled)
    const sum = cardSummary(c, st, '2026-10-15')
    expect(sum.totalUnpaid).toBe(0)
    const s = stateWith({ cards: [c], settlements: settled })
    const nov = generateOccurrences(s, '2026-11-01', '2026-12-31')
    expect(nov).toHaveLength(0) // eski sürüm her ay 218.000 "tahmini" gösteriyordu
  })
})

describe('geçmiş ayın ödenmemiş ekstresi (eski hata)', () => {
  it('ay dönünce kaybolmaz, gecikmiş olarak kalır', () => {
    const c = card({ openingDebt: 50000, openingPeriod: '2026-09' })
    const s = stateWith({ cards: [c] })
    const overdue = overdueOccurrences(s, '2026-10-08')
    expect(overdue.map((o) => o.key)).toEqual([cardKey('k1', '2026-09')])
  })
})

describe('gerçek ekstre tutarı', () => {
  it('girilen tutar hesaplananın yerine geçer', () => {
    const c = card({ statementOverrides: { '2026-11': 77700 } })
    const st = cardStatements(c, [exp({ amount: 10000 })], {})
    expect(st[0]).toMatchObject({ period: '2026-11', computed: 10000, amount: 77700, overridden: true })
  })
})

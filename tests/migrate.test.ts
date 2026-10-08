import { describe, expect, it } from 'vitest'
import { migrate, remapDriftedDate } from '../src/domain/migrate'
import { monthKey, today, addMonths } from '../src/domain/dates'
import { cardKey } from '../src/domain/cards'
import { loanKey } from '../src/domain/loans'
import { chequeKey, paymentKey } from '../src/domain/occurrences'

const ym = monthKey(today())

/** İlk sürümün localStorage'a yazdığı biçimde örnek veri. */
const v1 = {
  companies: [{ id: 'A', name: 'Demir İnşaat' }],
  activeCompanyId: 'A',
  accounts: [
    { id: 'acc1', companyId: 'A', name: 'Ziraat Vadesiz', balance: 1250000.5 },
    { id: 'acc2', companyId: 'A', name: 'Merkez Kasa', balance: 85000 },
  ],
  budgets: [{ id: 'b1', companyId: 'A', category: 'yakıt', limit: 150000 }],
  loans: [
    { id: 'L', companyId: 'A', name: 'Makine', bank: 'Ziraat', installmentAmount: 385000, installmentCount: 36, firstDueDate: '2026-01-15', paidInstallments: [1, 2, 3] },
  ],
  cards: [
    { id: 'K', companyId: 'A', name: 'Bonus', bank: 'Garanti', limit: 750000, statementDay: 1, dueDay: 11, currentDebt: 218000, paidPeriods: [] },
  ],
  cardExpenses: [{ id: 'E', cardId: 'K', date: '2026-10-01', category: 'Yakıt', title: 'Yakıt', amount: 42000, addedToDebt: true }],
  payments: [
    { id: 'P', companyId: 'A', type: 'out', title: 'Kira', category: 'Kira', amount: 95000, date: '2026-01-31', recurrence: 'monthly', paidDates: ['2026-01-31', '2026-02-28', '2026-03-28'] },
    { id: 'Q', companyId: 'A', type: 'in', title: 'Hakediş', category: 'Satış', amount: 1450000, date: '2026-10-15', recurrence: 'once', paidDates: [] },
  ],
  contacts: [{ id: 'C', companyId: 'A', name: 'Yılmaz', type: 'customer', phone: '', email: '', note: '' }],
  cheques: [
    { id: 'Ch', companyId: 'A', type: 'received', bank: 'Akbank', number: '0451208', contactId: 'C', description: '', amount: 850000, dueDate: '2026-09-01', status: 'cleared' },
  ],
}

describe('v1 → v2 geçişi', () => {
  const { state, report } = migrate(structuredClone(v1))

  it('hiçbir kayıt kaybolmaz', () => {
    expect(report.from).toBe(1)
    expect(state.companies).toHaveLength(1)
    expect(state.accounts).toHaveLength(2)
    expect(state.loans).toHaveLength(1)
    expect(state.cards).toHaveLength(1)
    expect(state.cardExpenses).toHaveLength(1)
    expect(state.payments).toHaveLength(2)
    expect(state.contacts).toHaveLength(1)
    expect(state.cheques).toHaveLength(1)
  })

  it('tutarlar kuruşa çevrilir', () => {
    expect(state.accounts[0]!.balance).toBe(125000050)
    expect(state.loans[0]!.installmentAmount).toBe(38500000)
  })

  it('ödendi işaretleri korunur', () => {
    expect(state.settlements[loanKey('L', 3)]).toBeDefined()
    expect(state.settlements[loanKey('L', 4)]).toBeUndefined()
    expect(state.settlements[chequeKey('Ch')]).toBeDefined()
  })

  it('kaymış aylık vadeler doğru tarihe taşınır (28 Mart → 31 Mart)', () => {
    expect(state.settlements[paymentKey('P', '2026-03-31')]).toBeDefined()
    expect(state.settlements[paymentKey('P', '2026-03-28')]).toBeUndefined()
    expect(report.remappedPaidDates).toBe(1)
  })

  it('kart borcu çift sayılmaz: eski harcamalar ekstreye eklenmez', () => {
    expect(state.cards[0]!.openingDebt).toBe(21800000)
    expect(state.cards[0]!.openingPeriod).toBe(ym)
    expect(state.cardExpenses[0]!.countsToStatement).toBe(false)
  })

  it('kategoriler büyük/küçük harf farkı gözetmeden birleşir', () => {
    expect(state.budgets[0]!.category).toBe('Yakıt')
    expect(state.categories.filter((c) => c.name.toLocaleLowerCase('tr') === 'yakıt')).toHaveLength(1)
  })

  it('bu ayı ödenmiş kart bir sonraki döneme taşınır', () => {
    const paid = migrate({ ...structuredClone(v1), cards: [{ ...v1.cards[0], paidPeriods: [ym] }] }).state
    expect(paid.cards[0]!.openingPeriod).toBe(addMonths(`${ym}-01`, 1).slice(0, 7))
    expect(paid.settlements[cardKey('K', ym)]).toBeDefined()
  })

  it('en eski sürümdeki "cash" alanı hesaba dönüşür', () => {
    const s = migrate({ cash: 5000 }).state
    expect(s.accounts[0]).toMatchObject({ name: 'Ana Hesap', balance: 500000 })
  })

  it('v2 tekrar geçirilince değişmez', () => {
    const again = migrate(JSON.parse(JSON.stringify(state))).state
    expect(again).toEqual(state)
  })

  it('geçersiz veride hata fırlatır (sessizce boşaltmaz)', () => {
    expect(() => migrate(null)).toThrow()
    expect(() => migrate([1, 2])).toThrow()
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/daha yeni/)
  })
})

describe('remapDriftedDate', () => {
  it('eski zincirleme dizideki k. vadeyi yeni dizideki k. vadeye eşler', () => {
    expect(remapDriftedDate('2026-01-31', '2026-04-28')).toBe('2026-04-30')
    expect(remapDriftedDate('2026-01-15', '2026-04-15')).toBe('2026-04-15')
  })
})

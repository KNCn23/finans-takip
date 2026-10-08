import { describe, expect, it } from 'vitest'
import * as A from '../src/store/actions'
import { generateOccurrences } from '../src/domain/occurrences'
import { loanKey } from '../src/domain/loans'
import type { Account, Cheque } from '../src/domain/types'
import { loan, payment, stateWith } from './helpers'

const acc = (p: Partial<Account> = {}): Account => ({ id: 'a1', companyId: 'c', name: 'Vadesiz', kind: 'bank', currency: 'TRY', balance: 1000000, ...p })

describe('ödendi işareti hesap bakiyesini günceller (eski hata)', () => {
  const s0 = stateWith({ accounts: [acc()], payments: [payment({ id: 'p', amount: 250000, date: '2026-10-01', recurrence: 'once' })] })
  const occ = generateOccurrences(s0, '2026-10-01', '2026-10-31')[0]!

  it('hesap seçilince bakiye düşer ve hareket kaydı oluşur', () => {
    const s1 = A.settle(s0, occ, { date: '2026-10-01', amount: 250000, accountId: 'a1' })
    expect(s1.accounts[0]!.balance).toBe(750000)
    expect(s1.accountTx).toHaveLength(1)
    expect(s1.settlements[occ.key]?.txId).toBe(s1.accountTx[0]!.id)
  })
  it('işaret kaldırılınca bakiye geri gelir', () => {
    const s1 = A.settle(s0, occ, { date: '2026-10-01', amount: 250000, accountId: 'a1' })
    const s2 = A.unsettle(s1, occ.key)
    expect(s2.accounts[0]!.balance).toBe(1000000)
    expect(s2.accountTx).toHaveLength(0)
  })
  it('farklı tutar ödenebilir (fatura bu ay farklı geldi)', () => {
    const s1 = A.settle(s0, occ, { date: '2026-10-02', amount: 270000, accountId: 'a1' })
    expect(s1.accounts[0]!.balance).toBe(730000)
    expect(generateOccurrences(s1, '2026-10-01', '2026-10-31')[0]!.amount).toBe(270000)
  })
  it('dövizli vade TL hesaptan kurla düşülür', () => {
    const s = stateWith({
      accounts: [acc()],
      payments: [payment({ id: 'u', currency: 'USD', amount: 10000, date: '2026-10-01', recurrence: 'once' })],
      settings: { rates: { TRY: 1, USD: 40, EUR: 0, GBP: 0, XAU: 0 } } as never,
    })
    const o = generateOccurrences(s, '2026-10-01', '2026-10-31')[0]!
    expect(A.settle(s, o, { date: '2026-10-01', amount: 10000, accountId: 'a1' }).accounts[0]!.balance).toBe(1000000 - 400000)
  })
})

describe('virman', () => {
  it('iki hesap arasında, silinince iki taraf birden geri alınır', () => {
    const s = stateWith({ accounts: [acc(), acc({ id: 'a2', name: 'Kasa', balance: 0 })] })
    const t = A.transfer(s, { fromId: 'a1', toId: 'a2', amountFrom: 300000, amountTo: 300000, date: '2026-10-08', note: '' })
    expect(t.accounts.map((a) => a.balance)).toEqual([700000, 300000])
    const back = A.deleteAccountTx(t, t.accountTx[0]!.id)
    expect(back.accounts.map((a) => a.balance)).toEqual([1000000, 0])
  })
})

describe('bakiye düzeltmesi', () => {
  it('elle değişen bakiye hareket olarak kaydedilir', () => {
    const s = A.saveAccount(stateWith({ accounts: [acc()] }), { ...acc(), balance: 1200000 }, 'c')
    expect(s.accounts[0]!.balance).toBe(1200000)
    expect(s.accountTx[0]).toMatchObject({ amount: 200000, kind: 'adjust' })
  })
})

describe('çek ciro', () => {
  const ch: Cheque = {
    id: 'ch', companyId: 'c', instrument: 'cheque', type: 'received', bank: 'Akbank', number: '1', description: '', currency: 'TRY',
    amount: 500000, dueDate: '2026-11-01', status: 'pending', history: [],
  }
  it('ciro edilen çek nakit akışından çıkar, geçmişe yazılır', () => {
    const s = A.setChequeStatus(stateWith({ cheques: [ch] }), 'ch', 'endorsed', { date: '2026-10-08', endorsedTo: 'sup' })
    expect(s.cheques[0]).toMatchObject({ status: 'endorsed', endorsedToContactId: 'sup' })
    expect(s.cheques[0]!.history.at(-1)?.status).toBe('endorsed')
    expect(generateOccurrences(s, '2026-10-01', '2026-12-31')).toHaveLength(0)
  })
  it('cari seçilmeden ciro edilemez', () => {
    expect(() => A.setChequeStatus(stateWith({ cheques: [ch] }), 'ch', 'endorsed', { date: '2026-10-08' })).toThrow()
  })
  it('tahsil edilince hesaba girer', () => {
    const s = A.setChequeStatus(stateWith({ accounts: [acc()], cheques: [ch] }), 'ch', 'cleared', { date: '2026-11-01', accountId: 'a1' })
    expect(s.accounts[0]!.balance).toBe(1500000)
    expect(s.cheques[0]!.status).toBe('cleared')
  })
})

describe('erken kapama', () => {
  it('kapama tutarı hesaptan düşer, sonraki taksitler kalkar; geri alınabilir', () => {
    const s0 = stateWith({ accounts: [acc({ balance: 5000000 })], loans: [loan()] })
    const s1 = A.closeLoanEarly(s0, 'l1', { date: '2026-03-01', amount: 900000, accountId: 'a1' })
    expect(s1.accounts[0]!.balance).toBe(4100000)
    expect(s1.loans[0]!.earlyClosure?.afterInstallment).toBe(0)
    expect(s1.settlements[loanKey('l1', 'payoff')]).toBeDefined()
    const s2 = A.reopenLoan(s1, 'l1')
    expect(s2.accounts[0]!.balance).toBe(5000000)
    expect(s2.loans[0]!.earlyClosure).toBeUndefined()
  })
})

describe('kategoriler', () => {
  it('yeniden adlandırma bütün kayıtlara yansır', () => {
    let s = stateWith({ payments: [payment({ category: 'fatura' })] })
    const id = s.categories.find((c) => c.name === 'Fatura')!.id
    s = A.renameCategory(s, id, 'Faturalar')
    expect(s.payments[0]!.category).toBe('Faturalar')
  })
  it('aynı ada yeniden adlandırma engellenir', () => {
    const s = stateWith({})
    const id = s.categories.find((c) => c.name === 'Fatura')!.id
    expect(() => A.renameCategory(s, id, 'market')).toThrow()
  })
})

describe('banka ekstresi', () => {
  it('satırlar gerçekleşmiş kayıt olur; isteğe bağlı bakiye güncellenir', () => {
    const s = stateWith({ accounts: [acc()] })
    const items = [
      { date: '2026-10-01', description: 'Market', amount: -50000, category: 'Market' },
      { date: '2026-10-02', description: 'Maaş', amount: 4500000, category: 'Maaş' },
    ]
    const without = A.importBankRows(s, 'a1', items, false)
    expect(without.payments).toHaveLength(2)
    expect(without.accounts[0]!.balance).toBe(1000000)
    expect(Object.values(without.settlements)).toHaveLength(2)
    const withBal = A.importBankRows(s, 'a1', items, true)
    expect(withBal.accounts[0]!.balance).toBe(1000000 - 50000 + 4500000)
  })
})

describe('şirket silme', () => {
  it('şirkete bağlı her şey ve ödendi kayıtları silinir, diğer şirket kalır', () => {
    let s = stateWith({})
    s = A.saveCompany(s, { name: 'B' })
    const b = s.companies[1]!.id
    const a = s.companies[0]!.id
    s = A.saveLoan(s, { ...loan(), id: undefined, companyId: b }, b)
    s = A.saveLoan(s, { ...loan(), id: undefined, companyId: a }, a)
    const delLoanId = s.loans.find((l) => l.companyId === b)!.id
    s = { ...s, settlements: { [loanKey(delLoanId, 1)]: { key: loanKey(delLoanId, 1), date: '2026-01-15', amount: 1, currency: 'TRY' } } }
    const after = A.deleteCompany(s, b)
    expect(after.loans).toHaveLength(1)
    expect(after.settlements).toEqual({})
  })
})

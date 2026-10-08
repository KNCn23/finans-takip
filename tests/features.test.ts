import { describe, expect, it } from 'vitest'
import { contactLedger, isValidEmail, isValidPhone } from '../src/domain/contacts'
import { budgetStatus, periodReport, weeklyForecast } from '../src/domain/analytics'
import { buildRows, guessMapping, parseDateCell, parseDelimited, isDuplicate } from '../src/domain/bankImport'
import { exportExcel, importExcel, fromJsonBackup, toJsonBackup } from '../src/domain/backup'
import { demoState } from '../src/domain/demo'
import { paymentKey } from '../src/domain/occurrences'
import type { Contact } from '../src/domain/types'
import { payment, stateWith } from './helpers'

const contact: Contact = { id: 'C', companyId: 'c', name: 'Yılmaz', type: 'customer', phone: '', email: '', taxNo: '', note: '', openingBalance: 100000 }

describe('cari ekstre', () => {
  it('tekrarlayan kayıtlar ve açılış bakiyesi dahil (eski sürüm saymıyordu)', () => {
    const s = stateWith({
      contacts: [contact],
      payments: [payment({ contactId: 'C', type: 'in', amount: 50000, date: '2026-08-10', recurrence: 'monthly', endDate: '2026-10-10' })],
    })
    const { balance, entries } = contactLedger(s, contact, '2026-09-15')
    expect(entries.filter((e) => e.kind === 'Tahsilat')).toHaveLength(3)
    expect(balance.overdueReceivable).toBe(100000) // Ağu + Eyl
    expect(balance.upcomingReceivable).toBe(50000) // Eki
    expect(balance.net).toBe(100000 + 150000)
  })
  it('ödenen kalem bakiyeden düşer', () => {
    const s = stateWith({
      contacts: [contact],
      payments: [payment({ id: 'x', contactId: 'C', type: 'in', amount: 50000, date: '2026-08-10', recurrence: 'once' })],
      settlements: { [paymentKey('x', '2026-08-10')]: { key: paymentKey('x', '2026-08-10'), date: '2026-08-10', amount: 50000, currency: 'TRY' } },
    })
    expect(contactLedger(s, contact, '2026-09-15').balance.net).toBe(100000)
  })
  it('e-posta ve telefon doğrulama', () => {
    expect(isValidEmail('muhasebe@firma.com.tr')).toBe(true)
    expect(isValidEmail('muhasebe@')).toBe(false)
    expect(isValidPhone('0212 555 10 20')).toBe(true)
    expect(isValidPhone('+90 532 123 45 67')).toBe(true)
    expect(isValidPhone('12345')).toBe(false)
  })
})

describe('bütçe', () => {
  it('kategori eşleşmesi büyük/küçük harf ve boşluk duyarsız', () => {
    const s = stateWith({
      budgets: [{ id: 'b', companyId: 'c', category: 'Fatura', limit: 100000, period: 'monthly', rollover: false, startMonth: '2026-10' }],
      payments: [payment({ category: '  fatura ', amount: 90000, date: '2026-10-05', recurrence: 'once' })],
    })
    const st = budgetStatus(s, s.budgets[0]!, '2026-10', '2026-10-08')
    expect(st.total).toBe(90000)
    expect(st.level).toBe('warn')
  })
  it('devreden bütçe: kullanılmayan tutar sonraki aya eklenir', () => {
    const s = stateWith({
      budgets: [{ id: 'b', companyId: 'c', category: 'Bakım', limit: 100000, period: 'monthly', rollover: true, startMonth: '2026-08' }],
      payments: [payment({ category: 'Bakım', amount: 30000, date: '2026-08-05', recurrence: 'once' })],
    })
    const st = budgetStatus(s, s.budgets[0]!, '2026-10', '2026-10-08')
    expect(st.carry).toBe(70000 + 100000)
    expect(st.available).toBe(270000)
  })
})

describe('raporlar: gerçekleşen / planlanan ayrımı (eski hata)', () => {
  it('ödenmemiş planlı kalem "planlanan" sayılır', () => {
    const s = stateWith({
      payments: [
        payment({ id: 'a', amount: 1000, date: '2026-10-01', recurrence: 'once' }),
        payment({ id: 'b', amount: 2000, date: '2026-10-20', recurrence: 'once' }),
      ],
      settlements: { [paymentKey('a', '2026-10-01')]: { key: paymentKey('a', '2026-10-01'), date: '2026-10-01', amount: 1000, currency: 'TRY' } },
    })
    const r = periodReport(s, '2026-10-01', '2026-10-31', '2026-10-08')
    expect(r.expenseRealized).toBe(1000)
    expect(r.expensePlanned).toBe(2000)
  })
})

describe('nakit akışı', () => {
  it('ödenmemiş vadeler tahmini bakiyeyi düşürür, vadeli mevduat hariç', () => {
    const s = stateWith({
      accounts: [
        { id: 'a', companyId: 'c', name: 'Vadesiz', kind: 'bank', currency: 'TRY', balance: 1000000 },
        { id: 'd', companyId: 'c', name: 'Vadeli', kind: 'deposit', currency: 'TRY', balance: 9999999 },
      ],
      payments: [payment({ amount: 300000, date: '2026-10-09', recurrence: 'once' })],
    })
    const f = weeklyForecast(s, 2, '2026-10-08')
    expect(f.weeks[0]!.projected).toBe(700000)
  })
})

describe('banka ekstresi içe aktarma', () => {
  const csv = [
    'Hesap Hareketleri;;;',
    'Tarih;Açıklama;Tutar;Bakiye',
    '01.10.2026;MARKET ALIŞVERİŞİ;-1.250,50;10.000,00',
    '02.10.2026;MAAŞ;45.000,00;55.000,00',
    '03/10/2026;HATALI;abc;0',
  ].join('\r\n')

  it('CSV ayırıcıyı ve başlık satırını bulur', () => {
    const rows = parseDelimited(csv)
    const m = guessMapping(rows)
    expect(m).toMatchObject({ headerRow: 1, date: 0, description: 1, amount: 2 })
    const out = buildRows(rows, m)
    expect(out[0]).toMatchObject({ date: '2026-10-01', amount: -125050 })
    expect(out[1]).toMatchObject({ date: '2026-10-02', amount: 4500000 })
    expect(out[2]!.error).toBe('Tutar okunamadı')
  })
  it('ayrı borç/alacak sütunları', () => {
    const rows = [['Tarih', 'Açıklama', 'Borç', 'Alacak'], ['2026-10-05', 'Fatura', '500,00', ''], ['2026-10-06', 'Tahsilat', '', '1.000']]
    const out = buildRows(rows, guessMapping(rows))
    expect(out.map((r) => r.amount)).toEqual([-50000, 100000])
  })
  it('tarih biçimleri', () => {
    expect(parseDateCell('31.12.26')).toBe('2026-12-31')
    expect(parseDateCell(46297)).toBe('2026-10-02')
    expect(parseDateCell('31.02.2026')).toBeNull()
  })
  it('mükerrer kayıt tespiti', () => {
    const p = payment({ title: 'MAAŞ', type: 'in', amount: 4500000, date: '2026-10-02', recurrence: 'once' })
    expect(isDuplicate({ index: 1, date: '2026-10-02', description: 'maaş', amount: 4500000 }, [p])).toBe(true)
  })
})

describe('yedekler', () => {
  it('Excel dışa → içe aktarma kayıpsız', () => {
    const s = demoState()
    const back = importExcel(exportExcel(s)).state
    expect(back).toEqual(s)
  })
  it('JSON dışa → içe aktarma kayıpsız', () => {
    const s = demoState()
    expect(fromJsonBackup(toJsonBackup(s)).state).toEqual(s)
  })
  it('bozuk JSON anlaşılır hata verir', () => {
    expect(() => fromJsonBackup('{bozuk')).toThrow(/JSON/)
  })
})

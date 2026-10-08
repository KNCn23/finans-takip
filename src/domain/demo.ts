import type { State } from './types'
import { addDays, addMonths, monthKey, today } from './dates'
import { defaultCategories, defaultSettings, newId } from './defaults'
import { loanKey } from './loans'
import { paymentKey } from './occurrences'

const tl = (v: number) => Math.round(v * 100)

/** "Örnek Verilerle Dene" için gerçekçi bir holding verisi. */
export function demoState(): State {
  const t = today()
  const ym = monthKey(t)
  const a = { id: newId(), name: 'Demir İnşaat A.Ş.' }
  const b = { id: newId(), name: 'Demir Enerji Ltd.' }
  const [card1, card2, c1, c2, c3, loan1, loan2, pay1, pay2] = Array.from({ length: 9 }, newId)
  const settlements: State['settlements'] = {}
  const loan1First = addMonths(`${ym}-15`, -8)
  const loan2First = addMonths(`${ym}-05`, -14)
  for (let n = 1; n <= 8; n++) settlements[loanKey(loan1!, n)] = { key: loanKey(loan1!, n), date: addMonths(loan1First, n - 1), amount: tl(385000), currency: 'TRY' }
  for (let n = 1; n <= 14; n++) settlements[loanKey(loan2!, n)] = { key: loanKey(loan2!, n), date: addMonths(loan2First, n - 1), amount: tl(512000), currency: 'TRY' }
  settlements[paymentKey(pay1!, `${ym}-01`)] = { key: paymentKey(pay1!, `${ym}-01`), date: `${ym}-01`, amount: tl(870000), currency: 'TRY' }
  settlements[paymentKey(pay2!, `${ym}-01`)] = { key: paymentKey(pay2!, `${ym}-01`), date: `${ym}-01`, amount: tl(95000), currency: 'TRY' }
  return {
    schemaVersion: 2,
    companies: [a, b],
    activeCompanyId: 'all',
    categories: defaultCategories(),
    accounts: [
      { id: newId(), companyId: a.id, name: 'Ziraat Vadesiz', kind: 'bank', currency: 'TRY', balance: tl(1250000) },
      { id: newId(), companyId: a.id, name: 'Merkez Kasa', kind: 'cash', currency: 'TRY', balance: tl(85000) },
      { id: newId(), companyId: a.id, name: 'Ziraat KMH', kind: 'overdraft', currency: 'TRY', balance: tl(-120000), overdraftLimit: tl(500000), interestRate: 66 },
      { id: newId(), companyId: b.id, name: 'İş Bankası Vadesiz', kind: 'bank', currency: 'TRY', balance: tl(640000) },
      { id: newId(), companyId: b.id, name: 'İş Bankası Döviz', kind: 'bank', currency: 'USD', balance: tl(18500) },
      { id: newId(), companyId: b.id, name: '32 Gün Vadeli', kind: 'deposit', currency: 'TRY', balance: tl(2000000), interestRate: 45, maturityDate: addDays(t, 20) },
    ],
    accountTx: [],
    budgets: [
      { id: newId(), companyId: a.id, category: 'Yakıt', limit: tl(150000), period: 'monthly', rollover: false, startMonth: ym },
      { id: newId(), companyId: a.id, category: 'Personel', limit: tl(900000), period: 'monthly', rollover: false, startMonth: ym },
      { id: newId(), companyId: b.id, category: 'Bakım', limit: tl(80000), period: 'monthly', rollover: true, startMonth: ym },
      { id: newId(), companyId: b.id, category: 'Ofis', limit: tl(400000), period: 'yearly', rollover: false, startMonth: ym },
    ],
    loans: [
      {
        id: loan1!, companyId: a.id, name: 'Makine Parkı Kredisi', bank: 'Ziraat Bankası', currency: 'TRY',
        installmentAmount: tl(385000), installmentCount: 36, firstDueDate: loan1First, principal: tl(9500000), installmentOverrides: {},
      },
      {
        id: loan2!, companyId: b.id, name: 'GES Yatırım Kredisi', bank: 'İş Bankası', currency: 'TRY',
        installmentAmount: tl(512000), installmentCount: 48, firstDueDate: loan2First, installmentOverrides: {},
      },
    ],
    cards: [
      {
        id: card1!, companyId: a.id, name: 'Şirket Kartı (Bonus)', bank: 'Garanti BBVA', limit: tl(750000),
        statementDay: 1, dueDay: 11, openingDebt: tl(218000), openingPeriod: ym, statementOverrides: {},
      },
      {
        id: card2!, companyId: b.id, name: 'Şirket Kartı (Maximum)', bank: 'İş Bankası', limit: tl(400000),
        statementDay: 18, dueDay: 28, openingDebt: tl(96500), openingPeriod: ym, statementOverrides: {},
      },
    ],
    cardExpenses: [
      { id: newId(), cardId: card1!, date: addDays(t, -1), category: 'Yakıt', title: 'Şantiye araçları yakıt', amount: tl(42000), installments: 1, countsToStatement: true },
      { id: newId(), cardId: card1!, date: addDays(t, -3), category: 'Ofis', title: 'Kırtasiye + sarf', amount: tl(6800), installments: 1, countsToStatement: true },
      { id: newId(), cardId: card1!, date: addDays(t, -5), category: 'Ofis', title: 'Dizüstü bilgisayar (6 taksit)', amount: tl(72000), installments: 6, countsToStatement: true },
      { id: newId(), cardId: card2!, date: addDays(t, -2), category: 'Bakım', title: 'Panel temizlik ekipmanı', amount: tl(18500), installments: 1, countsToStatement: true },
    ],
    contacts: [
      { id: c1!, companyId: a.id, name: 'Yılmaz Konut Geliştirme', type: 'customer', phone: '0212 555 10 20', email: 'muhasebe@yilmazkonut.example', taxNo: '', note: 'B Blok hakediş müşterisi', openingBalance: tl(150000) },
      { id: c2!, companyId: a.id, name: 'Anadolu Beton San.', type: 'supplier', phone: '0216 555 30 40', email: 'satis@anadolubeton.example', taxNo: '', note: '45 gün vade', openingBalance: 0 },
      { id: c3!, companyId: b.id, name: 'Ege Tekstil A.Ş.', type: 'customer', phone: '0232 555 50 60', email: 'finans@egetekstil.example', taxNo: '', note: 'Çatı GES elektrik satışı', openingBalance: 0 },
    ],
    cheques: [
      { id: newId(), companyId: a.id, instrument: 'cheque', type: 'received', bank: 'Akbank', number: '0451208', contactId: c1, description: 'B Blok hakediş', currency: 'TRY', amount: tl(850000), dueDate: addDays(t, 12), status: 'pending', history: [{ date: t, status: 'pending', note: 'Portföye alındı' }] },
      { id: newId(), companyId: a.id, instrument: 'cheque', type: 'issued', bank: 'Ziraat Bankası', number: '1130077', contactId: c2, description: 'Beton alımı', currency: 'TRY', amount: tl(460000), dueDate: addDays(t, 19), status: 'pending', history: [{ date: t, status: 'pending' }] },
      { id: newId(), companyId: b.id, instrument: 'note', type: 'received', bank: '', number: 'S-2208', contactId: c3, description: 'Elektrik satışı senedi', currency: 'TRY', amount: tl(275000), dueDate: addDays(t, 33), status: 'pending', history: [{ date: t, status: 'pending' }] },
    ],
    payments: [
      { id: newId(), companyId: a.id, contactId: c1, type: 'in', title: 'Hakediş Ödemesi (A Blok)', category: 'Satış', currency: 'TRY', amount: tl(1450000), date: addDays(t, 8), recurrence: 'once', exceptions: {} },
      { id: pay1!, companyId: a.id, type: 'out', title: 'Personel Maaşları', category: 'Personel', currency: 'TRY', amount: tl(870000), date: `${ym}-01`, recurrence: 'monthly', exceptions: {} },
      { id: newId(), companyId: a.id, type: 'out', title: 'SGK + Muhtasar', category: 'Vergi / SGK', currency: 'TRY', amount: tl(320000), date: addDays(t, 15), recurrence: 'monthly', exceptions: {} },
      { id: newId(), companyId: a.id, contactId: c2, type: 'out', title: 'Beton Tedarik Faturası', category: 'Tedarik', currency: 'TRY', amount: tl(280000), date: addDays(t, 4), recurrence: 'once', exceptions: {} },
      { id: newId(), companyId: b.id, contactId: c3, type: 'in', title: 'Elektrik Satış Faturası', category: 'Satış', currency: 'TRY', amount: tl(340000), date: addDays(t, 6), recurrence: 'monthly', exceptions: {} },
      { id: pay2!, companyId: b.id, type: 'out', title: 'Saha Kira Bedeli', category: 'Kira', currency: 'TRY', amount: tl(95000), date: `${ym}-01`, recurrence: 'monthly', exceptions: {} },
      { id: newId(), companyId: b.id, type: 'out', title: 'Ekipman Kirası (USD)', category: 'Kira', currency: 'USD', amount: tl(1200), date: addDays(t, 10), recurrence: 'monthly', exceptions: {} },
      { id: newId(), companyId: b.id, type: 'out', title: 'KDV Ödemesi', category: 'Vergi / SGK', currency: 'TRY', amount: tl(185000), date: addDays(t, 21), recurrence: 'monthly', exceptions: {} },
    ],
    settlements,
    settings: { ...defaultSettings(), rates: { TRY: 1, USD: 41.5, EUR: 48.2, GBP: 55.6, XAU: 4300 }, ratesUpdatedAt: new Date().toISOString() },
  }
}

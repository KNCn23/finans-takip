// Kayıtlı veriyi güncel şemaya (v2) taşır.
//
// v1: Uygulamanın ilk sürümü (finans-takip-v1). Tutarlar TL cinsinden ondalıklı
//     sayı, "ödendi" bilgisi her kaynağın kendi dizisinde, aylık tekrarlar
//     zincirleme hesaplandığı için ayın 29-31'inde kayıyordu.
// v2: Tutarlar kuruş (tamsayı), ödendi bilgisi settlements haritasında,
//     kartlar ekstre dönemi mantığıyla, para birimi ve kategori listesi var.

import type {
  Account,
  Budget,
  Card,
  CardExpense,
  Category,
  Cheque,
  Contact,
  Currency,
  Loan,
  Payment,
  Settings,
  Settlement,
  State,
} from './types'
import { CURRENCIES } from './types'
import { addMonthKey, addMonths, isValidISO, monthKey, today } from './dates'
import { toMinor } from './money'
import { defaultCategories, defaultSettings, ensureCategory, newId } from './defaults'
import { cardKey } from './cards'
import { loanKey } from './loans'
import { chequeKey, paymentKey } from './occurrences'

export const CURRENT_SCHEMA = 2

export interface MigrationReport {
  from: number | 'v0'
  to: number
  counts: Record<string, number>
  /** Kayan aylık tekrarlarda yeni vadeye taşınan "ödendi" işaretleri */
  remappedPaidDates: number
  /** Eşleştirilemeyip bırakılan "ödendi" işaretleri */
  droppedPaidDates: number
  notes: string[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v))
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : d
}
const int = (v: unknown, d = 0): number => Math.round(num(v, d))
const date = (v: unknown, fallback: string): string => {
  const s = str(v)
  return isValidISO(s) ? s : fallback
}
const currency = (v: unknown): Currency => (CURRENCIES.includes(v as Currency) ? (v as Currency) : 'TRY')
const clampDay = (v: unknown, d: number) => Math.min(28, Math.max(1, int(v, d)))

/** Ham veriyi (JSON.parse sonucu) v2'ye çevirir. Geçersiz girdide hata fırlatır. */
export function migrate(raw: unknown): { state: State; report: MigrationReport } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Veri bir nesne değil.')
  }
  const r = raw as Any
  if (r.schemaVersion === 2) {
    const state = normalizeV2(r)
    return { state, report: { from: 2, to: 2, counts: countState(state), remappedPaidDates: 0, droppedPaidDates: 0, notes: [] } }
  }
  if (typeof r.schemaVersion === 'number' && r.schemaVersion > CURRENT_SCHEMA) {
    throw new Error(
      `Bu veri uygulamanın daha yeni bir sürümüyle kaydedilmiş (şema ${r.schemaVersion}). Lütfen uygulamayı güncelleyin.`,
    )
  }
  return migrateV1(r)
}

function migrateV1(h: Any): { state: State; report: MigrationReport } {
  const todayISO = today()
  const curMonth = monthKey(todayISO)
  const notes: string[] = []
  let remapped = 0
  let dropped = 0

  // --- v1 açılış normalizasyonu (ilk sürümdeki _f fonksiyonunun karşılığı) ---
  let companies = arr(h.companies).map((c) => ({ id: str(c.id) || newId(), name: str(c.name) || 'Şirket' }))
  let accountsRaw = arr(h.accounts)
  if (typeof h.cash === 'number' && accountsRaw.length === 0) {
    accountsRaw = [{ id: newId(), companyId: '', name: 'Ana Hesap', balance: h.cash }]
    notes.push('Eski "nakit" alanı "Ana Hesap" olarak hesaplara taşındı.')
  }
  if (companies.length === 0) companies = [{ id: newId(), name: 'Merkez Şirket' }]
  const defaultCompany = companies[0]!.id
  const companyIds = new Set(companies.map((c) => c.id))
  const cid = (v: unknown) => (companyIds.has(str(v)) ? str(v) : defaultCompany)

  const settlements: Record<string, Settlement> = {}
  const settle = (key: string, d: string, amount: number, cur: Currency = 'TRY') => {
    settlements[key] = { key, date: d, amount, currency: cur }
  }

  const accounts: Account[] = accountsRaw.map((a) => {
    const name = str(a.name) || 'Hesap'
    return {
      id: str(a.id) || newId(),
      companyId: cid(a.companyId),
      name,
      kind: /kasa|nakit|cep/i.test(name) ? 'cash' : 'bank',
      currency: 'TRY',
      balance: toMinor(num(a.balance)),
    }
  })

  let categories: Category[] = defaultCategories()
  const cat = (name: unknown, kind: 'in' | 'out'): string => {
    const res = ensureCategory(categories, str(name), kind)
    categories = res.categories
    return res.name
  }

  const budgets: Budget[] = arr(h.budgets).map((b) => ({
    id: str(b.id) || newId(),
    companyId: cid(b.companyId),
    category: cat(b.category, 'out'),
    limit: toMinor(num(b.limit)),
    period: 'monthly',
    rollover: false,
    startMonth: curMonth,
  }))

  const loans: Loan[] = arr(h.loans).map((l) => {
    const id = str(l.id) || newId()
    const loan: Loan = {
      id,
      companyId: cid(l.companyId),
      name: str(l.name) || 'Kredi',
      bank: str(l.bank),
      currency: 'TRY',
      installmentAmount: toMinor(num(l.installmentAmount)),
      installmentCount: Math.max(1, int(l.installmentCount, 1)),
      firstDueDate: date(l.firstDueDate, todayISO),
      installmentOverrides: {},
    }
    for (const n of arr(l.paidInstallments)) {
      const k = int(n)
      if (k >= 1 && k <= loan.installmentCount) {
        settle(loanKey(id, k), addMonths(loan.firstDueDate, k - 1), loan.installmentAmount)
      }
    }
    return loan
  })

  const cards: Card[] = arr(h.cards).map((c) => {
    const id = str(c.id) || newId()
    const paidPeriods = arr(c.paidPeriods).map((p) => str(p)).filter((p) => /^\d{4}-\d{2}$/.test(p))
    const statementDay = clampDay(c.statementDay, 1)
    const dueDay = clampDay(c.dueDay, 10)
    const debt = toMinor(num(c.currentDebt))
    // v1 bu ayın son ödeme gününde "dönem borcu"nu gösteriyordu. Bu ay zaten
    // ödendi işaretliyse kalan borç bir sonraki döneme aittir.
    const paidThisMonth = paidPeriods.includes(curMonth)
    const openingPeriod = paidThisMonth ? addMonthKey(curMonth, 1) : curMonth
    // Geçmiş aylar v1'de hiç gösterilmediği için yalnızca bu ayın ödemesi taşınır.
    // v1 ödeme sonrası borcu sıfırlamadığından ödenen tutar ≈ kayıtlı borçtur.
    if (paidThisMonth) {
      settle(cardKey(id, curMonth), `${curMonth}-${String(dueDay).padStart(2, '0')}`, debt)
      notes.push(
        `"${str(c.name) || 'Kart'}" kartının bu dönemi ödenmiş görünüyor; eski sürüm borcu sıfırlamadığı için ${addMonthKey(curMonth, 1)} dönemine aynı tutar yazıldı. Lütfen Kredi Kartları sayfasından güncel ekstre tutarını kontrol edin.`,
      )
    }
    return {
      id,
      companyId: cid(c.companyId),
      name: str(c.name) || 'Kart',
      bank: str(c.bank),
      limit: toMinor(num(c.limit)),
      statementDay,
      dueDay,
      openingDebt: debt,
      openingPeriod,
      statementOverrides: {},
    }
  })
  const cardIds = new Set(cards.map((c) => c.id))

  // v1'de "borca ekle" işaretli harcamalar zaten currentDebt'e eklenmişti;
  // openingDebt = currentDebt olduğundan iki kez sayılmamaları için
  // eski harcamalar ekstre hesabına katılmaz (raporlarda görünmeye devam eder).
  const cardExpenses: CardExpense[] = arr(h.cardExpenses)
    .filter((e) => cardIds.has(str(e.cardId)))
    .map((e) => ({
      id: str(e.id) || newId(),
      cardId: str(e.cardId),
      date: date(e.date, todayISO),
      category: cat(e.category, 'out'),
      title: str(e.title),
      amount: toMinor(num(e.amount)),
      installments: 1,
      countsToStatement: false,
    }))
  if (cardExpenses.length) notes.push('Eski kart harcamaları dönem borcuna zaten dahil olduğu için ekstreye ikinci kez eklenmedi.')

  const contacts: Contact[] = arr(h.contacts).map((c) => ({
    id: str(c.id) || newId(),
    companyId: cid(c.companyId),
    name: str(c.name) || 'Cari',
    type: c.type === 'supplier' || c.type === 'both' ? c.type : 'customer',
    phone: str(c.phone),
    email: str(c.email),
    taxNo: '',
    note: str(c.note),
    openingBalance: 0,
  }))
  const contactIds = new Set(contacts.map((c) => c.id))
  const contactRef = (v: unknown) => (contactIds.has(str(v)) ? str(v) : undefined)

  const payments: Payment[] = arr(h.payments).map((p) => {
    const id = str(p.id) || newId()
    const type = p.type === 'in' ? 'in' : 'out'
    const recurrence = p.recurrence === 'monthly' || p.recurrence === 'weekly' ? p.recurrence : 'once'
    const start = date(p.date, todayISO)
    const payment: Payment = {
      id,
      companyId: cid(p.companyId),
      contactId: contactRef(p.contactId),
      type,
      title: str(p.title) || 'Kayıt',
      category: cat(p.category, type),
      currency: 'TRY',
      amount: toMinor(num(p.amount)),
      date: start,
      recurrence,
      endDate: isValidISO(str(p.endDate)) ? str(p.endDate) : undefined,
      exceptions: {},
    }
    const paid = arr(p.paidDates).map((d) => str(d)).filter(isValidISO)
    for (const d of paid) {
      const mapped = recurrence === 'monthly' ? remapDriftedDate(start, d) : d
      if (mapped) {
        if (mapped !== d) remapped++
        settle(paymentKey(id, mapped), mapped, payment.amount)
      } else dropped++
    }
    return payment
  })
  if (remapped) notes.push(`${remapped} aylık tekrar vadesi kayma düzeltmesiyle doğru tarihe taşındı.`)

  const cheques: Cheque[] = arr(h.cheques).map((c) => {
    const id = str(c.id) || newId()
    const status = c.status === 'cleared' || c.status === 'bounced' ? c.status : 'pending'
    const amount = toMinor(num(c.amount))
    const dueDate = date(c.dueDate, todayISO)
    if (status === 'cleared') settle(chequeKey(id), dueDate, amount)
    return {
      id,
      companyId: cid(c.companyId),
      instrument: 'cheque',
      type: c.type === 'issued' ? 'issued' : 'received',
      bank: str(c.bank),
      number: str(c.number),
      contactId: contactRef(c.contactId),
      description: str(c.description),
      currency: 'TRY',
      amount,
      dueDate,
      status,
      history: [{ date: todayISO, status, note: 'Önceki sürümden aktarıldı' }],
    }
  })

  const activeCompanyId = h.activeCompanyId === 'all' || companyIds.has(str(h.activeCompanyId)) ? str(h.activeCompanyId) : 'all'

  const state: State = {
    schemaVersion: 2,
    companies,
    activeCompanyId,
    categories,
    accounts,
    accountTx: [],
    budgets,
    loans,
    cards,
    cardExpenses,
    payments,
    contacts,
    cheques,
    settlements,
    settings: defaultSettings(),
  }
  return {
    state,
    report: { from: 1, to: 2, counts: countState(state), remappedPaidDates: remapped, droppedPaidDates: dropped, notes },
  }
}

/**
 * v1 aylık tekrarı zincirleme hesaplıyordu (31 Oca → 28 Şub → 28 Mar…).
 * Eski dizide k. sıradaki tarih ödendi işaretliyse, yeni dizide de k. vade
 * (addMonths(start, k)) ödendi sayılır. Eşleşmezse aynı aydaki yeni vadeye
 * taşınır; o da yoksa null.
 */
export function remapDriftedDate(start: string, paid: string): string | null {
  let old = start
  for (let k = 0; k < 2400 && old <= paid; k++) {
    if (old === paid) return addMonths(start, k)
    old = addMonths(old, 1) // eski zincirleme hesap
  }
  for (let k = 0; k < 2400; k++) {
    const d = addMonths(start, k)
    if (monthKey(d) === monthKey(paid)) return d
    if (d > paid) break
  }
  return null
}

/** v2 verisini doğrular, eksik alanları tamamlar. */
export function normalizeV2(r: Any): State {
  const todayISO = today()
  const companies = arr(r.companies).map((c) => ({ id: str(c.id) || newId(), name: str(c.name) || 'Şirket' }))
  if (companies.length === 0) companies.push({ id: newId(), name: 'Merkez Şirket' })
  const companyIds = new Set(companies.map((c) => c.id))
  const cid = (v: unknown) => (companyIds.has(str(v)) ? str(v) : companies[0]!.id)
  const defaults = defaultSettings()
  const s = (r.settings ?? {}) as Any
  const settings: Settings = {
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system',
    shiftToBusinessDay: s.shiftToBusinessDay !== false,
    notifications: s.notifications !== false,
    notifyDaysBefore: Math.min(14, Math.max(0, int(s.notifyDaysBefore, defaults.notifyDaysBefore))),
    rates: Object.fromEntries(CURRENCIES.map((c) => [c, c === 'TRY' ? 1 : Math.max(0, num(s.rates?.[c]))])) as Record<
      Currency,
      number
    >,
    ratesUpdatedAt: s.ratesUpdatedAt ? str(s.ratesUpdatedAt) : undefined,
    pinHash: s.pinHash ? str(s.pinHash) : undefined,
    pinSalt: s.pinSalt ? str(s.pinSalt) : undefined,
    lockAfterMinutes: Math.max(0, int(s.lockAfterMinutes, 0)),
  }
  const record = <T,>(v: unknown, f: (x: Any) => T): Record<string, T> => {
    const out: Record<string, T> = {}
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Any)) out[k] = f(x)
    return out
  }
  const categories: Category[] = arr(r.categories).map((c) => ({
    id: str(c.id) || newId(),
    name: str(c.name) || 'Diğer',
    kind: c.kind === 'in' ? 'in' : 'out',
  }))
  return {
    schemaVersion: 2,
    companies,
    activeCompanyId: r.activeCompanyId === 'all' || companyIds.has(str(r.activeCompanyId)) ? str(r.activeCompanyId) : 'all',
    categories: categories.length ? categories : defaultCategories(),
    accounts: arr(r.accounts).map((a) => ({
      id: str(a.id) || newId(),
      companyId: cid(a.companyId),
      name: str(a.name) || 'Hesap',
      kind: ['bank', 'cash', 'deposit', 'overdraft'].includes(a.kind) ? a.kind : 'bank',
      currency: currency(a.currency),
      balance: int(a.balance),
      overdraftLimit: a.overdraftLimit !== undefined ? int(a.overdraftLimit) : undefined,
      interestRate: a.interestRate !== undefined ? num(a.interestRate) : undefined,
      maturityDate: isValidISO(str(a.maturityDate)) ? str(a.maturityDate) : undefined,
    })),
    accountTx: arr(r.accountTx).map((t) => ({
      id: str(t.id) || newId(),
      accountId: str(t.accountId),
      date: date(t.date, todayISO),
      amount: int(t.amount),
      kind: ['adjust', 'expense', 'income', 'transfer', 'settlement', 'import'].includes(t.kind) ? t.kind : 'adjust',
      note: str(t.note),
      ref: t.ref ? str(t.ref) : undefined,
    })),
    budgets: arr(r.budgets).map((b) => ({
      id: str(b.id) || newId(),
      companyId: cid(b.companyId),
      category: str(b.category) || 'Diğer',
      limit: int(b.limit),
      period: b.period === 'yearly' ? 'yearly' : 'monthly',
      rollover: !!b.rollover,
      startMonth: /^\d{4}-\d{2}$/.test(str(b.startMonth)) ? str(b.startMonth) : monthKey(todayISO),
    })),
    loans: arr(r.loans).map((l) => ({
      id: str(l.id) || newId(),
      companyId: cid(l.companyId),
      name: str(l.name) || 'Kredi',
      bank: str(l.bank),
      currency: currency(l.currency),
      installmentAmount: int(l.installmentAmount),
      installmentCount: Math.max(1, int(l.installmentCount, 1)),
      firstDueDate: date(l.firstDueDate, todayISO),
      principal: l.principal !== undefined && l.principal !== null ? int(l.principal) : undefined,
      annualRate: l.annualRate !== undefined && l.annualRate !== null ? num(l.annualRate) : undefined,
      installmentOverrides: record(l.installmentOverrides, (x) => int(x)) as Record<number, number>,
      earlyClosure: l.earlyClosure
        ? {
            date: date(l.earlyClosure.date, todayISO),
            amount: int(l.earlyClosure.amount),
            afterInstallment: int(l.earlyClosure.afterInstallment),
          }
        : undefined,
    })),
    cards: arr(r.cards).map((c) => ({
      id: str(c.id) || newId(),
      companyId: cid(c.companyId),
      name: str(c.name) || 'Kart',
      bank: str(c.bank),
      limit: int(c.limit),
      statementDay: clampDay(c.statementDay, 1),
      dueDay: clampDay(c.dueDay, 10),
      openingDebt: int(c.openingDebt),
      openingPeriod: /^\d{4}-\d{2}$/.test(str(c.openingPeriod)) ? str(c.openingPeriod) : monthKey(todayISO),
      statementOverrides: record(c.statementOverrides, (x) => int(x)),
    })),
    cardExpenses: arr(r.cardExpenses).map((e) => ({
      id: str(e.id) || newId(),
      cardId: str(e.cardId),
      date: date(e.date, todayISO),
      category: str(e.category) || 'Diğer',
      title: str(e.title),
      amount: int(e.amount),
      installments: Math.min(36, Math.max(1, int(e.installments, 1))),
      countsToStatement: e.countsToStatement !== false,
    })),
    payments: arr(r.payments).map((p) => ({
      id: str(p.id) || newId(),
      companyId: cid(p.companyId),
      contactId: p.contactId ? str(p.contactId) : undefined,
      type: p.type === 'in' ? 'in' : 'out',
      title: str(p.title) || 'Kayıt',
      category: str(p.category),
      currency: currency(p.currency),
      amount: int(p.amount),
      date: date(p.date, todayISO),
      recurrence: p.recurrence === 'monthly' || p.recurrence === 'weekly' ? p.recurrence : 'once',
      endDate: isValidISO(str(p.endDate)) ? str(p.endDate) : undefined,
      exceptions: record(p.exceptions, (x) => ({
        amount: x?.amount !== undefined && x?.amount !== null ? int(x.amount) : undefined,
        skip: x?.skip ? true : undefined,
      })),
    })),
    contacts: arr(r.contacts).map((c) => ({
      id: str(c.id) || newId(),
      companyId: cid(c.companyId),
      name: str(c.name) || 'Cari',
      type: c.type === 'supplier' || c.type === 'both' ? c.type : 'customer',
      phone: str(c.phone),
      email: str(c.email),
      taxNo: str(c.taxNo),
      note: str(c.note),
      openingBalance: int(c.openingBalance),
    })),
    cheques: arr(r.cheques).map((c) => ({
      id: str(c.id) || newId(),
      companyId: cid(c.companyId),
      instrument: c.instrument === 'note' ? 'note' : 'cheque',
      type: c.type === 'issued' ? 'issued' : 'received',
      bank: str(c.bank),
      number: str(c.number),
      contactId: c.contactId ? str(c.contactId) : undefined,
      description: str(c.description),
      currency: currency(c.currency),
      amount: int(c.amount),
      dueDate: date(c.dueDate, todayISO),
      status: ['pending', 'cleared', 'bounced', 'endorsed'].includes(c.status) ? c.status : 'pending',
      endorsedToContactId: c.endorsedToContactId ? str(c.endorsedToContactId) : undefined,
      history: arr(c.history).map((e) => ({
        date: date(e.date, todayISO),
        status: ['pending', 'cleared', 'bounced', 'endorsed'].includes(e.status) ? e.status : 'pending',
        note: e.note ? str(e.note) : undefined,
      })),
    })),
    settlements: record(r.settlements, (x) => ({
      key: str(x?.key),
      date: date(x?.date, todayISO),
      amount: int(x?.amount),
      currency: currency(x?.currency),
      accountId: x?.accountId ? str(x.accountId) : undefined,
      txId: x?.txId ? str(x.txId) : undefined,
    })),
    settings,
  }
}

export function countState(s: State): Record<string, number> {
  return {
    şirket: s.companies.length,
    hesap: s.accounts.length,
    bütçe: s.budgets.length,
    kredi: s.loans.length,
    kart: s.cards.length,
    'kart harcaması': s.cardExpenses.length,
    'gelir/gider': s.payments.length,
    cari: s.contacts.length,
    'çek/senet': s.cheques.length,
    'ödendi kaydı': Object.keys(s.settlements).length,
  }
}

// Durumu değiştiren bütün işlemler: saf fonksiyonlar (state → yeni state).
// Arayüzden bağımsız oldukları için doğrudan test edilebilirler.

import type {
  Account,
  AccountTx,
  AccountTxKind,
  Budget,
  Card,
  CardExpense,
  CategoryKind,
  Cheque,
  ChequeStatus,
  Contact,
  Currency,
  ID,
  ISODate,
  Loan,
  Minor,
  Occurrence,
  Payment,
  PaymentException,
  Settings,
  State,
} from '../domain/types'
import { ensureCategory, newId, normCategory } from '../domain/defaults'
import { convert } from '../domain/money'
import { chequeKey, paymentKey } from '../domain/occurrences'
import { loanKey } from '../domain/loans'
import { today } from '../domain/dates'

type Upsert<T extends { id: ID }> = Omit<T, 'id' | 'companyId'> & { id?: ID; companyId?: ID }

function upsert<T extends { id: ID; companyId: ID }>(list: T[], item: Upsert<T>, companyId: ID): T[] {
  if (item.id && list.some((x) => x.id === item.id)) {
    return list.map((x) => (x.id === item.id ? ({ ...x, ...item, id: x.id } as T) : x))
  }
  return [...list, { ...item, id: item.id ?? newId(), companyId: item.companyId ?? companyId } as T]
}

function withoutKeys(settlements: State['settlements'], prefix: string) {
  return Object.fromEntries(Object.entries(settlements).filter(([k]) => !k.startsWith(prefix)))
}

// ---------------------------------------------------------------- Şirketler

export function saveCompany(s: State, c: { id?: ID; name: string }): State {
  if (c.id) return { ...s, companies: s.companies.map((x) => (x.id === c.id ? { ...x, name: c.name } : x)) }
  const company = { id: newId(), name: c.name }
  return { ...s, companies: [...s.companies, company], activeCompanyId: company.id }
}

export function deleteCompany(s: State, id: ID): State {
  if (s.companies.length <= 1) return s
  const cardIds = new Set(s.cards.filter((c) => c.companyId === id).map((c) => c.id))
  const accountIds = new Set(s.accounts.filter((a) => a.companyId === id).map((a) => a.id))
  const removedSources = new Set<string>([
    ...s.loans.filter((x) => x.companyId === id).map((x) => `loan:${x.id}:`),
    ...[...cardIds].map((x) => `card:${x}:`),
    ...s.payments.filter((x) => x.companyId === id).map((x) => `pay:${x.id}:`),
    ...s.cheques.filter((x) => x.companyId === id).map((x) => `cheque:${x.id}`),
  ])
  const settlements = Object.fromEntries(
    Object.entries(s.settlements).filter(([k]) => ![...removedSources].some((p) => k.startsWith(p))),
  )
  return {
    ...s,
    companies: s.companies.filter((c) => c.id !== id),
    activeCompanyId: s.activeCompanyId === id ? 'all' : s.activeCompanyId,
    accounts: s.accounts.filter((x) => x.companyId !== id),
    accountTx: s.accountTx.filter((t) => !accountIds.has(t.accountId)),
    budgets: s.budgets.filter((x) => x.companyId !== id),
    loans: s.loans.filter((x) => x.companyId !== id),
    cards: s.cards.filter((x) => x.companyId !== id),
    cardExpenses: s.cardExpenses.filter((e) => !cardIds.has(e.cardId)),
    payments: s.payments.filter((x) => x.companyId !== id),
    contacts: s.contacts.filter((x) => x.companyId !== id),
    cheques: s.cheques.filter((x) => x.companyId !== id),
    settlements,
  }
}

// ---------------------------------------------------------------- Kategoriler

export function addCategory(s: State, name: string, kind: CategoryKind): { state: State; name: string } {
  const r = ensureCategory(s.categories, name, kind)
  return { state: r.categories === s.categories ? s : { ...s, categories: r.categories }, name: r.name }
}

/** Kategoriyi yeniden adlandırır ve tüm kayıtlardaki kullanımlarını günceller. */
export function renameCategory(s: State, id: ID, name: string): State {
  const cat = s.categories.find((c) => c.id === id)
  const clean = name.trim()
  if (!cat || !clean) return s
  if (s.categories.some((c) => c.id !== id && normCategory(c.name) === normCategory(clean))) {
    throw new Error(`"${clean}" adında bir kategori zaten var.`)
  }
  const old = normCategory(cat.name)
  const fix = (v: string) => (normCategory(v) === old ? clean : v)
  return {
    ...s,
    categories: s.categories.map((c) => (c.id === id ? { ...c, name: clean } : c)),
    budgets: s.budgets.map((b) => ({ ...b, category: fix(b.category) })),
    payments: s.payments.map((p) => ({ ...p, category: fix(p.category) })),
    cardExpenses: s.cardExpenses.map((e) => ({ ...e, category: fix(e.category) })),
  }
}

export function deleteCategory(s: State, id: ID): State {
  return { ...s, categories: s.categories.filter((c) => c.id !== id) }
}

export function categoryUsage(s: State, name: string): number {
  const n = normCategory(name)
  return (
    s.budgets.filter((b) => normCategory(b.category) === n).length +
    s.payments.filter((p) => normCategory(p.category) === n).length +
    s.cardExpenses.filter((e) => normCategory(e.category) === n).length
  )
}

// ---------------------------------------------------------------- Hesaplar

function pushTx(s: State, tx: Omit<AccountTx, 'id'>): { state: State; txId: ID } {
  const id = newId()
  return {
    txId: id,
    state: {
      ...s,
      accountTx: [...s.accountTx, { ...tx, id }],
      accounts: s.accounts.map((a) => (a.id === tx.accountId ? { ...a, balance: a.balance + tx.amount } : a)),
    },
  }
}

function removeTx(s: State, txId: ID | undefined): State {
  if (!txId) return s
  const tx = s.accountTx.find((t) => t.id === txId)
  if (!tx) return s
  return {
    ...s,
    accountTx: s.accountTx.filter((t) => t.id !== txId),
    accounts: s.accounts.map((a) => (a.id === tx.accountId ? { ...a, balance: a.balance - tx.amount } : a)),
  }
}

export function saveAccount(s: State, a: Upsert<Account>, companyId: ID): State {
  const existing = a.id ? s.accounts.find((x) => x.id === a.id) : undefined
  if (existing && existing.balance !== a.balance) {
    // Bakiye elle değiştiyse fark "düzeltme" hareketi olarak kaydedilir
    const delta = a.balance - existing.balance
    const withMeta = { ...s, accounts: upsert(s.accounts, { ...a, balance: existing.balance }, companyId) }
    return pushTx(withMeta, { accountId: existing.id, date: today(), amount: delta, kind: 'adjust', note: 'Bakiye düzeltmesi' }).state
  }
  return { ...s, accounts: upsert(s.accounts, a, companyId) }
}

export function deleteAccount(s: State, id: ID): State {
  return {
    ...s,
    accounts: s.accounts.filter((a) => a.id !== id),
    accountTx: s.accountTx.filter((t) => t.accountId !== id),
    settlements: Object.fromEntries(
      Object.entries(s.settlements).map(([k, v]) => [k, v.accountId === id ? { ...v, accountId: undefined, txId: undefined } : v]),
    ),
  }
}

export interface TransferInput {
  fromId: ID
  toId: ID
  /** Gönderen hesabın para biriminde */
  amountFrom: Minor
  /** Alan hesabın para biriminde (aynı para biriminde amountFrom ile aynı) */
  amountTo: Minor
  date: ISODate
  note: string
}

export function transfer(s: State, t: TransferInput): State {
  if (t.fromId === t.toId) throw new Error('Gönderen ve alan hesap aynı olamaz.')
  const from = s.accounts.find((a) => a.id === t.fromId)
  const to = s.accounts.find((a) => a.id === t.toId)
  if (!from || !to) throw new Error('Hesap bulunamadı.')
  const ref = `transfer:${newId()}`
  const note = t.note || `${from.name} → ${to.name}`
  let next = pushTx(s, { accountId: from.id, date: t.date, amount: -Math.abs(t.amountFrom), kind: 'transfer', note, ref }).state
  next = pushTx(next, { accountId: to.id, date: t.date, amount: Math.abs(t.amountTo), kind: 'transfer', note, ref }).state
  return next
}

/** Hesap hareketini siler ve bakiyeyi geri alır (virmanın iki tarafı birlikte). */
export function deleteAccountTx(s: State, txId: ID): State {
  const tx = s.accountTx.find((t) => t.id === txId)
  if (!tx) return s
  if (tx.kind === 'settlement' && tx.ref && s.settlements[tx.ref]) return unsettle(s, tx.ref)
  const ids = tx.ref?.startsWith('transfer:') ? s.accountTx.filter((t) => t.ref === tx.ref).map((t) => t.id) : [txId]
  let next = s
  for (const id of ids) next = removeTx(next, id)
  return next
}

// ---------------------------------------------------------------- Ödendi / tahsil edildi

export interface SettleInput {
  date: ISODate
  /** Vadenin kendi para biriminde fiilen ödenen tutar */
  amount: Minor
  accountId?: ID
}

export function settle(s: State, occ: Occurrence, input: SettleInput): State {
  let next = s.settlements[occ.key] ? unsettle(s, occ.key) : s
  let txId: ID | undefined
  if (input.accountId) {
    const acc = next.accounts.find((a) => a.id === input.accountId)
    if (!acc) throw new Error('Hesap bulunamadı.')
    const inAccountCurrency = convert(input.amount, occ.currency, acc.currency, s.settings.rates)
    if (inAccountCurrency === 0 && input.amount !== 0) {
      throw new Error(`${occ.currency} → ${acc.currency} kuru tanımlı değil. Ayarlar → Döviz Kurları'ndan girin.`)
    }
    const r = pushTx(next, {
      accountId: acc.id,
      date: input.date,
      amount: occ.direction === 'in' ? inAccountCurrency : -inAccountCurrency,
      kind: 'settlement',
      note: `${occ.title} · ${occ.subtitle}`,
      ref: occ.key,
    })
    next = r.state
    txId = r.txId
  }
  next = {
    ...next,
    settlements: {
      ...next.settlements,
      [occ.key]: { key: occ.key, date: input.date, amount: input.amount, currency: occ.currency, accountId: input.accountId, txId },
    },
  }
  if (occ.sourceType === 'cheque') next = setChequeStatusRaw(next, occ.sourceId, 'cleared', input.date, 'Tahsil/ödeme yapıldı')
  return next
}

export function unsettle(s: State, key: string): State {
  const st = s.settlements[key]
  if (!st) return s
  let next = removeTx(s, st.txId)
  const { [key]: _removed, ...rest } = next.settlements
  next = { ...next, settlements: rest }
  if (key.startsWith('cheque:')) {
    const id = key.slice('cheque:'.length)
    const ch = next.cheques.find((c) => c.id === id)
    if (ch && ch.status === 'cleared') next = setChequeStatusRaw(next, id, 'pending', today(), 'Ödendi işareti kaldırıldı')
  }
  return next
}

/** Hızlı harcama/gelir: tek seferlik kayıt + hesaptan düşme. */
export function addAccountMovement(
  s: State,
  accountId: ID,
  m: { type: 'in' | 'out'; title: string; category: string; amount: Minor; date: ISODate },
): State {
  const acc = s.accounts.find((a) => a.id === accountId)
  if (!acc) throw new Error('Hesap bulunamadı.')
  const cat = addCategory(s, m.category, m.type)
  const p: Payment = {
    id: newId(),
    companyId: acc.companyId,
    type: m.type,
    title: m.title || cat.name,
    category: cat.name,
    currency: acc.currency,
    amount: m.amount,
    date: m.date,
    recurrence: 'once',
    exceptions: {},
  }
  let next: State = { ...cat.state, payments: [...cat.state.payments, p] }
  const key = paymentKey(p.id, p.date)
  const r = pushTx(next, {
    accountId,
    date: m.date,
    amount: m.type === 'in' ? m.amount : -m.amount,
    kind: m.type === 'in' ? 'income' : 'expense',
    note: p.title,
    ref: key,
  })
  next = r.state
  return {
    ...next,
    settlements: { ...next.settlements, [key]: { key, date: m.date, amount: m.amount, currency: acc.currency, accountId, txId: r.txId } },
  }
}

// ---------------------------------------------------------------- Bütçe

export function saveBudget(s: State, b: Upsert<Budget>, companyId: ID): State {
  const cat = addCategory(s, b.category, 'out')
  return { ...cat.state, budgets: upsert(cat.state.budgets, { ...b, category: cat.name }, companyId) }
}
export function deleteBudget(s: State, id: ID): State {
  return { ...s, budgets: s.budgets.filter((b) => b.id !== id) }
}

// ---------------------------------------------------------------- Krediler

export function saveLoan(s: State, l: Upsert<Loan>, companyId: ID): State {
  return { ...s, loans: upsert(s.loans, l, companyId) }
}
export function deleteLoan(s: State, id: ID): State {
  return { ...s, loans: s.loans.filter((l) => l.id !== id), settlements: withoutKeys(s.settlements, `loan:${id}:`) }
}
export function setInstallmentOverride(s: State, loanId: ID, n: number, amount: Minor | undefined): State {
  return {
    ...s,
    loans: s.loans.map((l) => {
      if (l.id !== loanId) return l
      const o = { ...l.installmentOverrides }
      if (amount === undefined) delete o[n]
      else o[n] = amount
      return { ...l, installmentOverrides: o }
    }),
  }
}
export function closeLoanEarly(s: State, loanId: ID, input: { date: ISODate; amount: Minor; accountId?: ID }): State {
  const loan = s.loans.find((l) => l.id === loanId)
  if (!loan) return s
  let after = 0
  for (let n = 1; n <= loan.installmentCount; n++) if (s.settlements[loanKey(loanId, n)]) after = n
  let next: State = {
    ...s,
    loans: s.loans.map((l) => (l.id === loanId ? { ...l, earlyClosure: { date: input.date, amount: input.amount, afterInstallment: after } } : l)),
  }
  const occ: Occurrence = {
    key: loanKey(loanId, 'payoff'), sourceType: 'loan', sourceId: loanId, companyId: loan.companyId, title: loan.name,
    subtitle: `${loan.bank} · Erken kapama`, date: input.date, scheduledDate: input.date, amount: input.amount,
    currency: loan.currency, direction: 'out', paid: false, category: 'Kredi Taksiti',
  }
  next = settle(next, occ, input)
  return next
}
export function reopenLoan(s: State, loanId: ID): State {
  const next = unsettle(s, loanKey(loanId, 'payoff'))
  return { ...next, loans: next.loans.map((l) => (l.id === loanId ? { ...l, earlyClosure: undefined } : l)) }
}

// ---------------------------------------------------------------- Kartlar

export function saveCard(s: State, c: Upsert<Card>, companyId: ID): State {
  return { ...s, cards: upsert(s.cards, c, companyId) }
}
export function deleteCard(s: State, id: ID): State {
  return {
    ...s,
    cards: s.cards.filter((c) => c.id !== id),
    cardExpenses: s.cardExpenses.filter((e) => e.cardId !== id),
    settlements: withoutKeys(s.settlements, `card:${id}:`),
  }
}
export function saveCardExpense(s: State, e: Omit<CardExpense, 'id'> & { id?: ID }): State {
  const cat = addCategory(s, e.category, 'out')
  const item = { ...e, category: cat.name }
  const list = item.id && s.cardExpenses.some((x) => x.id === item.id)
    ? cat.state.cardExpenses.map((x) => (x.id === item.id ? ({ ...x, ...item } as CardExpense) : x))
    : [...cat.state.cardExpenses, { ...item, id: item.id ?? newId() } as CardExpense]
  return { ...cat.state, cardExpenses: list }
}
export function deleteCardExpense(s: State, id: ID): State {
  return { ...s, cardExpenses: s.cardExpenses.filter((e) => e.id !== id) }
}
export function setStatementOverride(s: State, cardId: ID, period: string, amount: Minor | undefined): State {
  return {
    ...s,
    cards: s.cards.map((c) => {
      if (c.id !== cardId) return c
      const o = { ...c.statementOverrides }
      if (amount === undefined) delete o[period]
      else o[period] = amount
      return { ...c, statementOverrides: o }
    }),
  }
}

// ---------------------------------------------------------------- Gelir / gider

export function savePayment(s: State, p: Upsert<Payment>, companyId: ID): State {
  const cat = addCategory(s, p.category, p.type)
  return { ...cat.state, payments: upsert(cat.state.payments, { ...p, category: cat.name }, companyId) }
}
export function deletePayment(s: State, id: ID): State {
  return { ...s, payments: s.payments.filter((p) => p.id !== id), settlements: withoutKeys(s.settlements, `pay:${id}:`) }
}
/** Tekrarlayan kaydın tek bir vadesini değiştirir veya atlar (undefined = geri al). */
export function setPaymentException(s: State, paymentId: ID, scheduled: ISODate, ex: PaymentException | undefined): State {
  return {
    ...s,
    payments: s.payments.map((p) => {
      if (p.id !== paymentId) return p
      const e = { ...p.exceptions }
      if (!ex || (ex.amount === undefined && !ex.skip)) delete e[scheduled]
      else e[scheduled] = ex
      return { ...p, exceptions: e }
    }),
  }
}

// ---------------------------------------------------------------- Cariler

export function saveContact(s: State, c: Upsert<Contact>, companyId: ID): State {
  return { ...s, contacts: upsert(s.contacts, c, companyId) }
}
export function deleteContact(s: State, id: ID): State {
  return {
    ...s,
    contacts: s.contacts.filter((c) => c.id !== id),
    payments: s.payments.map((p) => (p.contactId === id ? { ...p, contactId: undefined } : p)),
    cheques: s.cheques.map((c) => ({
      ...c,
      contactId: c.contactId === id ? undefined : c.contactId,
      endorsedToContactId: c.endorsedToContactId === id ? undefined : c.endorsedToContactId,
    })),
  }
}

// ---------------------------------------------------------------- Çek / senet

export function saveCheque(s: State, c: Upsert<Cheque>, companyId: ID): State {
  const isNew = !c.id || !s.cheques.some((x) => x.id === c.id)
  const item = isNew ? { ...c, history: [{ date: today(), status: c.status, note: 'Kaydedildi' }] } : c
  return { ...s, cheques: upsert(s.cheques, item, companyId) }
}
export function deleteCheque(s: State, id: ID): State {
  const next = unsettle(s, chequeKey(id))
  return { ...next, cheques: next.cheques.filter((c) => c.id !== id) }
}

function setChequeStatusRaw(s: State, id: ID, status: ChequeStatus, date: ISODate, note?: string, endorsedTo?: ID): State {
  return {
    ...s,
    cheques: s.cheques.map((c) =>
      c.id === id
        ? {
            ...c,
            status,
            endorsedToContactId: status === 'endorsed' ? endorsedTo ?? c.endorsedToContactId : undefined,
            history: [...c.history, { date, status, note }],
          }
        : c,
    ),
  }
}

/**
 * Çek/senet durumunu değiştirir. "Tamamlandı" ödendi kaydı oluşturur (hesap
 * seçildiyse bakiyeyi günceller); diğer durumlar ödendi kaydını kaldırır.
 */
export function setChequeStatus(
  s: State,
  id: ID,
  status: ChequeStatus,
  opts: { date: ISODate; accountId?: ID; endorsedTo?: ID; note?: string },
): State {
  const ch = s.cheques.find((c) => c.id === id)
  if (!ch || ch.status === status) return s
  let next = unsettle(s, chequeKey(id))
  if (status === 'cleared') {
    const occ: Occurrence = {
      key: chequeKey(id), sourceType: 'cheque', sourceId: id, companyId: ch.companyId, title: ch.number || ch.description || 'Çek',
      subtitle: ch.bank, date: ch.dueDate, scheduledDate: ch.dueDate, amount: ch.amount, currency: ch.currency,
      direction: ch.type === 'received' ? 'in' : 'out', paid: false, category: '',
    }
    return settle(next, occ, { date: opts.date, amount: ch.amount, accountId: opts.accountId })
  }
  if (status === 'endorsed' && !opts.endorsedTo) throw new Error('Ciro edilecek cariyi seçin.')
  const cur = next.cheques.find((c) => c.id === id)
  if (cur && cur.status !== status) next = setChequeStatusRaw(next, id, status, opts.date, opts.note, opts.endorsedTo)
  return next
}

// ---------------------------------------------------------------- Ayarlar

export function updateSettings(s: State, patch: Partial<Settings>): State {
  return { ...s, settings: { ...s.settings, ...patch } }
}

// ---------------------------------------------------------------- Banka ekstresi

export interface BankImportItem {
  date: ISODate
  description: string
  amount: Minor
  category: string
}

/** Ekstre satırlarını gerçekleşmiş tek seferlik gelir/gider olarak ekler. */
export function importBankRows(s: State, accountId: ID, items: BankImportItem[], updateBalance: boolean): State {
  const acc = s.accounts.find((a) => a.id === accountId)
  if (!acc) throw new Error('Hesap bulunamadı.')
  let next = s
  for (const it of items) {
    const type = it.amount > 0 ? 'in' : 'out'
    const cat = addCategory(next, it.category, type)
    next = cat.state
    const p: Payment = {
      id: newId(), companyId: acc.companyId, type, title: it.description || cat.name, category: cat.name, currency: acc.currency,
      amount: Math.abs(it.amount), date: it.date, recurrence: 'once', exceptions: {},
    }
    next = { ...next, payments: [...next.payments, p] }
    const key = paymentKey(p.id, p.date)
    let txId: ID | undefined
    if (updateBalance) {
      const r = pushTx(next, { accountId, date: it.date, amount: it.amount, kind: 'import' as AccountTxKind, note: p.title, ref: key })
      next = r.state
      txId = r.txId
    }
    next = {
      ...next,
      settlements: {
        ...next.settlements,
        [key]: { key, date: it.date, amount: p.amount, currency: acc.currency as Currency, accountId: updateBalance ? accountId : undefined, txId },
      },
    }
  }
  return next
}

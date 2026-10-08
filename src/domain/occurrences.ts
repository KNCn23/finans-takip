import type { ISODate, Occurrence, Payment, State } from './types'
import { addDays, addMonths, daysBetween, monthsBetween, monthKey, nextBusinessDay, today } from './dates'
import { cardKey, cardStatements } from './cards'
import { loanKey, loanSchedule } from './loans'

export const SYSTEM_CATEGORIES = {
  loan: 'Kredi Taksiti',
  card: 'Kart Ödemesi',
  chequeIn: 'Çek Tahsilatı',
  chequeOut: 'Çek Ödemesi',
} as const

export function paymentKey(paymentId: string, scheduled: ISODate): string {
  return `pay:${paymentId}:${scheduled}`
}
export function chequeKey(chequeId: string): string {
  return `cheque:${chequeId}`
}

/**
 * Tekrarlayan bir kaydın [from, to] aralığındaki planlanan tarihleri.
 * Aylık tekrar her zaman BAŞLANGIÇ tarihinden hesaplanır; ayın 31'i kaymaz.
 */
export function paymentScheduledDates(p: Payment, from: ISODate, to: ISODate): ISODate[] {
  const end = p.endDate && p.endDate < to ? p.endDate : to
  if (p.recurrence === 'once') return p.date >= from && p.date <= end ? [p.date] : []
  const out: ISODate[] = []
  if (p.recurrence === 'monthly') {
    let n = Math.max(0, monthsBetween(monthKey(p.date), monthKey(from)) - 1)
    for (let guard = 0; guard < 2400; guard++, n++) {
      const d = addMonths(p.date, n)
      if (d > end) break
      if (d >= from) out.push(d)
    }
  } else {
    let n = Math.max(0, Math.floor(daysBetween(p.date, from) / 7) - 1)
    for (let guard = 0; guard < 5000; guard++, n++) {
      const d = addDays(p.date, n * 7)
      if (d > end) break
      if (d >= from) out.push(d)
    }
  }
  return out
}

export interface OccurrenceOptions {
  /** Kredi/kart/çek vadelerini iş gününe kaydır (varsayılan: ayardan) */
  shift?: boolean
}

/** [from, to] aralığındaki bütün vadeler, tarihe göre sıralı. */
export function generateOccurrences(
  state: State,
  from: ISODate,
  to: ISODate,
  opts: OccurrenceOptions = {},
): Occurrence[] {
  const shift = opts.shift ?? state.settings.shiftToBusinessDay
  const eff = (d: ISODate) => (shift ? nextBusinessDay(d) : d)
  const out: Occurrence[] = []
  const settled = state.settlements

  for (const loan of state.loans) {
    for (const inst of loanSchedule(loan, settled)) {
      if (inst.closed) continue
      const date = eff(inst.dueDate)
      if (date < from || date > to) continue
      out.push({
        key: loanKey(loan.id, inst.n),
        sourceType: 'loan',
        sourceId: loan.id,
        companyId: loan.companyId,
        title: loan.name,
        subtitle: `${loan.bank} · Taksit ${inst.n}/${loan.installmentCount}`,
        date,
        scheduledDate: inst.dueDate,
        amount: settled[loanKey(loan.id, inst.n)]?.amount ?? inst.amount,
        currency: loan.currency,
        direction: 'out',
        paid: inst.paid,
        category: SYSTEM_CATEGORIES.loan,
      })
    }
    const c = loan.earlyClosure
    if (c && c.date >= from && c.date <= to) {
      out.push({
        key: loanKey(loan.id, 'payoff'),
        sourceType: 'loan',
        sourceId: loan.id,
        companyId: loan.companyId,
        title: loan.name,
        subtitle: `${loan.bank} · Erken kapama`,
        date: c.date,
        scheduledDate: c.date,
        amount: c.amount,
        currency: loan.currency,
        direction: 'out',
        paid: !!settled[loanKey(loan.id, 'payoff')],
        category: SYSTEM_CATEGORIES.loan,
      })
    }
  }

  const todayISO = today()
  for (const card of state.cards) {
    for (const st of cardStatements(card, state.cardExpenses, settled)) {
      if (st.amount <= 0 && !st.paid) continue
      const date = eff(st.dueDate)
      if (date < from || date > to) continue
      const closed = st.closeDate < todayISO
      out.push({
        key: cardKey(card.id, st.period),
        sourceType: 'card',
        sourceId: card.id,
        companyId: card.companyId,
        title: card.name,
        subtitle: `${card.bank} · ${closed ? 'Ekstre' : 'Açık dönem (henüz kesilmedi)'}`,
        date,
        scheduledDate: st.dueDate,
        amount: st.paid && st.settlement ? st.settlement.amount : st.amount,
        currency: 'TRY',
        direction: 'out',
        paid: st.paid,
        category: SYSTEM_CATEGORIES.card,
      })
    }
  }

  for (const ch of state.cheques) {
    if (ch.status === 'bounced' || ch.status === 'endorsed') continue
    const date = eff(ch.dueDate)
    if (date < from || date > to) continue
    const received = ch.type === 'received'
    const label = ch.instrument === 'note' ? 'Senet' : 'Çek'
    out.push({
      key: chequeKey(ch.id),
      sourceType: 'cheque',
      sourceId: ch.id,
      companyId: ch.companyId,
      contactId: ch.contactId,
      title: ch.number ? `${label} No ${ch.number}` : ch.description || label,
      subtitle: [ch.bank, ch.description, received ? `Alınan ${label.toLowerCase()}` : `Verilen ${label.toLowerCase()}`]
        .filter(Boolean)
        .join(' · '),
      date,
      scheduledDate: ch.dueDate,
      amount: ch.amount,
      currency: ch.currency,
      direction: received ? 'in' : 'out',
      paid: ch.status === 'cleared' || !!settled[chequeKey(ch.id)],
      category: received ? SYSTEM_CATEGORIES.chequeIn : SYSTEM_CATEGORIES.chequeOut,
    })
  }

  for (const p of state.payments) {
    const recurrenceLabel = p.recurrence === 'monthly' ? ' · Aylık' : p.recurrence === 'weekly' ? ' · Haftalık' : ''
    for (const d of paymentScheduledDates(p, from, to)) {
      const ex = p.exceptions[d]
      if (ex?.skip) continue
      const key = paymentKey(p.id, d)
      const s = settled[key]
      out.push({
        key,
        sourceType: 'payment',
        sourceId: p.id,
        companyId: p.companyId,
        contactId: p.contactId,
        title: p.title,
        subtitle: (p.category || 'Diğer') + recurrenceLabel + (ex?.amount !== undefined ? ' · bu ay farklı tutar' : ''),
        date: d,
        scheduledDate: d,
        amount: s ? s.amount : (ex?.amount ?? p.amount),
        currency: p.currency,
        direction: p.type,
        paid: !!s,
        category: p.category || 'Diğer',
      })
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title, 'tr')))
}

/** Gecikmişleri bulmak için verideki en eski tarih (eski 12 ay sınırı kaldırıldı). */
export function earliestDate(state: State): ISODate {
  let min = today()
  const consider = (d?: string) => {
    if (d && d < min) min = d
  }
  state.loans.forEach((l) => consider(l.firstDueDate))
  state.payments.forEach((p) => consider(p.date))
  state.cheques.forEach((c) => consider(c.dueDate))
  state.cardExpenses.forEach((e) => consider(e.date))
  state.cards.forEach((c) => consider(`${c.openingPeriod}-01`))
  return addDays(min, -45)
}

/** Ödenmemiş ve tarihi geçmiş bütün vadeler. */
export function overdueOccurrences(state: State, todayISO: ISODate = today()): Occurrence[] {
  return generateOccurrences(state, earliestDate(state), addDays(todayISO, -1)).filter((o) => !o.paid)
}

/** Seçili şirkete göre filtrelenmiş görünüm. */
export function scopeState(state: State, companyId: string | 'all'): State {
  if (companyId === 'all') return state
  const cardIds = new Set(state.cards.filter((c) => c.companyId === companyId).map((c) => c.id))
  const accountIds = new Set(state.accounts.filter((a) => a.companyId === companyId).map((a) => a.id))
  return {
    ...state,
    accounts: state.accounts.filter((a) => a.companyId === companyId),
    accountTx: state.accountTx.filter((t) => accountIds.has(t.accountId)),
    budgets: state.budgets.filter((b) => b.companyId === companyId),
    loans: state.loans.filter((l) => l.companyId === companyId),
    cards: state.cards.filter((c) => c.companyId === companyId),
    cardExpenses: state.cardExpenses.filter((e) => cardIds.has(e.cardId)),
    payments: state.payments.filter((p) => p.companyId === companyId),
    contacts: state.contacts.filter((c) => c.companyId === companyId),
    cheques: state.cheques.filter((c) => c.companyId === companyId),
  }
}

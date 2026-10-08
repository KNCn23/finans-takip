// Özet, bütçe, rapor ve nakit akışı hesapları.

import type { Account, Budget, ISODate, Minor, MonthKey, Occurrence, State } from './types'
import {
  addDays,
  addMonthKey,
  addMonths,
  daysBetween,
  monthKey,
  monthRange,
  monthsBetween,
  startOfWeek,
} from './dates'
import { toTRY } from './money'
import { normCategory } from './defaults'
import { generateOccurrences, overdueOccurrences, SYSTEM_CATEGORIES } from './occurrences'
import { cardStatements, cardSummary } from './cards'
import { loanSchedule, loanSummary } from './loans'

// ---------------------------------------------------------------- Hesaplar

export function isLiquid(a: Account): boolean {
  return a.kind !== 'deposit'
}

export interface AccountTotals {
  /** Bütün hesapların TL karşılığı */
  total: Minor
  /** Vadesiz + kasa + KMH (harcanabilir) */
  liquid: Minor
  deposits: Minor
  /** KMH'lerde kalan kullanılabilir limit */
  overdraftAvailable: Minor
}

export function accountTotals(state: State): AccountTotals {
  const rates = state.settings.rates
  const t: AccountTotals = { total: 0, liquid: 0, deposits: 0, overdraftAvailable: 0 }
  for (const a of state.accounts) {
    const v = toTRY(a.balance, a.currency, rates)
    t.total += v
    if (a.kind === 'deposit') t.deposits += v
    else t.liquid += v
    if (a.kind === 'overdraft' && a.overdraftLimit) {
      t.overdraftAvailable += toTRY(Math.max(0, a.overdraftLimit + Math.min(0, a.balance)), a.currency, rates)
    }
  }
  return t
}

/** KMH: eksi bakiyenin bir aylık tahmini faizi. */
export function overdraftMonthlyInterest(a: Account): Minor {
  if (a.kind !== 'overdraft' || !a.interestRate || a.balance >= 0) return 0
  return Math.round((-a.balance * a.interestRate) / 100 / 12)
}

/** Vadeli mevduat: vade sonunda brüt tutar (basit faiz, stopaj öncesi). */
export function depositMaturityValue(a: Account, todayISO: ISODate): Minor | undefined {
  if (a.kind !== 'deposit' || !a.interestRate || !a.maturityDate) return undefined
  const days = Math.max(0, daysBetween(todayISO, a.maturityDate))
  return Math.round(a.balance * (1 + (a.interestRate / 100) * (days / 365)))
}

// ---------------------------------------------------------------- Harcama dağılımı

export interface CategoryAmount {
  name: string
  realized: Minor
  planned: Minor
}

export interface FlowItem {
  title: string
  sub: string
  date: ISODate
  amount: Minor
  realized: boolean
  category: string
  direction: 'in' | 'out'
}

/**
 * [from, to] aralığındaki gelir ve giderler.
 * - Kart ekstre ödemeleri sayılmaz (kart harcamaları kalem kalem sayılır).
 * - Taksitli kart harcaması, taksitlerin düştüğü aylara bölünür.
 * - "Gerçekleşen": ödendi işaretli vade veya bugüne kadar yapılmış kart harcaması.
 */
export function flowItems(state: State, from: ISODate, to: ISODate, todayISO: ISODate): FlowItem[] {
  const rates = state.settings.rates
  const items: FlowItem[] = []
  for (const o of generateOccurrences(state, from, to)) {
    if (o.sourceType === 'card') continue
    items.push({
      title: o.title,
      sub: o.subtitle,
      date: o.date,
      amount: toTRY(o.amount, o.currency, rates),
      realized: o.paid,
      category: o.category,
      direction: o.direction,
    })
  }
  const cards = new Map(state.cards.map((c) => [c.id, c]))
  for (const e of state.cardExpenses) {
    const card = cards.get(e.cardId)
    const n = Math.max(1, e.installments)
    const base = Math.trunc(e.amount / n)
    let rest = e.amount - base * n
    for (let i = 0; i < n; i++) {
      const part = base + (rest > 0 ? 1 : 0)
      if (rest > 0) rest--
      const d = addMonths(e.date, i)
      if (d < from || d > to) continue
      items.push({
        title: e.title || e.category,
        sub: `${card?.name ?? 'Kart'} · ${e.category}${n > 1 ? ` · Taksit ${i + 1}/${n}` : ''}`,
        date: d,
        amount: part,
        realized: e.date <= todayISO,
        category: e.category,
        direction: 'out',
      })
    }
  }
  return items
}

export function byCategory(items: FlowItem[], direction: 'in' | 'out'): CategoryAmount[] {
  const map = new Map<string, CategoryAmount>()
  for (const it of items) {
    if (it.direction !== direction) continue
    const k = normCategory(it.category || 'Diğer')
    const row = map.get(k) ?? { name: it.category || 'Diğer', realized: 0, planned: 0 }
    if (it.realized) row.realized += it.amount
    else row.planned += it.amount
    map.set(k, row)
  }
  return [...map.values()].sort((a, b) => b.realized + b.planned - (a.realized + a.planned))
}

// ---------------------------------------------------------------- Bütçe

export interface BudgetStatus {
  limit: Minor
  /** Önceki aylardan devreden (rollover) */
  carry: Minor
  available: Minor
  realized: Minor
  planned: Minor
  /** Gerçekleşen + planlanan */
  total: Minor
  pct: number
  level: 'ok' | 'warn' | 'over'
  from: ISODate
  to: ISODate
}

function spentFor(state: State, category: string, from: ISODate, to: ISODate, todayISO: ISODate) {
  const key = normCategory(category)
  let realized = 0
  let planned = 0
  for (const it of flowItems(state, from, to, todayISO)) {
    if (it.direction !== 'out' || normCategory(it.category) !== key) continue
    if (it.realized) realized += it.amount
    else planned += it.amount
  }
  return { realized, planned }
}

export function budgetStatus(state: State, b: Budget, month: MonthKey, todayISO: ISODate): BudgetStatus {
  let from: ISODate
  let to: ISODate
  let carry = 0
  if (b.period === 'yearly') {
    const y = month.slice(0, 4)
    from = `${y}-01-01`
    to = `${y}-12-31`
  } else {
    ;({ from, to } = monthRange(month))
    if (b.rollover && monthsBetween(b.startMonth, month) > 0) {
      // Devri başlangıç ayından itibaren hesapla (en fazla 36 ay geriye)
      let m = monthsBetween(b.startMonth, month) > 36 ? addMonthKey(month, -36) : b.startMonth
      while (m < month) {
        const r = monthRange(m)
        const s = spentFor(state, b.category, r.from, r.to, todayISO)
        carry = Math.max(0, b.limit + carry - s.realized - s.planned)
        m = addMonthKey(m, 1)
      }
    }
  }
  const { realized, planned } = spentFor(state, b.category, from, to, todayISO)
  const available = b.limit + carry
  const total = realized + planned
  const pct = available > 0 ? (total / available) * 100 : total > 0 ? 100 : 0
  return {
    limit: b.limit,
    carry,
    available,
    realized,
    planned,
    total,
    pct,
    level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
    from,
    to,
  }
}

// ---------------------------------------------------------------- Raporlar

export interface PeriodReport {
  incomeRealized: Minor
  incomePlanned: Minor
  expenseRealized: Minor
  expensePlanned: Minor
  expenseCategories: CategoryAmount[]
  incomeCategories: CategoryAmount[]
  topExpenses: FlowItem[]
}

export function periodReport(state: State, from: ISODate, to: ISODate, todayISO: ISODate): PeriodReport {
  const items = flowItems(state, from, to, todayISO)
  const r: PeriodReport = {
    incomeRealized: 0,
    incomePlanned: 0,
    expenseRealized: 0,
    expensePlanned: 0,
    expenseCategories: byCategory(items, 'out'),
    incomeCategories: byCategory(items, 'in'),
    topExpenses: items
      .filter((i) => i.direction === 'out')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8),
  }
  for (const it of items) {
    if (it.direction === 'in') {
      if (it.realized) r.incomeRealized += it.amount
      else r.incomePlanned += it.amount
    } else if (it.realized) r.expenseRealized += it.amount
    else r.expensePlanned += it.amount
  }
  return r
}

export interface MonthTotals {
  month: MonthKey
  income: Minor
  expense: Minor
  incomeRealized: Minor
  expenseRealized: Minor
}

export function monthSeries(state: State, endMonth: MonthKey, count: number, todayISO: ISODate): MonthTotals[] {
  return Array.from({ length: count }, (_, i) => {
    const month = addMonthKey(endMonth, i - count + 1)
    const { from, to } = monthRange(month)
    const r = periodReport(state, from, to, todayISO)
    return {
      month,
      income: r.incomeRealized + r.incomePlanned,
      expense: r.expenseRealized + r.expensePlanned,
      incomeRealized: r.incomeRealized,
      expenseRealized: r.expenseRealized,
    }
  })
}

// ---------------------------------------------------------------- Nakit akışı

export interface WeekForecast {
  weekStart: ISODate
  weekEnd: ISODate
  items: Occurrence[]
  income: Minor
  expense: Minor
  /** Hafta sonunda beklenen harcanabilir bakiye */
  projected: Minor
}

/**
 * Haftalık nakit akışı tahmini. Başlangıç: harcanabilir hesaplar (vadeli
 * mevduat hariç) + ödenmemiş gecikmişlerin etkisi. Her hafta yalnızca
 * ödenmemiş vadeler bakiyeyi değiştirir; ödenenler zaten hesap bakiyesine
 * yansımıştır (ödendi işaretlenirken hesap seçildiyse).
 */
export function weeklyForecast(state: State, weeks: number, todayISO: ISODate) {
  const rates = state.settings.rates
  const ws = startOfWeek(todayISO)
  const end = addDays(ws, weeks * 7 - 1)
  const occ = generateOccurrences(state, ws, end)
  const overdue = overdueOccurrences(state, todayISO)
  // Bu haftanın içindeki gecikmişler hafta listesinde zaten var; yalnızca
  // haftadan öncekiler başlangıç bakiyesine eklenir (çift sayım olmasın).
  const overdueBeforeWeek = overdue.filter((o) => o.date < ws)
  const signed = (o: Occurrence) => toTRY(o.amount, o.currency, rates) * (o.direction === 'in' ? 1 : -1)
  const overdueImpact = overdueBeforeWeek.reduce((t, o) => t + signed(o), 0)
  let running = accountTotals(state).liquid + overdueImpact
  const result: WeekForecast[] = []
  for (let w = 0; w < weeks; w++) {
    const from = addDays(ws, w * 7)
    const to = addDays(from, 6)
    const items = occ.filter((o) => o.date >= from && o.date <= to)
    let income = 0
    let expense = 0
    for (const o of items) {
      const v = toTRY(o.amount, o.currency, rates)
      if (o.direction === 'in') income += v
      else expense += v
      if (!o.paid) running += signed(o)
    }
    result.push({ weekStart: from, weekEnd: to, items, income, expense, projected: running })
  }
  return { weeks: result, overdue, overdueImpact: overdue.reduce((t, o) => t + signed(o), 0) }
}

// ---------------------------------------------------------------- Özet

export interface DebtTotals {
  loanInstallmentsLeft: Minor
  loanPrincipalLeft?: Minor
  cardUnpaid: Minor
  cardFutureInstallments: Minor
}

export function debtTotals(state: State, todayISO: ISODate): DebtTotals {
  const rates = state.settings.rates
  let loanInstallmentsLeft = 0
  let loanPrincipalLeft: number | undefined
  for (const l of state.loans) {
    const s = loanSummary(l, loanSchedule(l, state.settlements))
    loanInstallmentsLeft += toTRY(s.remainingInstallmentsTotal, l.currency, rates)
    if (s.remainingPrincipal !== undefined) loanPrincipalLeft = (loanPrincipalLeft ?? 0) + toTRY(s.remainingPrincipal, l.currency, rates)
  }
  let cardUnpaid = 0
  let cardFutureInstallments = 0
  for (const c of state.cards) {
    const sum = cardSummary(c, cardStatements(c, state.cardExpenses, state.settlements), todayISO)
    cardUnpaid += sum.totalUnpaid - sum.futureInstallments
    cardFutureInstallments += sum.futureInstallments
  }
  return { loanInstallmentsLeft, loanPrincipalLeft, cardUnpaid, cardFutureInstallments }
}

/** Yaklaşan (bugün dahil N gün içinde) ödenmemiş vadeler — bildirimler için. */
export function upcomingDue(state: State, todayISO: ISODate, days: number): Occurrence[] {
  return generateOccurrences(state, todayISO, addDays(todayISO, days)).filter((o) => !o.paid)
}

export function isSystemCategory(name: string): boolean {
  return Object.values(SYSTEM_CATEGORIES).some((c) => normCategory(c) === normCategory(name))
}

export function currentMonth(todayISO: ISODate): MonthKey {
  return monthKey(todayISO)
}

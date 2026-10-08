import type { Card, CardExpense, ISODate, Minor, MonthKey, Settlement } from './types'
import { addMonthKey, dayOfMonth, monthKey } from './dates'
import { splitEven } from './money'

// Dönem anahtarı = ekstrenin SON ÖDEME ayı (YYYY-MM).
//
// Son ödeme günü kesim gününden büyükse (kesim 1, ödeme 11) ekstre aynı ay
// kesilir ve ödenir; değilse (kesim 18, ödeme 8) bir önceki ay kesilir.

function dueAfterStatementSameMonth(card: Pick<Card, 'statementDay' | 'dueDay'>): boolean {
  return card.dueDay > card.statementDay
}

/** M dönemi ekstresinin kesim tarihi. */
export function statementCloseDate(card: Card, period: MonthKey): ISODate {
  const closeMonth = dueAfterStatementSameMonth(card) ? period : addMonthKey(period, -1)
  return dayOfMonth(closeMonth, card.statementDay)
}

/** M dönemi ekstresinin son ödeme tarihi (kaydırılmamış). */
export function statementDueDate(card: Card, period: MonthKey): ISODate {
  return dayOfMonth(period, card.dueDay)
}

/** M döneminin harcama aralığı: (önceki kesim, bu kesim] */
export function statementRange(card: Card, period: MonthKey): { from: ISODate; to: ISODate } {
  const prevClose = statementCloseDate(card, addMonthKey(period, -1))
  const close = statementCloseDate(card, period)
  // from = önceki kesimden sonraki gün
  const [y, m, d] = prevClose.split('-').map(Number) as [number, number, number]
  const next = new Date(y, m - 1, d + 1)
  const from = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
  return { from, to: close }
}

/** Belirli bir tarihte yapılan harcamanın düştüğü dönem. */
export function periodForDate(card: Card, date: ISODate): MonthKey {
  const m = monthKey(date)
  const closeMonth = date <= dayOfMonth(m, card.statementDay) ? m : addMonthKey(m, 1)
  return dueAfterStatementSameMonth(card) ? closeMonth : addMonthKey(closeMonth, 1)
}

export interface ExpensePart {
  expenseId: string
  period: MonthKey
  index: number
  count: number
  amount: Minor
  counts: boolean
}

/** Harcamayı taksitlerine böler ve her taksidi dönemine yerleştirir. */
export function expenseParts(card: Card, e: CardExpense): ExpensePart[] {
  const count = Math.max(1, Math.floor(e.installments || 1))
  const first = periodForDate(card, e.date)
  return splitEven(e.amount, count).map((amount, i) => ({
    expenseId: e.id,
    period: addMonthKey(first, i),
    index: i + 1,
    count,
    amount,
    counts: e.countsToStatement,
  }))
}

export interface Statement {
  cardId: string
  period: MonthKey
  closeDate: ISODate
  dueDate: ISODate
  /** Hesaplanan tutar (açılış borcu + dönemdeki taksitler) */
  computed: Minor
  /** Kullanıcının girdiği gerçek ekstre tutarı varsa o, yoksa hesaplanan */
  amount: Minor
  overridden: boolean
  parts: ExpensePart[]
  paid: boolean
  settlement?: Settlement
}

export function cardKey(cardId: string, period: MonthKey): string {
  return `card:${cardId}:${period}`
}

/** Kartın tutarı olan bütün ekstreleri (geçmiş, açık ve gelecek taksitli dönemler). */
export function cardStatements(
  card: Card,
  expenses: CardExpense[],
  settlements: Record<string, Settlement>,
): Statement[] {
  const byPeriod = new Map<MonthKey, ExpensePart[]>()
  for (const e of expenses) {
    if (e.cardId !== card.id) continue
    for (const p of expenseParts(card, e)) {
      const list = byPeriod.get(p.period) ?? []
      list.push(p)
      byPeriod.set(p.period, list)
    }
  }
  const periods = new Set<MonthKey>(byPeriod.keys())
  if (card.openingDebt > 0) periods.add(card.openingPeriod)
  for (const p of Object.keys(card.statementOverrides)) periods.add(p)
  for (const k of Object.keys(settlements)) {
    if (k.startsWith(`card:${card.id}:`)) periods.add(k.slice(`card:${card.id}:`.length))
  }
  const out: Statement[] = []
  for (const period of [...periods].sort()) {
    const parts = byPeriod.get(period) ?? []
    let computed = parts.filter((p) => p.counts).reduce((t, p) => t + p.amount, 0)
    if (period === card.openingPeriod) computed += card.openingDebt
    const override = card.statementOverrides[period]
    const overridden = override !== undefined
    const amount = overridden ? override : computed
    const settlement = settlements[cardKey(card.id, period)]
    if (amount <= 0 && !settlement && parts.length === 0) continue
    out.push({
      cardId: card.id,
      period,
      closeDate: statementCloseDate(card, period),
      dueDate: statementDueDate(card, period),
      computed,
      amount,
      overridden,
      parts,
      paid: !!settlement,
      settlement,
    })
  }
  return out
}

export interface CardSummary {
  /** Bugünkü harcamaların düştüğü (henüz kesilmemiş) dönem */
  openPeriod: MonthKey
  /** Ödenmemiş, kesilmiş ekstreler (vadesi geçmiş veya yaklaşan) */
  unpaidClosed: Statement[]
  /** Açık dönemin şimdiye kadarki tutarı */
  openStatement?: Statement
  /** Açık dönemden sonraki dönemlere düşen taksitler */
  futureInstallments: Minor
  /** Ödenmemiş tüm tutar (limit kullanımı) */
  totalUnpaid: Minor
  /** Kullanılabilir limit */
  available: Minor
}

export function cardSummary(card: Card, statements: Statement[], todayISO: ISODate): CardSummary {
  const openPeriod = periodForDate(card, todayISO)
  const unpaid = statements.filter((s) => !s.paid && s.amount > 0)
  const unpaidClosed = unpaid.filter((s) => s.period < openPeriod)
  const openStatement = statements.find((s) => s.period === openPeriod)
  const futureInstallments = unpaid.filter((s) => s.period > openPeriod).reduce((t, s) => t + s.amount, 0)
  const totalUnpaid = unpaid.reduce((t, s) => t + s.amount, 0)
  return {
    openPeriod,
    unpaidClosed,
    openStatement,
    futureInstallments,
    totalUnpaid,
    available: card.limit - totalUnpaid,
  }
}

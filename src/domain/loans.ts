import type { ISODate, Loan, Minor, Settlement } from './types'
import { addMonths } from './dates'

export function loanKey(loanId: string, n: number | 'payoff'): string {
  return `loan:${loanId}:${n}`
}

export interface Installment {
  n: number
  dueDate: ISODate
  amount: Minor
  /** Faiz ve anapara (anapara + oran biliniyorsa) */
  interest?: Minor
  principalPart?: Minor
  /** Bu taksit ödendikten sonra kalan anapara */
  remainingPrincipal?: Minor
  paid: boolean
  /** Erken kapamayla kapatıldı */
  closed: boolean
}

export function installmentAmount(loan: Loan, n: number): Minor {
  return loan.installmentOverrides[n] ?? loan.installmentAmount
}

/** Yıllık oranı aylık orana çevirir. */
function monthlyRate(annualRate: number): number {
  return annualRate / 100 / 12
}

/**
 * Anapara, taksit ve vadeden aylık faiz oranını bulur (Newton-Raphson).
 * Yıllık % olarak döner; çözülemezse undefined.
 */
export function impliedAnnualRate(principal: Minor, payment: Minor, n: number): number | undefined {
  if (principal <= 0 || payment <= 0 || n <= 0) return undefined
  if (payment * n <= principal) return payment * n === principal ? 0 : undefined
  let r = 0.02
  for (let i = 0; i < 100; i++) {
    const f = (principal * r) / (1 - Math.pow(1 + r, -n)) - payment
    const h = 1e-7
    const f2 = (principal * (r + h)) / (1 - Math.pow(1 + r + h, -n)) - payment
    const d = (f2 - f) / h
    if (!Number.isFinite(d) || d === 0) return undefined
    const next = r - f / d
    if (Math.abs(next - r) < 1e-10) return Math.max(0, next * 12 * 100)
    r = next <= 0 ? r / 2 : next
  }
  return undefined
}

/** Eşit taksit tutarı (anüite): anapara, yıllık oran ve vadeden. */
export function annuityPayment(principal: Minor, annualRate: number, n: number): Minor {
  const r = monthlyRate(annualRate)
  if (r === 0) return Math.round(principal / n)
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -n)))
}

/** Taksit planı. Anapara biliniyorsa her taksitte faiz/anapara ayrımı yapılır. */
export function loanSchedule(loan: Loan, settlements: Record<string, Settlement>): Installment[] {
  const rate =
    loan.annualRate !== undefined
      ? loan.annualRate
      : loan.principal
        ? impliedAnnualRate(loan.principal, loan.installmentAmount, loan.installmentCount)
        : undefined
  const r = rate !== undefined ? monthlyRate(rate) : undefined
  let balance = loan.principal
  const out: Installment[] = []
  const closeAfter = loan.earlyClosure?.afterInstallment
  for (let n = 1; n <= loan.installmentCount; n++) {
    const amount = installmentAmount(loan, n)
    const closed = closeAfter !== undefined && n > closeAfter
    const inst: Installment = {
      n,
      dueDate: addMonths(loan.firstDueDate, n - 1),
      amount,
      paid: !!settlements[loanKey(loan.id, n)],
      closed,
    }
    if (balance !== undefined && r !== undefined && !closed) {
      const interest = Math.max(0, Math.round(balance * r))
      const principalPart = Math.min(balance, amount - interest)
      balance = Math.max(0, balance - principalPart)
      inst.interest = interest
      inst.principalPart = principalPart
      inst.remainingPrincipal = balance
    }
    out.push(inst)
  }
  return out
}

export interface LoanSummary {
  paidCount: number
  /** Ödenmemiş (ve kapatılmamış) taksitlerin toplamı — faiz dahil */
  remainingInstallmentsTotal: Minor
  /** Kalan anapara ≈ erken kapama tutarı (anapara biliniyorsa) */
  remainingPrincipal?: Minor
  /** Kalan faiz yükü (anapara biliniyorsa) */
  remainingInterest?: Minor
  effectiveAnnualRate?: number
  nextDue?: Installment
  closed: boolean
}

export function loanSummary(loan: Loan, schedule: Installment[]): LoanSummary {
  const open = schedule.filter((i) => !i.paid && !i.closed)
  const paidCount = schedule.filter((i) => i.paid).length
  const remainingInstallmentsTotal = open.reduce((t, i) => t + i.amount, 0)
  let remainingPrincipal: Minor | undefined
  let remainingInterest: Minor | undefined
  if (loan.principal !== undefined && schedule[0]?.remainingPrincipal !== undefined) {
    // Ödenmemiş ilk taksitten önceki kalan anapara
    const firstOpen = open[0]
    if (!firstOpen) remainingPrincipal = 0
    else {
      const prev = schedule[firstOpen.n - 2]
      remainingPrincipal = prev ? (prev.remainingPrincipal ?? 0) : loan.principal
    }
    remainingInterest = open.reduce((t, i) => t + (i.interest ?? 0), 0)
  }
  const effectiveAnnualRate =
    loan.annualRate ??
    (loan.principal ? impliedAnnualRate(loan.principal, loan.installmentAmount, loan.installmentCount) : undefined)
  return {
    paidCount,
    remainingInstallmentsTotal,
    remainingPrincipal: loan.earlyClosure ? 0 : remainingPrincipal,
    remainingInterest: loan.earlyClosure ? 0 : remainingInterest,
    effectiveAnnualRate,
    nextDue: open[0],
    closed: !!loan.earlyClosure || open.length === 0,
  }
}

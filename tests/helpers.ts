import type { Card, Loan, Payment, State } from '../src/domain/types'
import { emptyState } from '../src/domain/defaults'

export function stateWith(patch: Partial<State>): State {
  const s = emptyState()
  return { ...s, ...patch, settings: { ...s.settings, shiftToBusinessDay: false, ...(patch.settings ?? {}) } }
}

export const card = (p: Partial<Card> = {}): Card => ({
  id: 'k1', companyId: 'c', name: 'Bonus', bank: 'Garanti', limit: 10000000,
  statementDay: 1, dueDay: 11, openingDebt: 0, openingPeriod: '2026-10', statementOverrides: {}, ...p,
})

export const loan = (p: Partial<Loan> = {}): Loan => ({
  id: 'l1', companyId: 'c', name: 'Kredi', bank: 'Ziraat', currency: 'TRY',
  installmentAmount: 100000, installmentCount: 12, firstDueDate: '2026-01-15', installmentOverrides: {}, ...p,
})

export const payment = (p: Partial<Payment> = {}): Payment => ({
  id: 'p1', companyId: 'c', type: 'out', title: 'Kira', category: 'Kira', currency: 'TRY',
  amount: 500000, date: '2026-01-31', recurrence: 'monthly', exceptions: {}, ...p,
})

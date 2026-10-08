import type { Category, CategoryKind, Settings, State } from './types'

/** Çakışma riski olmayan kimlik (Math.random yerine). */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export const DEFAULT_OUT_CATEGORIES = [
  'Yemek',
  'Market',
  'Yakıt',
  'Ulaşım',
  'Fatura',
  'Kira',
  'Ofis',
  'Personel',
  'Vergi / SGK',
  'Tedarik',
  'Bakım',
  'Eğlence',
  'Diğer',
]
export const DEFAULT_IN_CATEGORIES = ['Satış', 'Maaş', 'Kira Geliri', 'Faiz / Getiri', 'Diğer Gelir']

/** Kategori adlarını karşılaştırmak için: "  fatura " ile "Fatura" aynıdır. */
export function normCategory(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
}

export function defaultCategories(): Category[] {
  return [
    ...DEFAULT_OUT_CATEGORIES.map((name) => ({ id: newId(), name, kind: 'out' as const })),
    ...DEFAULT_IN_CATEGORIES.map((name) => ({ id: newId(), name, kind: 'in' as const })),
  ]
}

/** Listede yoksa kategoriyi ekler; varsa kanonik yazımını döndürür. */
export function ensureCategory(
  categories: Category[],
  name: string,
  kind: CategoryKind,
): { categories: Category[]; name: string } {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return { categories, name: kind === 'in' ? 'Diğer Gelir' : 'Diğer' }
  const existing = categories.find((c) => normCategory(c.name) === normCategory(clean))
  if (existing) return { categories, name: existing.name }
  return { categories: [...categories, { id: newId(), name: clean, kind }], name: clean }
}

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    shiftToBusinessDay: true,
    notifications: true,
    notifyDaysBefore: 2,
    rates: { TRY: 1, USD: 0, EUR: 0, GBP: 0, XAU: 0 },
    lockAfterMinutes: 0,
  }
}

export function emptyState(): State {
  const company = { id: newId(), name: 'Merkez Şirket' }
  return {
    schemaVersion: 2,
    companies: [company],
    activeCompanyId: company.id,
    categories: defaultCategories(),
    accounts: [],
    accountTx: [],
    budgets: [],
    loans: [],
    cards: [],
    cardExpenses: [],
    payments: [],
    contacts: [],
    cheques: [],
    settlements: {},
    settings: defaultSettings(),
  }
}

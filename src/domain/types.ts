// Uygulamanın veri modeli (şema sürümü 2).
//
// Tüm parasal tutarlar "kuruş" cinsinden TAMSAYI olarak tutulur (Minor).
// Döviz ve altın için de aynı kural geçerlidir: 1/100 birim (sent, gramın
// yüzde biri). Böylece toplama/çıkarmada kayan nokta hatası birikmez.

export type ID = string
/** YYYY-MM-DD */
export type ISODate = string
/** YYYY-MM */
export type MonthKey = string
/** Kuruş (1/100 birim) cinsinden tamsayı tutar. */
export type Minor = number

export const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'XAU'] as const
export type Currency = (typeof CURRENCIES)[number]

export interface Company {
  id: ID
  name: string
}

export type CategoryKind = 'in' | 'out'
export interface Category {
  id: ID
  name: string
  kind: CategoryKind
}

export type AccountKind = 'bank' | 'cash' | 'deposit' | 'overdraft'
export interface Account {
  id: ID
  companyId: ID
  name: string
  kind: AccountKind
  currency: Currency
  balance: Minor
  /** KMH (kredili mevduat) limiti — yalnızca kind = overdraft */
  overdraftLimit?: Minor
  /** Yıllık faiz oranı (%) — vadeli mevduat ve KMH için */
  interestRate?: number
  /** Vadeli mevduat vade tarihi */
  maturityDate?: ISODate
}

export type AccountTxKind = 'adjust' | 'expense' | 'income' | 'transfer' | 'settlement' | 'import'
/** Hesap bakiyesini değiştiren her işlemin kaydı (hesap hareketleri). */
export interface AccountTx {
  id: ID
  accountId: ID
  date: ISODate
  /** İşaretli tutar: + giriş, − çıkış (hesabın kendi para biriminde) */
  amount: Minor
  kind: AccountTxKind
  note: string
  /** Bağlı olduğu vade anahtarı veya transfer kimliği */
  ref?: string
}

export type BudgetPeriod = 'monthly' | 'yearly'
export interface Budget {
  id: ID
  companyId: ID
  category: string
  limit: Minor
  period: BudgetPeriod
  /** Aylık bütçede kullanılmayan tutar sonraki aya devreder */
  rollover: boolean
  /** Devrin başladığı ay */
  startMonth: MonthKey
}

export interface Loan {
  id: ID
  companyId: ID
  name: string
  bank: string
  currency: Currency
  installmentAmount: Minor
  installmentCount: number
  firstDueDate: ISODate
  /** Çekilen anapara (biliniyorsa) */
  principal?: Minor
  /** Yıllık akdi faiz (%) (biliniyorsa) */
  annualRate?: number
  /** Değişken faizli / farklı tutarlı taksitler: taksit no → tutar */
  installmentOverrides: Record<number, Minor>
  /** Erken kapama: bu taksitten SONRAKİ taksitler tek ödemeyle kapatıldı */
  earlyClosure?: { date: ISODate; amount: Minor; afterInstallment: number }
}

export interface Card {
  id: ID
  companyId: ID
  name: string
  bank: string
  limit: Minor
  statementDay: number
  dueDay: number
  /**
   * Kart tanımlanırken girilen, kalem kalem girilmemiş borç. openingPeriod
   * dönemine (son ödeme ayına) eklenir.
   */
  openingDebt: Minor
  openingPeriod: MonthKey
  /** Bankadan gelen gerçek ekstre tutarı (dönem → tutar); hesaplananın yerine geçer */
  statementOverrides: Record<MonthKey, Minor>
}

export interface CardExpense {
  id: ID
  cardId: ID
  date: ISODate
  category: string
  title: string
  /** Toplam tutar */
  amount: Minor
  /** Taksit sayısı (1 = peşin) */
  installments: number
  /** false: yalnızca raporlarda görünür, ekstre borcuna eklenmez */
  countsToStatement: boolean
}

export type Recurrence = 'once' | 'weekly' | 'monthly'
export interface PaymentException {
  amount?: Minor
  skip?: boolean
}
export interface Payment {
  id: ID
  companyId: ID
  contactId?: ID
  type: 'in' | 'out'
  title: string
  category: string
  currency: Currency
  amount: Minor
  date: ISODate
  recurrence: Recurrence
  endDate?: ISODate
  /** Tekrarlayan kaydın tek bir vadesine özel değişiklik: planlanan tarih → değişiklik */
  exceptions: Record<ISODate, PaymentException>
}

export type ContactType = 'customer' | 'supplier' | 'both'
export interface Contact {
  id: ID
  companyId: ID
  name: string
  type: ContactType
  phone: string
  email: string
  taxNo: string
  note: string
  /** Açılış bakiyesi: + bizim alacağımız, − bizim borcumuz (TRY) */
  openingBalance: Minor
}

export type ChequeStatus = 'pending' | 'cleared' | 'bounced' | 'endorsed'
export interface ChequeEvent {
  date: ISODate
  status: ChequeStatus
  note?: string
}
export interface Cheque {
  id: ID
  companyId: ID
  instrument: 'cheque' | 'note'
  type: 'received' | 'issued'
  bank: string
  number: string
  contactId?: ID
  description: string
  currency: Currency
  amount: Minor
  dueDate: ISODate
  status: ChequeStatus
  /** Ciro edilen cari */
  endorsedToContactId?: ID
  history: ChequeEvent[]
}

/** Bir vadenin ödendiğini/tahsil edildiğini kaydeder. Anahtar: Occurrence.key */
export interface Settlement {
  key: string
  date: ISODate
  amount: Minor
  currency: Currency
  /** Ödemenin yapıldığı/tahsilatın girdiği hesap; boşsa bakiyeye dokunulmadı */
  accountId?: ID
  txId?: ID
}

export type Theme = 'system' | 'light' | 'dark'
export interface Settings {
  theme: Theme
  /** Kredi/kart/çek vadelerini hafta sonu ve resmi tatilden sonraki iş gününe kaydır */
  shiftToBusinessDay: boolean
  notifications: boolean
  notifyDaysBefore: number
  /** 1 birim döviz = kaç TL */
  rates: Record<Currency, number>
  ratesUpdatedAt?: string
  pinHash?: string
  pinSalt?: string
  /** Hareketsizlikte kilitlenme süresi (dk); 0 = kapalı */
  lockAfterMinutes: number
}

export interface State {
  schemaVersion: 2
  companies: Company[]
  activeCompanyId: ID | 'all'
  categories: Category[]
  accounts: Account[]
  accountTx: AccountTx[]
  budgets: Budget[]
  loans: Loan[]
  cards: Card[]
  cardExpenses: CardExpense[]
  payments: Payment[]
  contacts: Contact[]
  cheques: Cheque[]
  settlements: Record<string, Settlement>
  settings: Settings
}

export type SourceType = 'loan' | 'card' | 'cheque' | 'payment'

/** Takvimde görünen tek bir vade (taksit, ekstre, çek, gelir/gider). */
export interface Occurrence {
  key: string
  sourceType: SourceType
  sourceId: ID
  companyId: ID
  contactId?: ID
  title: string
  subtitle: string
  /** Etkin tarih (iş gününe kaydırılmış olabilir) */
  date: ISODate
  /** Orijinal planlanan tarih */
  scheduledDate: ISODate
  amount: Minor
  currency: Currency
  direction: 'in' | 'out'
  paid: boolean
  category: string
}

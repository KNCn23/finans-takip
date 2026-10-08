// Yedek dosya biçimleri: JSON (tam doğruluk) ve Excel (okunabilir).
// Excel modülü büyük olduğu için arayüz bu dosyayı ihtiyaç anında yükler.

import * as XLSX from 'xlsx'
import type { State } from './types'
import { CURRENT_SCHEMA, migrate, type MigrationReport } from './migrate'
import { parseAmount, toMajor, toMinor } from './money'
import { toISO } from './dates'

// ---------------------------------------------------------------- JSON

export interface JsonBackup {
  app: 'finans-takip'
  schemaVersion: number
  exportedAt: string
  data: State
}

export function toJsonBackup(state: State): string {
  const b: JsonBackup = { app: 'finans-takip', schemaVersion: CURRENT_SCHEMA, exportedAt: new Date().toISOString(), data: state }
  return JSON.stringify(b, null, 2)
}

export function fromJsonBackup(text: string): { state: State; report: MigrationReport } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Dosya geçerli bir JSON değil.')
  }
  const p = parsed as Partial<JsonBackup> & Record<string, unknown>
  // Hem sarmalanmış yedek hem de çıplak veri (localStorage dökümü) kabul edilir
  const data = p && p.app === 'finans-takip' && p.data ? p.data : parsed
  return migrate(data)
}

// ---------------------------------------------------------------- Excel (v2)

const S = {
  info: 'Bilgi',
  companies: 'Şirketler',
  categories: 'Kategoriler',
  accounts: 'Hesaplar',
  accountTx: 'Hesap Hareketleri',
  budgets: 'Bütçeler',
  loans: 'Krediler',
  cards: 'Kartlar',
  expenses: 'Kart Harcamaları',
  payments: 'Gelir Gider',
  contacts: 'Cariler',
  cheques: 'Çek Senet',
  settlements: 'Ödemeler',
} as const

type Row = (string | number | boolean | null)[]
const m = (v: number | undefined) => (v === undefined ? '' : toMajor(v))
const json = (v: unknown) => (v === undefined ? '' : JSON.stringify(v))

/** Bütün veriyi okunabilir bir Excel çalışma kitabına yazar. Tutarlar TL/birim cinsindendir. */
export function exportExcel(state: State): Uint8Array {
  const wb = XLSX.utils.book_new()
  const add = (name: string, rows: Row[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = (rows[0] ?? []).map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  add(S.info, [
    ['Alan', 'Değer'],
    ['Uygulama', 'Finans Takip'],
    ['Şema', CURRENT_SCHEMA],
    ['Yedek Tarihi', new Date().toISOString()],
    ['Not', 'Tutarlar TL (veya ilgili para birimi) cinsindendir. Kimlik (ID) sütunlarını değiştirmeyin.'],
    ['Ayarlar', JSON.stringify(state.settings)],
    ['Aktif Şirket', state.activeCompanyId],
  ])
  add(S.companies, [['ID', 'Şirket Adı'], ...state.companies.map((c) => [c.id, c.name])])
  add(S.categories, [['ID', 'Kategori', 'Tür'], ...state.categories.map((c) => [c.id, c.name, c.kind === 'in' ? 'Gelir' : 'Gider'])])
  add(S.accounts, [
    ['ID', 'Hesap Adı', 'Tür', 'Para Birimi', 'Bakiye', 'KMH Limiti', 'Faiz %', 'Vade', 'Şirket ID'],
    ...state.accounts.map((a) => [a.id, a.name, a.kind, a.currency, m(a.balance), m(a.overdraftLimit), a.interestRate ?? '', a.maturityDate ?? '', a.companyId]),
  ])
  add(S.accountTx, [
    ['ID', 'Hesap ID', 'Tarih', 'Tutar', 'Tür', 'Açıklama', 'Bağlantı'],
    ...state.accountTx.map((t) => [t.id, t.accountId, t.date, m(t.amount), t.kind, t.note, t.ref ?? '']),
  ])
  add(S.budgets, [
    ['ID', 'Kategori', 'Limit', 'Dönem', 'Devir', 'Başlangıç Ayı', 'Şirket ID'],
    ...state.budgets.map((b) => [b.id, b.category, m(b.limit), b.period === 'yearly' ? 'Yıllık' : 'Aylık', b.rollover ? 'Evet' : 'Hayır', b.startMonth, b.companyId]),
  ])
  add(S.loans, [
    ['ID', 'Ad', 'Banka', 'Para Birimi', 'Taksit Tutarı', 'Taksit Sayısı', 'İlk Vade', 'Anapara', 'Yıllık Faiz %', 'Farklı Taksitler', 'Erken Kapama', 'Şirket ID'],
    ...state.loans.map((l) => [
      l.id, l.name, l.bank, l.currency, m(l.installmentAmount), l.installmentCount, l.firstDueDate, m(l.principal), l.annualRate ?? '',
      json(Object.keys(l.installmentOverrides).length ? l.installmentOverrides : undefined), json(l.earlyClosure), l.companyId,
    ]),
  ])
  add(S.cards, [
    ['ID', 'Ad', 'Banka', 'Limit', 'Kesim Günü', 'Son Ödeme Günü', 'Açılış Borcu', 'Açılış Dönemi', 'Girilen Ekstreler', 'Şirket ID'],
    ...state.cards.map((c) => [
      c.id, c.name, c.bank, m(c.limit), c.statementDay, c.dueDay, m(c.openingDebt), c.openingPeriod,
      json(Object.keys(c.statementOverrides).length ? c.statementOverrides : undefined), c.companyId,
    ]),
  ])
  add(S.expenses, [
    ['ID', 'Kart ID', 'Tarih', 'Kategori', 'Açıklama', 'Tutar', 'Taksit', 'Ekstreye Ekle'],
    ...state.cardExpenses.map((e) => [e.id, e.cardId, e.date, e.category, e.title, m(e.amount), e.installments, e.countsToStatement ? 'Evet' : 'Hayır']),
  ])
  add(S.payments, [
    ['ID', 'Tür', 'Başlık', 'Kategori', 'Para Birimi', 'Tutar', 'Tarih', 'Tekrar', 'Bitiş', 'İstisnalar', 'Cari ID', 'Şirket ID'],
    ...state.payments.map((p) => [
      p.id, p.type === 'in' ? 'Gelen' : 'Giden', p.title, p.category, p.currency, m(p.amount), p.date,
      p.recurrence === 'monthly' ? 'Aylık' : p.recurrence === 'weekly' ? 'Haftalık' : 'Tek seferlik', p.endDate ?? '',
      json(Object.keys(p.exceptions).length ? p.exceptions : undefined), p.contactId ?? '', p.companyId,
    ]),
  ])
  add(S.contacts, [
    ['ID', 'Ünvan', 'Tür', 'Telefon', 'E-posta', 'VKN/TCKN', 'Not', 'Açılış Bakiyesi', 'Şirket ID'],
    ...state.contacts.map((c) => [c.id, c.name, c.type, c.phone, c.email, c.taxNo, c.note, m(c.openingBalance), c.companyId]),
  ])
  add(S.cheques, [
    ['ID', 'Evrak', 'Tür', 'Banka', 'No', 'Para Birimi', 'Tutar', 'Vade', 'Durum', 'Açıklama', 'Cari ID', 'Ciro Edilen Cari ID', 'Geçmiş', 'Şirket ID'],
    ...state.cheques.map((c) => [
      c.id, c.instrument === 'note' ? 'Senet' : 'Çek', c.type === 'received' ? 'Alınan' : 'Verilen', c.bank, c.number, c.currency, m(c.amount),
      c.dueDate, c.status, c.description, c.contactId ?? '', c.endorsedToContactId ?? '', json(c.history), c.companyId,
    ]),
  ])
  add(S.settlements, [
    ['Anahtar', 'Tarih', 'Tutar', 'Para Birimi', 'Hesap ID', 'Hareket ID'],
    ...Object.values(state.settlements).map((s) => [s.key, s.date, m(s.amount), s.currency, s.accountId ?? '', s.txId ?? '']),
  ])
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

// ---------------------------------------------------------------- Excel içe aktarma

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

/** Excel'in tarih hücresi (Date) → YYYY-MM-DD; yerel veya UTC gece yarısını tanır. */
function dateCell(v: Date): string {
  if (v.getHours() === 0 && v.getMinutes() === 0) return toISO(v)
  if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0) return v.toISOString().slice(0, 10)
  return toISO(v)
}
const txt = (v: unknown): string => (v == null ? '' : v instanceof Date ? dateCell(v) : String(v).trim())
const numv = (v: unknown): number => {
  if (typeof v === 'number') return v
  const parsed = parseAmount(String(v ?? ''))
  return parsed === null ? 0 : parsed / 100
}
const minor = (v: unknown) => toMinor(numv(v))
const optMinor = (v: unknown) => (txt(v) === '' ? undefined : minor(v))
const parseJson = (v: unknown) => {
  const s = txt(v)
  if (!s) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function rowsOf(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true })
  return rows.slice(1).filter((r) => r.some((c) => txt(c) !== ''))
}

/** Excel yedeğini okur (bu sürümün yedekleri ve ilk sürümün yedekleri). */
export function importExcel(data: ArrayBuffer | Uint8Array): { state: State; report: MigrationReport } {
  const wb = XLSX.read(data, { type: 'array', cellDates: true })
  const info = rowsOf(wb, S.info)
  const schema = info.find((r) => txt(r[0]) === 'Şema')
  if (schema && numv(schema[1]) === 2) return migrate(readV2(wb, info))
  return migrate(readV1(wb))
}

function readV2(wb: XLSX.WorkBook, info: unknown[][]): Any {
  const infoVal = (k: string) => info.find((r) => txt(r[0]) === k)?.[1]
  const required = [S.companies, S.payments, S.loans, S.cards]
  const missing = required.filter((n) => !wb.Sheets[n])
  if (missing.length) throw new Error(`Geçersiz yedek: "${missing.join('", "')}" sayfası bulunamadı.`)
  const settlements: Record<string, Any> = {}
  for (const r of rowsOf(wb, S.settlements)) {
    const key = txt(r[0])
    if (key) settlements[key] = { key, date: txt(r[1]), amount: minor(r[2]), currency: txt(r[3]) || 'TRY', accountId: txt(r[4]) || undefined, txId: txt(r[5]) || undefined }
  }
  return {
    schemaVersion: 2,
    settings: parseJson(infoVal('Ayarlar')) ?? {},
    activeCompanyId: txt(infoVal('Aktif Şirket')) || 'all',
    companies: rowsOf(wb, S.companies).map((r) => ({ id: txt(r[0]), name: txt(r[1]) })),
    categories: rowsOf(wb, S.categories).map((r) => ({ id: txt(r[0]), name: txt(r[1]), kind: txt(r[2]) === 'Gelir' ? 'in' : 'out' })),
    accounts: rowsOf(wb, S.accounts).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), kind: txt(r[2]), currency: txt(r[3]), balance: minor(r[4]), overdraftLimit: optMinor(r[5]),
      interestRate: txt(r[6]) === '' ? undefined : numv(r[6]), maturityDate: txt(r[7]) || undefined, companyId: txt(r[8]),
    })),
    accountTx: rowsOf(wb, S.accountTx).map((r) => ({ id: txt(r[0]), accountId: txt(r[1]), date: txt(r[2]), amount: minor(r[3]), kind: txt(r[4]), note: txt(r[5]), ref: txt(r[6]) || undefined })),
    budgets: rowsOf(wb, S.budgets).map((r) => ({
      id: txt(r[0]), category: txt(r[1]), limit: minor(r[2]), period: txt(r[3]) === 'Yıllık' ? 'yearly' : 'monthly', rollover: txt(r[4]) === 'Evet', startMonth: txt(r[5]), companyId: txt(r[6]),
    })),
    loans: rowsOf(wb, S.loans).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), bank: txt(r[2]), currency: txt(r[3]), installmentAmount: minor(r[4]), installmentCount: numv(r[5]), firstDueDate: txt(r[6]),
      principal: optMinor(r[7]), annualRate: txt(r[8]) === '' ? undefined : numv(r[8]), installmentOverrides: parseJson(r[9]) ?? {}, earlyClosure: parseJson(r[10]), companyId: txt(r[11]),
    })),
    cards: rowsOf(wb, S.cards).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), bank: txt(r[2]), limit: minor(r[3]), statementDay: numv(r[4]), dueDay: numv(r[5]), openingDebt: minor(r[6]), openingPeriod: txt(r[7]),
      statementOverrides: parseJson(r[8]) ?? {}, companyId: txt(r[9]),
    })),
    cardExpenses: rowsOf(wb, S.expenses).map((r) => ({
      id: txt(r[0]), cardId: txt(r[1]), date: txt(r[2]), category: txt(r[3]), title: txt(r[4]), amount: minor(r[5]), installments: numv(r[6]) || 1, countsToStatement: txt(r[7]) !== 'Hayır',
    })),
    payments: rowsOf(wb, S.payments).map((r) => ({
      id: txt(r[0]), type: txt(r[1]) === 'Gelen' ? 'in' : 'out', title: txt(r[2]), category: txt(r[3]), currency: txt(r[4]), amount: minor(r[5]), date: txt(r[6]),
      recurrence: txt(r[7]).startsWith('Aylık') ? 'monthly' : txt(r[7]).startsWith('Haftalık') ? 'weekly' : 'once', endDate: txt(r[8]) || undefined,
      exceptions: parseJson(r[9]) ?? {}, contactId: txt(r[10]) || undefined, companyId: txt(r[11]),
    })),
    contacts: rowsOf(wb, S.contacts).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), type: txt(r[2]), phone: txt(r[3]), email: txt(r[4]), taxNo: txt(r[5]), note: txt(r[6]), openingBalance: minor(r[7]), companyId: txt(r[8]),
    })),
    cheques: rowsOf(wb, S.cheques).map((r) => ({
      id: txt(r[0]), instrument: txt(r[1]) === 'Senet' ? 'note' : 'cheque', type: txt(r[2]) === 'Verilen' ? 'issued' : 'received', bank: txt(r[3]), number: txt(r[4]),
      currency: txt(r[5]), amount: minor(r[6]), dueDate: txt(r[7]), status: txt(r[8]), description: txt(r[9]), contactId: txt(r[10]) || undefined,
      endorsedToContactId: txt(r[11]) || undefined, history: parseJson(r[12]) ?? [], companyId: txt(r[13]),
    })),
    settlements,
  }
}

/** İlk sürümün Excel yedeği → v1 nesnesi (tutarlar TL). migrate() v2'ye çevirir. */
function readV1(wb: XLSX.WorkBook): Any {
  const V1 = { summary: 'Özet', companies: 'Şirketler', accounts: 'Hesaplar', budgets: 'Bütçeler', loans: 'Krediler', cards: 'Kartlar', expenses: 'Kart Harcamaları', payments: 'Gelir Gider', contacts: 'Cariler', cheques: 'Çekler' }
  const missing = [V1.loans, V1.cards, V1.payments].filter((n) => !wb.Sheets[n])
  if (missing.length) throw new Error(`Geçersiz yedek: "${missing.join('", "')}" sayfası bulunamadı.`)
  const accounts = rowsOf(wb, V1.accounts).map((r) => ({ id: txt(r[0]), name: txt(r[1]), balance: numv(r[2]), companyId: txt(r[3]) }))
  const summaryCash = rowsOf(wb, V1.summary).find((r) => txt(r[0]) === 'Mevcut Bakiye')
  const data: Any = {
    companies: rowsOf(wb, V1.companies).map((r) => ({ id: txt(r[0]), name: txt(r[1]) })),
    activeCompanyId: 'all',
    accounts,
    budgets: rowsOf(wb, V1.budgets).map((r) => ({ id: txt(r[0]), category: txt(r[1]), limit: numv(r[2]), companyId: txt(r[3]) })),
    loans: rowsOf(wb, V1.loans).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), bank: txt(r[2]), installmentAmount: numv(r[3]), installmentCount: numv(r[4]), firstDueDate: txt(r[5]),
      paidInstallments: txt(r[6]).split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0), companyId: txt(r[7]),
    })),
    cards: rowsOf(wb, V1.cards).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), bank: txt(r[2]), limit: numv(r[3]), statementDay: numv(r[4]) || 1, dueDay: numv(r[5]) || 1, currentDebt: numv(r[6]),
      paidPeriods: txt(r[7]).split(',').map((s) => s.trim()).filter(Boolean), companyId: txt(r[8]),
    })),
    cardExpenses: rowsOf(wb, V1.expenses).map((r) => ({ id: txt(r[0]), cardId: txt(r[1]), date: txt(r[2]), category: txt(r[3]), title: txt(r[4]), amount: numv(r[5]), addedToDebt: txt(r[6]) === 'Evet' })),
    payments: rowsOf(wb, V1.payments).map((r) => ({
      id: txt(r[0]), type: txt(r[1]) === 'Gelen' ? 'in' : 'out', title: txt(r[2]), category: txt(r[3]), amount: numv(r[4]), date: txt(r[5]),
      recurrence: txt(r[6]).startsWith('Haftalık') ? 'weekly' : txt(r[6]).startsWith('Aylık') ? 'monthly' : 'once', endDate: txt(r[7]) || undefined,
      paidDates: txt(r[8]).split(',').map((s) => s.trim()).filter(Boolean), companyId: txt(r[9]), contactId: txt(r[10]) || undefined,
    })),
    contacts: rowsOf(wb, V1.contacts).map((r) => ({
      id: txt(r[0]), name: txt(r[1]), type: txt(r[2]).startsWith('Tedarikçi') ? 'supplier' : txt(r[2]).startsWith('Her') ? 'both' : 'customer',
      phone: txt(r[3]), email: txt(r[4]), note: txt(r[5]), companyId: txt(r[6]),
    })),
    cheques: rowsOf(wb, V1.cheques).map((r) => ({
      id: txt(r[0]), type: txt(r[1]) === 'Verilen' ? 'issued' : 'received', bank: txt(r[2]), number: txt(r[3]), amount: numv(r[4]), dueDate: txt(r[5]),
      status: txt(r[6]).startsWith('Tamam') ? 'cleared' : txt(r[6]).startsWith('Karşı') ? 'bounced' : 'pending', description: txt(r[7]), contactId: txt(r[8]) || undefined, companyId: txt(r[9]),
    })),
  }
  if (accounts.length === 0 && summaryCash) data.cash = numv(summaryCash[1])
  const badLoan = data.loans.find((l: Any) => !l.name || !l.firstDueDate)
  const badPayment = data.payments.find((p: Any) => !p.title || !p.date)
  if (badLoan || badPayment) throw new Error('Geçersiz yedek: eksik zorunlu alanlar var (ad/başlık veya tarih).')
  return data
}

/** Banka ekstresi gibi rastgele bir Excel/CSV dosyasının ilk sayfasını hücre dizisine çevirir. */
export function readSheetRows(data: ArrayBuffer | Uint8Array): unknown[][] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]!]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true })
}

/** Rapor tablosunu Excel'e aktarır. */
export function exportTable(sheetName: string, rows: Row[]): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = (rows[0] ?? []).map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

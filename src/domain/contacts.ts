import type { Contact, ISODate, Minor, State } from './types'
import { addMonths } from './dates'
import { toTRY } from './money'
import { earliestDate, generateOccurrences } from './occurrences'

export interface LedgerEntry {
  key: string
  date: ISODate
  title: string
  kind: string
  /** + bizim alacağımız (tahsilat), − bizim borcumuz (ödeme); TL karşılığı */
  amount: Minor
  /** Orijinal para biriminde açıklama için */
  original?: string
  status: 'settled' | 'pending' | 'overdue' | 'bounced' | 'endorsed' | 'opening'
}

export interface ContactBalance {
  /** Vadesi geçmiş, tahsil edilmemiş */
  overdueReceivable: Minor
  /** Vadesi gelmemiş (ufuk içinde) */
  upcomingReceivable: Minor
  overduePayable: Minor
  upcomingPayable: Minor
  /** Açılış + bekleyen alacak − bekleyen borç */
  net: Minor
}

/** Cari ekstresi: açılış bakiyesi, gelir/gider (tekrarlayanlar dahil) ve çek/senetler. */
export function contactLedger(
  state: State,
  contact: Contact,
  todayISO: ISODate,
  horizonMonths = 12,
): { entries: LedgerEntry[]; balance: ContactBalance } {
  const rates = state.settings.rates
  const to = addMonths(todayISO, horizonMonths)
  const entries: LedgerEntry[] = []
  const bal: ContactBalance = { overdueReceivable: 0, upcomingReceivable: 0, overduePayable: 0, upcomingPayable: 0, net: 0 }

  if (contact.openingBalance !== 0) {
    entries.push({
      key: `opening:${contact.id}`,
      date: '',
      title: 'Açılış bakiyesi',
      kind: 'Açılış',
      amount: contact.openingBalance,
      status: 'opening',
    })
  }

  const occ = generateOccurrences(state, earliestDate(state), to, { shift: false }).filter(
    (o) => o.contactId === contact.id && o.sourceType === 'payment',
  )
  for (const o of occ) {
    const signed = toTRY(o.amount, o.currency, rates) * (o.direction === 'in' ? 1 : -1)
    const status = o.paid ? 'settled' : o.date < todayISO ? 'overdue' : 'pending'
    entries.push({
      key: o.key,
      date: o.date,
      title: o.title,
      kind: o.direction === 'in' ? 'Tahsilat' : 'Ödeme',
      amount: signed,
      original: o.currency !== 'TRY' ? `${o.amount / 100} ${o.currency}` : undefined,
      status,
    })
    addToBalance(bal, signed, status)
  }

  for (const ch of state.cheques) {
    const label = ch.instrument === 'note' ? 'Senet' : 'Çek'
    const amt = toTRY(ch.amount, ch.currency, rates)
    if (ch.contactId === contact.id) {
      const signed = ch.type === 'received' ? amt : -amt
      const status =
        ch.status === 'cleared'
          ? 'settled'
          : ch.status === 'bounced'
            ? 'bounced'
            : ch.status === 'endorsed'
              ? 'endorsed'
              : ch.dueDate < todayISO
                ? 'overdue'
                : 'pending'
      entries.push({
        key: `cheque:${ch.id}`,
        date: ch.dueDate,
        title: `${label}${ch.number ? ' No ' + ch.number : ''}${ch.description ? ' · ' + ch.description : ''}`,
        kind: ch.type === 'received' ? `Alınan ${label.toLowerCase()}` : `Verilen ${label.toLowerCase()}`,
        amount: signed,
        status,
      })
      // Karşılıksız çek: cari hâlâ borçlu (veya biz hâlâ borçluyuz) → açık kalır
      if (status === 'bounced') addToBalance(bal, signed, ch.dueDate < todayISO ? 'overdue' : 'pending')
      else if (status !== 'endorsed') addToBalance(bal, signed, status)
    }
    if (ch.endorsedToContactId === contact.id && ch.status === 'endorsed') {
      entries.push({
        key: `endorse:${ch.id}`,
        date: ch.history.find((h) => h.status === 'endorsed')?.date ?? ch.dueDate,
        title: `${label} ciro edildi${ch.number ? ' · No ' + ch.number : ''}`,
        kind: 'Ciro (ödeme)',
        amount: -amt,
        status: 'settled',
      })
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  bal.net = contact.openingBalance + bal.overdueReceivable + bal.upcomingReceivable - bal.overduePayable - bal.upcomingPayable
  return { entries, balance: bal }
}

function addToBalance(bal: ContactBalance, signed: Minor, status: string) {
  if (status !== 'overdue' && status !== 'pending') return
  if (signed >= 0) {
    if (status === 'overdue') bal.overdueReceivable += signed
    else bal.upcomingReceivable += signed
  } else {
    if (status === 'overdue') bal.overduePayable += -signed
    else bal.upcomingPayable += -signed
  }
}

export function isValidEmail(s: string): boolean {
  return s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
}

/** Türkiye telefon numarası: 10-11 hane (0 ile veya +90 ile). Boş geçerli. */
export function isValidPhone(s: string): boolean {
  if (s.trim() === '') return true
  const digits = s.replace(/[\s()\-.]/g, '')
  return /^(\+90|0)?\d{10}$/.test(digits) || /^\+\d{8,15}$/.test(digits)
}

/** VKN (10 hane) veya TCKN (11 hane). Boş geçerli. */
export function isValidTaxNo(s: string): boolean {
  return s.trim() === '' || /^\d{10,11}$/.test(s.trim())
}

export const LEDGER_STATUS_LABEL: Record<LedgerEntry['status'], string> = {
  settled: 'Kapandı',
  pending: 'Bekliyor',
  overdue: 'Vadesi geçti',
  bounced: 'Karşılıksız',
  endorsed: 'Ciro edildi',
  opening: '—',
}

// Banka ekstresi (CSV / Excel) içe aktarma: ayrıştırma, sütun tahmini, satır üretimi.

import type { ISODate, Minor, Payment } from './types'
import { isValidISO, toISO } from './dates'
import { parseAmount, toMinor } from './money'
import { normCategory } from './defaults'

export type Cell = string | number | boolean | Date | null | undefined

/** CSV/TSV metnini satırlara ayırır; ayırıcıyı (; , sekme) kendisi bulur. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const sample = clean.split(/\r?\n/).slice(0, 10).join('\n')
  const count = (ch: string) => sample.split(ch).length
  const delim = ['\t', ';', ','].sort((a, b) => count(b) - count(a))[0]!
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function cellText(v: Cell): string {
  if (v == null) return ''
  if (v instanceof Date) return toISO(v)
  return String(v).trim()
}

/** Tarih hücresi: Date, Excel seri numarası, 31.12.2026, 31/12/26, 2026-12-31 (saatli olabilir). */
export function parseDateCell(v: Cell): ISODate | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : toISO(v)
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      // Excel seri tarihi (1900 sistemi)
      const ms = Math.round((v - 25569) * 86400000)
      const d = new Date(ms)
      return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    }
    return null
  }
  const s = String(v).trim().split(/[ T]/)[0]!
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s)
  if (m) {
    const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
    return isValidISO(iso) ? iso : null
  }
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!
    const iso = `${year}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
    return isValidISO(iso) ? iso : null
  }
  return null
}

/** Tutar hücresi: sayı veya "1.250,00", "-1.250,00", "1.250,00-", "(1.250,00)", "1.250,00 B/A". */
export function parseAmountCell(v: Cell): Minor | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? toMinor(v) : null
  let s = String(v).trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/[-−]\s*$/.test(s)) {
    negative = true
    s = s.replace(/[-−]\s*$/, '')
  }
  if (/\bB$/i.test(s)) {
    negative = true // "B" = borç (çıkış)
    s = s.replace(/\s*B$/i, '')
  }
  s = s.replace(/\s*A$/i, '')
  const parsed = parseAmount(s)
  if (parsed === null) return null
  return negative ? -Math.abs(parsed) : parsed
}

export interface ColumnMapping {
  headerRow: number
  date: number
  description: number
  /** Tek tutar sütunu (işaretli) */
  amount: number
  /** Ayrı borç (çıkış) / alacak (giriş) sütunları */
  debit: number
  credit: number
}

const has = (s: string, words: string[]) => words.some((w) => s.includes(w))

/** Başlık satırını ve sütunları tahmin eder (-1 = yok). */
export function guessMapping(rows: Cell[][]): ColumnMapping {
  let headerRow = 0
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const texts = rows[i]!.map((c) => normCategory(cellText(c)))
    const hits = texts.filter((t) => has(t, ['tarih', 'date', 'açıklama', 'aciklama', 'tutar', 'amount', 'borç', 'alacak'])).length
    if (hits >= 2) {
      headerRow = i
      break
    }
  }
  const header = (rows[headerRow] ?? []).map((c) => normCategory(cellText(c)))
  const find = (words: string[], exclude: string[] = []) =>
    header.findIndex((h) => has(h, words) && !has(h, exclude))
  return {
    headerRow,
    date: find(['tarih', 'date'], ['valör', 'valor']),
    description: find(['açıklama', 'aciklama', 'description', 'işlem', 'detay', 'karşı']),
    amount: find(['tutar', 'amount', 'miktar'], ['bakiye']),
    debit: find(['borç', 'borc', 'çıkan', 'cikan', 'debit']),
    credit: find(['alacak', 'giren', 'credit']),
  }
}

export interface ImportRow {
  index: number
  date: ISODate | null
  description: string
  /** + giriş, − çıkış */
  amount: Minor | null
  error?: string
}

export function buildRows(rows: Cell[][], m: ColumnMapping): ImportRow[] {
  const out: ImportRow[] = []
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!
    if (!r.some((c) => cellText(c) !== '')) continue
    const date = m.date >= 0 ? parseDateCell(r[m.date]) : null
    const description = m.description >= 0 ? cellText(r[m.description]) : ''
    let amount: Minor | null = null
    if (m.amount >= 0) amount = parseAmountCell(r[m.amount])
    else {
      const d = m.debit >= 0 ? parseAmountCell(r[m.debit]) : null
      const c = m.credit >= 0 ? parseAmountCell(r[m.credit]) : null
      if (d || c) amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0)
    }
    const error = !date ? 'Tarih okunamadı' : amount === null ? 'Tutar okunamadı' : amount === 0 ? 'Tutar sıfır' : undefined
    out.push({ index: i, date, description, amount, error })
  }
  return out
}

/** Aynı tarih + tutar + açıklamayla zaten kayıtlı mı? */
export function isDuplicate(row: ImportRow, payments: Payment[]): boolean {
  if (!row.date || row.amount === null) return false
  const amount = Math.abs(row.amount)
  const type = row.amount > 0 ? 'in' : 'out'
  const title = normCategory(row.description)
  return payments.some(
    (p) =>
      p.recurrence === 'once' && p.date === row.date && p.amount === amount && p.type === type && normCategory(p.title) === title,
  )
}

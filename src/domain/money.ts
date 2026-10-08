import type { Currency, Minor } from './types'

export const CURRENCY_LABEL: Record<Currency, string> = {
  TRY: 'Türk Lirası (₺)',
  USD: 'ABD Doları ($)',
  EUR: 'Euro (€)',
  GBP: 'İngiliz Sterlini (£)',
  XAU: 'Altın (gram)',
}
export const CURRENCY_SYMBOL: Record<Currency, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
  XAU: 'gr',
}

/**
 * Kullanıcının yazdığı tutarı kuruşa çevirir. Geçersizse null döner.
 *
 * Türkçe yazım önceliklidir:
 *   "8.750" → 8.750,00   "1.250.000" → 1.250.000,00   "1.250,50" → 1.250,50
 *   "12,5"  → 12,50      "12.5"      → 12,50          "8,750.00" → 8.750,00
 * Kural: hem nokta hem virgül varsa SONUNCUSU ondalık ayırıcıdır. Tek ayırıcı
 * türü varsa ve birden çok kez geçiyorsa binlik ayırıcıdır. Tek bir nokta ve
 * ardından tam 3 rakam geliyorsa ("8.750") binlik kabul edilir; tek virgül her
 * zaman ondalıktır.
 */
export function parseAmount(input: string): Minor | null {
  let s = input.trim().replace(/[₺$€£]|TL|TRY|USD|EUR|GBP|gr/gi, '').replace(/[\s ']/g, '')
  if (s === '') return null
  let negative = false
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true
    s = s.slice(1)
  }
  if (!/^[\d.,]+$/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let intPart: string
  let fracPart = ''
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    const i = s.lastIndexOf(dec)
    intPart = s.slice(0, i)
    fracPart = s.slice(i + 1)
    if (intPart.includes(dec) || !validGroups(intPart, thou)) return null
    intPart = intPart.split(thou).join('')
  } else if (lastComma >= 0) {
    const parts = s.split(',')
    if (parts.length === 2) {
      ;[intPart, fracPart] = parts as [string, string]
    } else {
      if (!validGroups(s, ',')) return null
      intPart = parts.join('')
    }
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    if (parts.length === 2 && parts[1]!.length !== 3) {
      ;[intPart, fracPart] = parts as [string, string]
    } else {
      if (!validGroups(s, '.')) return null
      intPart = parts.join('')
    }
  } else {
    intPart = s
  }
  if (intPart === '') intPart = '0'
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) return null
  if (fracPart.length > 2) {
    // 2 haneden fazla ondalık: kuruşa yuvarla
    const extra = Number('0.' + fracPart.slice(2))
    fracPart = fracPart.slice(0, 2)
    let v = Number(intPart) * 100 + Number(fracPart)
    if (extra >= 0.5) v += 1
    return negative ? -v : v
  }
  const v = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(v)) return null
  return negative ? -v : v
}

/** "1.250.000" gibi binlik gruplamanın düzgün olup olmadığı. */
function validGroups(s: string, sep: string): boolean {
  const g = s.split(sep)
  if (g.length === 1) return true
  if (g[0]!.length < 1 || g[0]!.length > 3) return false
  return g.slice(1).every((x) => x.length === 3)
}

/** TL cinsinden sayıyı kuruşa çevirir (veri geçişi ve içe aktarma için). */
export function toMinor(major: number): Minor {
  if (!Number.isFinite(major)) return 0
  return Math.round(major * 100)
}

export function toMajor(minor: Minor): number {
  return minor / 100
}

const formatters = new Map<string, Intl.NumberFormat>()
function nf(currency: Currency, decimals: boolean): Intl.NumberFormat {
  const k = currency + decimals
  let f = formatters.get(k)
  if (!f) {
    f =
      currency === 'XAU'
        ? new Intl.NumberFormat('tr-TR', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 })
        : new Intl.NumberFormat('tr-TR', {
            style: 'currency',
            currency,
            minimumFractionDigits: decimals ? 2 : 0,
            maximumFractionDigits: 2,
          })
    formatters.set(k, f)
  }
  return f
}

/** Kuruş tutarı biçimlendirir: 125000050 → "₺1.250.000,50" */
export function fmt(minor: Minor, currency: Currency = 'TRY'): string {
  const hasFraction = minor % 100 !== 0
  const s = nf(currency, hasFraction).format(minor / 100)
  return currency === 'XAU' ? `${s} gr` : s
}

/** Giriş kutusunda gösterilecek düz biçim: 125000050 → "1.250.000,50" */
export function fmtPlain(minor: Minor): string {
  const neg = minor < 0
  const abs = Math.abs(minor)
  const int = Math.floor(abs / 100)
  const frac = abs % 100
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (neg ? '-' : '') + intStr + (frac ? ',' + String(frac).padStart(2, '0') : '')
}

/** Herhangi bir para birimindeki tutarı TL karşılığına çevirir. */
export function toTRY(minor: Minor, currency: Currency, rates: Record<Currency, number>): Minor {
  if (currency === 'TRY') return minor
  const r = rates[currency]
  if (!r || !Number.isFinite(r)) return 0
  return Math.round(minor * r)
}

/** Bir para biriminden diğerine (TL kurları üzerinden) çevirir. */
export function convert(minor: Minor, from: Currency, to: Currency, rates: Record<Currency, number>): Minor {
  if (from === to) return minor
  const tryValue = toTRY(minor, from, rates)
  if (to === 'TRY') return tryValue
  const r = rates[to]
  if (!r || !Number.isFinite(r)) return 0
  return Math.round(tryValue / r)
}

export function sum(values: Minor[]): Minor {
  let t = 0
  for (const v of values) t += v
  return t
}

/** Tutarı n eşit parçaya böler; artan kuruşlar ilk parçalara dağıtılır. */
export function splitEven(total: Minor, n: number): Minor[] {
  const count = Math.max(1, Math.floor(n))
  const base = Math.trunc(total / count)
  let rest = total - base * count
  const out: Minor[] = []
  for (let i = 0; i < count; i++) {
    const step = rest > 0 ? 1 : rest < 0 ? -1 : 0
    out.push(base + step)
    rest -= step
  }
  return out
}

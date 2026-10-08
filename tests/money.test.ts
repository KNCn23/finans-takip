import { describe, expect, it } from 'vitest'
import { fmt, fmtPlain, parseAmount, splitEven, toTRY } from '../src/domain/money'

describe('parseAmount — Türkçe sayı yazımı', () => {
  it.each([
    ['8750', 875000],
    ['8.750', 875000], // eski sürüm 8,75 ₺ kaydediyordu
    ['1.250.000', 125000000], // eski sürüm geçersiz sayıp 0 kaydediyordu
    ['1.250,50', 125050],
    ['1.250.000,75', 125000075],
    ['12,5', 1250],
    ['12.5', 1250],
    ['0,99', 99],
    ['8,750.00', 875000],
    ['25 000', 2500000],
    ['₺1.500', 150000],
    ['1500 TL', 150000],
    ['-250', -25000],
    ['3,456', 346], // tek virgül her zaman ondalık; 3 hane → kuruşa yuvarlanır
  ])('%s → %i kuruş', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })

  it.each(['', 'abc', '1.2.3', '12,34,5', '1..2', '1.25.000'])('geçersiz: %s', (input) => {
    expect(parseAmount(input)).toBeNull()
  })
})

describe('biçimlendirme', () => {
  it('fmt kuruşu TL olarak gösterir', () => {
    expect(fmt(125000050)).toBe('₺1.250.000,50')
    expect(fmt(125000000)).toBe('₺1.250.000')
  })
  it('fmtPlain giriş kutusu biçimi', () => {
    expect(fmtPlain(125000050)).toBe('1.250.000,50')
    expect(fmtPlain(875000)).toBe('8.750')
    expect(parseAmount(fmtPlain(123456789))).toBe(123456789)
  })
})

describe('kuruş aritmetiği', () => {
  it('splitEven artan kuruşu dağıtır, toplam korunur', () => {
    const parts = splitEven(10000, 3)
    expect(parts).toEqual([3334, 3333, 3333])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000)
  })
  it('0,1 + 0,2 kayan nokta hatası yok', () => {
    expect((parseAmount('0,1') ?? 0) + (parseAmount('0,2') ?? 0)).toBe(30)
  })
  it('döviz TL karşılığı', () => {
    expect(toTRY(10000, 'USD', { TRY: 1, USD: 41.5, EUR: 0, GBP: 0, XAU: 0 })).toBe(415000)
    expect(toTRY(10000, 'EUR', { TRY: 1, USD: 41.5, EUR: 0, GBP: 0, XAU: 0 })).toBe(0)
  })
})

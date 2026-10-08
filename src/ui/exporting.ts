// Yazdırma / PDF ve tablo dışa aktarma yardımcıları.

import { platform } from '../store/platform'

/**
 * Sayfayı veya açık penceredeki içeriği PDF olarak kaydeder.
 * mode = 'modal': yalnızca en üstteki pencere (ör. cari ekstresi) basılır.
 */
export async function saveAsPdf(defaultName: string, mode: 'page' | 'modal' = 'page', landscape = false): Promise<string | null> {
  const cls = mode === 'modal' ? 'print-modal' : 'print-page'
  document.body.classList.add(cls)
  try {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    return await platform.printToPDF({ defaultName, landscape })
  } finally {
    document.body.classList.remove(cls)
  }
}

export function printNow(mode: 'page' | 'modal' = 'page') {
  const cls = mode === 'modal' ? 'print-modal' : 'print-page'
  document.body.classList.add(cls)
  const done = () => {
    document.body.classList.remove(cls)
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

type Row = (string | number | boolean | null)[]

/** Tabloyu Excel dosyası olarak kaydeder (SheetJS ihtiyaç anında yüklenir). */
export async function saveTableAsExcel(defaultName: string, sheet: string, rows: Row[]): Promise<string | null> {
  const { exportTable } = await import('../domain/backup')
  const data = exportTable(sheet, rows)
  return platform.saveFile({ defaultName, data, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
}

export function fileStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)
}

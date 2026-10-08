// Yedekten / dosyadan veri yükleme ortak akışı: önce mevcut verinin
// yedeği alınır, sonra kullanıcıya ne yükleneceği gösterilir.

import type { State } from '../domain/types'
import type { MigrationReport } from '../domain/migrate'
import { platform } from './platform'

export interface LoadedData {
  state: State
  report: MigrationReport
  source: string
}

export async function readDataFile(): Promise<LoadedData | null> {
  const f = await platform.openFile({
    filters: [
      { name: 'Finans Takip yedeği', extensions: ['json', 'xlsx'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
    ],
  })
  if (!f) return null
  const backup = await import('../domain/backup')
  if (/\.json$/i.test(f.name)) {
    const r = backup.fromJsonBackup(new TextDecoder('utf-8').decode(f.data))
    return { ...r, source: f.name }
  }
  const r = backup.importExcel(f.data)
  return { ...r, source: f.name }
}

export async function readBackupByName(name: string): Promise<LoadedData> {
  const text = await platform.readBackup(name)
  const { fromJsonBackup } = await import('../domain/backup')
  return { ...fromJsonBackup(text), source: name }
}

/** Değiştirmeden önce mevcut verinin etiketli yedeğini alır. */
export async function backupBeforeReplace(current: State, label: string): Promise<string | null> {
  try {
    return await platform.createBackup(label, JSON.stringify(current))
  } catch {
    return null
  }
}

export function summarize(r: MigrationReport): string {
  return Object.entries(r.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
}

export async function exportJson(state: State): Promise<string | null> {
  const { toJsonBackup } = await import('../domain/backup')
  return platform.saveFile({
    defaultName: `finans-takip-yedek-${new Date().toISOString().slice(0, 10)}.json`,
    data: toJsonBackup(state),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
}

export async function exportExcelBackup(state: State): Promise<string | null> {
  const { exportExcel } = await import('../domain/backup')
  return platform.saveFile({
    defaultName: `finans-takip-yedek-${new Date().toISOString().slice(0, 10)}.xlsx`,
    data: exportExcel(state),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
}

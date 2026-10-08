// Electron (preload API) ile tarayıcı (geliştirme / önizleme) arasındaki fark
// bu dosyada toplanır. Arayüzün geri kalanı yalnızca `platform` nesnesini kullanır.

export interface BackupInfo {
  name: string
  size: number
  mtime: string
}

export type LoadResult =
  | { status: 'ok'; text: string; encrypted?: boolean }
  | { status: 'empty'; backups: BackupInfo[] }
  | { status: 'corrupt'; reason: string; movedTo: string; backups: BackupInfo[] }

export interface MachineConfig {
  closeToTray: boolean
  startAtLogin: boolean
  encrypt: boolean
  backupMirrorDir: string
  lastPage: string
  encryptionAvailable?: boolean
  paths?: { dataFile: string; backupDir: string }
}

export interface FileFilter {
  name: string
  extensions: string[]
}

interface FinansAPI {
  isElectron: true
  load(): Promise<LoadResult>
  save(text: string): Promise<boolean>
  saveSync(text: string): boolean
  listBackups(): Promise<BackupInfo[]>
  readBackup(name: string): Promise<string>
  createBackup(label: string, text?: string): Promise<string | null>
  openBackupFolder(): Promise<void>
  getConfig(): Promise<MachineConfig>
  setConfig(patch: Partial<MachineConfig>): Promise<MachineConfig>
  chooseMirrorDir(): Promise<string | null>
  saveFile(opts: { defaultName: string; data: Uint8Array | string; filters: FileFilter[] }): Promise<string | null>
  openFile(opts: { filters: FileFilter[] }): Promise<{ name: string; data: Uint8Array } | null>
  showInFolder(file: string): Promise<void>
  printToPDF(opts: { defaultName: string; landscape?: boolean }): Promise<string | null>
  notify(title: string, body: string): Promise<boolean>
  fetchRates(): Promise<{ USD: number; EUR: number; GBP: number; date: string }>
  appInfo(): Promise<{ version: string; isPackaged: boolean; platform: string; userData: string; updaterConfigured: boolean }>
  checkUpdates(): Promise<{ status: string; version?: string; reason?: string }>
  onMenu(cb: (action: string) => void): () => void
}

declare global {
  interface Window {
    finans?: FinansAPI
  }
}

/** İlk sürümün localStorage anahtarı — geçiş için okunur, silinmez. */
export const LEGACY_KEY = 'finans-takip-v1'
const BROWSER_KEY = 'finans-takip-v2'
const BROWSER_BACKUPS = 'finans-takip-v2-backups'
const BROWSER_CONFIG = 'finans-takip-config'

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function browserBackups(): Record<string, { text: string; mtime: string }> {
  try {
    return JSON.parse(safeGet(BROWSER_BACKUPS) ?? '{}')
  } catch {
    return {}
  }
}

function download(name: string, data: Uint8Array | string, mime: string) {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const browser: FinansAPI = {
  isElectron: true as const,
  async load() {
    const text = safeGet(BROWSER_KEY)
    if (text === null) return { status: 'empty', backups: [] }
    try {
      JSON.parse(text)
      return { status: 'ok', text }
    } catch (err) {
      const movedTo = `bozuk-${Date.now()}`
      const all = browserBackups()
      all[movedTo] = { text, mtime: new Date().toISOString() }
      safeSet(BROWSER_BACKUPS, JSON.stringify(all))
      localStorage.removeItem(BROWSER_KEY)
      return { status: 'corrupt', reason: String(err), movedTo, backups: await browser.listBackups() }
    }
  },
  async save(text) {
    JSON.parse(text)
    const day = `gunluk-${new Date().toISOString().slice(0, 10)}`
    const all = browserBackups()
    const prev = safeGet(BROWSER_KEY)
    if (prev && !all[day]) {
      all[day] = { text: prev, mtime: new Date().toISOString() }
      const names = Object.keys(all).sort().reverse()
      for (const n of names.slice(10)) delete all[n]
      safeSet(BROWSER_BACKUPS, JSON.stringify(all))
    }
    if (!safeSet(BROWSER_KEY, text)) throw new Error('Tarayıcı deposu dolu.')
    return true
  },
  saveSync(text) {
    return safeSet(BROWSER_KEY, text)
  },
  async listBackups() {
    return Object.entries(browserBackups())
      .map(([name, b]) => ({ name, size: b.text.length, mtime: b.mtime }))
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  },
  async readBackup(name) {
    const b = browserBackups()[name]
    if (!b) throw new Error('Yedek bulunamadı.')
    return b.text
  },
  async createBackup(label, text) {
    const content = text ?? safeGet(BROWSER_KEY)
    if (!content) return null
    const name = `${label}-${Date.now()}`
    const all = browserBackups()
    all[name] = { text: content, mtime: new Date().toISOString() }
    safeSet(BROWSER_BACKUPS, JSON.stringify(all))
    return name
  },
  async openBackupFolder() {
    /* tarayıcıda yok */
  },
  async getConfig() {
    try {
      return { closeToTray: false, startAtLogin: false, encrypt: false, backupMirrorDir: '', lastPage: 'dashboard', ...JSON.parse(safeGet(BROWSER_CONFIG) ?? '{}') }
    } catch {
      return { closeToTray: false, startAtLogin: false, encrypt: false, backupMirrorDir: '', lastPage: 'dashboard' }
    }
  },
  async setConfig(patch) {
    const next = { ...(await browser.getConfig()), ...patch }
    safeSet(BROWSER_CONFIG, JSON.stringify(next))
    return next
  },
  async chooseMirrorDir() {
    return null
  },
  async saveFile({ defaultName, data }) {
    download(defaultName, data, defaultName.endsWith('.json') ? 'application/json' : 'application/octet-stream')
    return defaultName
  },
  openFile({ filters }) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(',')
      input.onchange = async () => {
        const f = input.files?.[0]
        if (!f) return resolve(null)
        resolve({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
      }
      input.click()
    })
  },
  async showInFolder() {
    /* tarayıcıda yok */
  },
  async printToPDF() {
    window.print()
    return null
  },
  async notify(title, body) {
    if (!('Notification' in window)) return false
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission !== 'granted') return false
    new Notification(title, { body })
    return true
  },
  async fetchRates() {
    throw new Error('Kur güncelleme yalnızca masaüstü uygulamasında çalışır.')
  },
  async appInfo() {
    return { version: __APP_VERSION__, isPackaged: false, platform: 'web', userData: '(tarayıcı deposu)', updaterConfigured: false }
  },
  async checkUpdates() {
    return { status: 'disabled', reason: 'Tarayıcı önizlemesinde güncelleme yoktur.' }
  },
  onMenu() {
    return () => {}
  },
}

export const platform: FinansAPI & { desktop: boolean } = { ...(window.finans ?? browser), desktop: !!window.finans }

export function readLegacy(): string | null {
  return safeGet(LEGACY_KEY)
}

declare global {
  const __APP_VERSION__: string
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account, State } from './domain/types'
import { migrate, type MigrationReport } from './domain/migrate'
import { emptyState } from './domain/defaults'
import { demoState } from './domain/demo'
import { overdueOccurrences } from './domain/occurrences'
import { upcomingDue } from './domain/analytics'
import { fmt, toTRY } from './domain/money'
import { platform, readLegacy, type BackupInfo } from './store/platform'
import { StoreProvider, useStore } from './store/StoreProvider'
import { exportExcelBackup, exportJson } from './store/dataOps'
import { useDialogs } from './ui/Dialogs'
import { ErrorBoundary } from './ui/Common'
import { SettleProvider } from './ui/Occurrences'
import {
  BankIcon,
  BuildingIcon,
  CalendarIcon,
  CardIcon,
  ChartIcon,
  ChequeIcon,
  EditIcon,
  FlowIcon,
  HelpIcon,
  HomeIcon,
  PieIcon,
  PlusIcon,
  SettingsIcon,
  UndoIcon,
  UsersIcon,
  WalletIcon,
} from './ui/Icons'
import { Dashboard } from './pages/Dashboard'
import { Weekly } from './pages/Weekly'
import { Payments } from './pages/Payments'
import { Contacts } from './pages/Contacts'
import { Cheques } from './pages/Cheques'
import { Loans } from './pages/Loans'
import { Cards } from './pages/Cards'
import { Accounts, AccountForm } from './pages/Accounts'
import { Budgets } from './pages/Budgets'
import { Reports } from './pages/Reports'
import { Settings } from './pages/Settings'
import { Companies, Help, LockScreen, QuickAdd, RecoveryScreen } from './pages/Modals'

export type Page = 'dashboard' | 'weekly' | 'payments' | 'accounts' | 'contacts' | 'cheques' | 'loans' | 'cards' | 'budgets' | 'reports' | 'settings'

const NAV: { id: Page; label: string; icon: JSX.Element }[] = [
  { id: 'dashboard', label: 'Özet', icon: <HomeIcon /> },
  { id: 'weekly', label: 'Haftalık Takvim', icon: <CalendarIcon /> },
  { id: 'payments', label: 'Gelir / Gider', icon: <FlowIcon /> },
  { id: 'accounts', label: 'Hesaplar', icon: <WalletIcon /> },
  { id: 'contacts', label: 'Cari Hesaplar', icon: <UsersIcon /> },
  { id: 'cheques', label: 'Çek / Senet', icon: <ChequeIcon /> },
  { id: 'loans', label: 'Krediler', icon: <BankIcon /> },
  { id: 'cards', label: 'Kredi Kartları', icon: <CardIcon /> },
  { id: 'budgets', label: 'Bütçe', icon: <PieIcon /> },
  { id: 'reports', label: 'Raporlar', icon: <ChartIcon /> },
]

const PAGE_KEY = 'finans-last-page'

function applyTheme(theme: State['settings']['theme']) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

// ---------------------------------------------------------------- Açılış

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; state: State; notes: string[] }
  | { kind: 'recovery'; reason: string; movedTo: string; backups: BackupInfo[] }
  | { kind: 'fatal'; message: string }

/** Açılış yalnızca bir kez çalışır (StrictMode efektleri iki kez çağırsa da). */
let bootOnce: Promise<Phase> | null = null

async function boot(): Promise<Phase> {
  try {
    const res = await platform.load()
    if (res.status === 'corrupt') return { kind: 'recovery', reason: res.reason, movedTo: res.movedTo, backups: res.backups }
    let state: State
    let report: MigrationReport | null = null
    let notes: string[] = []
    if (res.status === 'ok') {
      const r = migrate(JSON.parse(res.text))
      state = r.state
      if (r.report.from !== 2) {
        report = r.report
        await platform.createBackup('surum-gecisi-oncesi', res.text)
        await platform.save(JSON.stringify(state))
      }
    } else {
      const legacy = readLegacy()
      if (legacy) {
        try {
          const r = migrate(JSON.parse(legacy))
          state = r.state
          report = r.report
          await platform.createBackup('ilk-surum-verisi', legacy)
        } catch {
          await platform.createBackup('ilk-surum-okunamayan', legacy)
          state = emptyState()
          notes = ['Önceki sürümün verisi okunamadı; ham hali yedek klasörüne "ilk-surum-okunamayan" adıyla kaydedildi.']
        }
      } else state = emptyState()
      await platform.save(JSON.stringify(state))
    }
    if (report) {
      const counts = Object.entries(report.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')
      notes = [`Verileriniz yeni sürüme taşındı (${counts || 'boş'}). Geçiş öncesi hali yedeklendi.`, ...report.notes]
    }
    applyTheme(state.settings.theme)
    return { kind: 'ready', state, notes }
  } catch (err) {
    return { kind: 'fatal', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Veriyi yükler. İlk sürümün localStorage verisi varsa bir kez dosyaya taşır
 * (localStorage'daki kopya silinmez). Hiçbir durumda okunamayan verinin
 * üzerine yazılmaz.
 */
export function Root() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (bootOnce ??= boot()).then((p) => {
      if (!cancelled) setPhase(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (phase.kind === 'loading') return <div className="boot">Yükleniyor…</div>
  if (phase.kind === 'fatal')
    return (
      <div className="recovery">
        <div className="card recovery-card" role="alert">
          <h2>Veriler açılamadı</h2>
          <p>{phase.message}</p>
          <p className="muted">Veri dosyanıza dokunulmadı. Uygulamayı güncelleyip tekrar deneyin.</p>
        </div>
      </div>
    )
  if (phase.kind === 'recovery')
    return (
      <RecoveryScreen
        reason={phase.reason}
        movedTo={phase.movedTo}
        backups={phase.backups}
        onRecovered={async (s, note) => {
          const state = s ?? emptyState()
          await platform.save(JSON.stringify(state))
          applyTheme(state.settings.theme)
          setPhase({ kind: 'ready', state, notes: note === 'empty' ? [] : [note] })
        }}
      />
    )
  return (
    <StoreProvider initial={phase.state}>
      <SettleProvider>
        <Shell initialNotes={phase.notes} />
      </SettleProvider>
    </StoreProvider>
  )
}

// ---------------------------------------------------------------- Uygulama kabuğu

function readPage(): Page {
  try {
    const p = localStorage.getItem(PAGE_KEY) as Page | null
    if (p && (NAV.some((n) => n.id === p) || p === 'settings')) return p
  } catch {
    /* yok */
  }
  return 'dashboard'
}

function Shell({ initialNotes }: { initialNotes: string[] }) {
  const store = useStore()
  const { state, apply, undo, canUndo, notice, saveError, flush, today } = store
  const { toast } = useDialogs()
  const [page, setPageState] = useState<Page>(readPage)
  const [quickAdd, setQuickAdd] = useState(false)
  const [help, setHelp] = useState(false)
  const [companies, setCompanies] = useState(false)
  const [accountForm, setAccountForm] = useState<Account | 'new' | null>(null)
  const [notes, setNotes] = useState(initialNotes)
  const [locked, setLocked] = useState(!!state.settings.pinHash)
  const lastActivity = useRef(Date.now())
  const mainRef = useRef<HTMLElement>(null)

  const setPage = useCallback((p: Page) => {
    setPageState(p)
    try {
      localStorage.setItem(PAGE_KEY, p)
    } catch {
      /* önemsiz */
    }
    mainRef.current?.focus()
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => applyTheme(state.settings.theme), [state.settings.theme])

  // Geri alınabilir işlemlerden sonra "Geri al" bildirimi
  useEffect(() => {
    if (notice) toast(notice.label, { action: { label: 'Geri al', onClick: undo } })
  }, [notice, toast, undo])

  // Klavye kısayolları
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked) return
      const inField = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')
      const modalOpen = !!document.querySelector('.modal')
      if (e.key === 'F1') {
        e.preventDefault()
        setHelp(true)
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' && !e.shiftKey && !inField && !modalOpen) {
        e.preventDefault()
        if (canUndo) undo()
      } else if (e.key.toLowerCase() === 'n' && !modalOpen) {
        e.preventDefault()
        setQuickAdd(true)
      } else if (e.key === ',' && !modalOpen) {
        e.preventDefault()
        setPage('settings')
      } else if (/^[1-9]$/.test(e.key) && !modalOpen) {
        const target = NAV[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          setPage(target.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, canUndo, undo, setPage])

  // Electron menüsünden gelen komutlar
  useEffect(
    () =>
      platform.onMenu(async (action) => {
        if (action === 'new-expense') setQuickAdd(true)
        else if (action === 'help') setHelp(true)
        else if (action === 'settings') setPage('settings')
        else if (action === 'weekly') setPage('weekly')
        else if (action === 'backup-json' || action === 'backup-excel') {
          const file = action === 'backup-json' ? await exportJson(state) : await exportExcelBackup(state)
          if (file) toast('Yedek kaydedildi.', { kind: 'success' })
        }
      }),
    [state, setPage, toast],
  )

  // Vade hatırlatmaları: günde bir kez
  useEffect(() => {
    if (!state.settings.notifications) return
    const check = () => {
      const key = `finans-notified-${today}`
      try {
        if (localStorage.getItem(key)) return
      } catch {
        return
      }
      const overdue = overdueOccurrences(state, today)
      const upcoming = upcomingDue(state, today, state.settings.notifyDaysBefore)
      try {
        localStorage.setItem(key, '1')
      } catch {
        /* önemsiz */
      }
      if (!overdue.length && !upcoming.length) return
      const total = (list: typeof overdue) => list.reduce((t, o) => t + toTRY(o.amount, o.currency, state.settings.rates), 0)
      const parts = []
      if (overdue.length) parts.push(`${overdue.length} gecikmiş vade (${fmt(total(overdue))})`)
      if (upcoming.length) {
        const first = upcoming[0]!
        parts.push(upcoming.length === 1 ? `Yaklaşan: ${first.title} ${fmt(first.amount, first.currency)}` : `${upcoming.length} yaklaşan vade (${fmt(total(upcoming))})`)
      }
      void platform.notify('Finans Takip — ödeme hatırlatması', parts.join(' · '))
    }
    const t = setTimeout(check, 5000)
    const i = setInterval(check, 60 * 60 * 1000)
    return () => {
      clearTimeout(t)
      clearInterval(i)
    }
  }, [state, today])

  // Hareketsizlikte kilitle
  useEffect(() => {
    if (!state.settings.pinHash || !state.settings.lockAfterMinutes) return
    const mark = () => {
      lastActivity.current = Date.now()
    }
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart']
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }))
    const i = setInterval(() => {
      if (Date.now() - lastActivity.current > state.settings.lockAfterMinutes * 60_000) setLocked(true)
    }, 15_000)
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark))
      clearInterval(i)
    }
  }, [state.settings.pinHash, state.settings.lockAfterMinutes])

  const rates = state.settings.rates
  const missing = state.accounts.some((a) => a.currency !== 'TRY' && !rates[a.currency])

  return (
    <>
      <a className="skip-link" href="#main">
        İçeriğe geç
      </a>
      <div className="layout" aria-hidden={locked}>
        <aside className="sidebar">
          <div className="logo">
            <span className="logo-mark" aria-hidden="true">
              ₺
            </span>
            <div>
              <strong>Finans Takip</strong>
              <span>Şirket ve kişisel finans</span>
            </div>
          </div>
          <div className="company-picker">
            <BuildingIcon size={16} />
            <select
              value={state.companies.length > 1 ? state.activeCompanyId : state.companies[0]!.id}
              onChange={(e) => apply((s) => ({ ...s, activeCompanyId: e.target.value }))}
              aria-label="Aktif şirket"
              title="Aktif şirket — görüntülenen veriler"
            >
              {state.companies.length > 1 && <option value="all">Holding Geneli (Konsolide)</option>}
              {state.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn light" title="Şirketleri yönet" aria-label="Şirketleri yönet" onClick={() => setCompanies(true)}>
              <EditIcon size={14} />
            </button>
          </div>
          <button type="button" className="quick-btn" onClick={() => setQuickAdd(true)} title="Harcama ekle (Ctrl+N)">
            <PlusIcon size={18} /> Harcama Ekle
          </button>
          <nav aria-label="Sayfalar">
            {NAV.map((n, i) => (
              <button
                key={n.id}
                type="button"
                className={page === n.id ? 'active' : ''}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
                title={i < 9 ? `Ctrl+${i + 1}` : undefined}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button type="button" onClick={() => undo()} disabled={!canUndo} title="Son değişikliği geri al (Ctrl+Z)">
              <UndoIcon size={16} /> Geri Al
            </button>
            <button type="button" className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')} title="Ayarlar (Ctrl+,)">
              <SettingsIcon size={16} /> Ayarlar
            </button>
            <button type="button" onClick={() => setHelp(true)} title="Kısa kullanım rehberi (F1)">
              <HelpIcon size={16} /> Nasıl Kullanılır?
            </button>
            <span className={`save-status${saveError ? ' error' : ''}`} role="status">
              {saveError ? 'Kaydedilemedi!' : store.lastSavedAt ? `Kaydedildi ${store.lastSavedAt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : 'Verileriniz bu bilgisayarda'}
            </span>
          </div>
        </aside>
        <main className="main" id="main" ref={mainRef} tabIndex={-1}>
          {saveError && (
            <div className="banner error" role="alert">
              <span>Değişiklikler diske kaydedilemedi: {saveError}</span>
              <button type="button" className="btn small" onClick={() => void flush()}>
                Tekrar dene
              </button>
            </div>
          )}
          {notes.length > 0 && (
            <div className="banner info" role="status">
              <ul>
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <button type="button" className="btn small" onClick={() => setNotes([])}>
                Tamam
              </button>
            </div>
          )}
          {missing && page !== 'settings' && (
            <div className="banner warn" role="status">
              <span>Bazı dövizli hesaplar için kur girilmemiş; toplamlarda 0 TL sayılıyor.</span>
              <button type="button" className="btn small" onClick={() => setPage('settings')}>
                Kurları gir
              </button>
            </div>
          )}
          <ErrorBoundary resetKey={page}>
            {page === 'dashboard' && (
              <Dashboard
                onNavigate={setPage}
                onAddAccount={() => setAccountForm('new')}
                onLoadDemo={() => apply(() => demoState(), 'Örnek veriler yüklendi')}
              />
            )}
            {page === 'weekly' && <Weekly />}
            {page === 'payments' && <Payments />}
            {page === 'accounts' && <Accounts onEditAccount={setAccountForm} />}
            {page === 'contacts' && <Contacts />}
            {page === 'cheques' && <Cheques />}
            {page === 'loans' && <Loans />}
            {page === 'cards' && <Cards />}
            {page === 'budgets' && <Budgets />}
            {page === 'reports' && <Reports />}
            {page === 'settings' && <Settings onCompanies={() => setCompanies(true)} />}
          </ErrorBoundary>
        </main>
      </div>
      {quickAdd && <QuickAdd onClose={() => setQuickAdd(false)} />}
      {help && <Help onClose={() => setHelp(false)} />}
      {companies && <Companies onClose={() => setCompanies(false)} />}
      {accountForm && <AccountForm account={accountForm === 'new' ? null : accountForm} onClose={() => setAccountForm(null)} />}
      {locked && state.settings.pinHash && state.settings.pinSalt && (
        <LockScreen
          salt={state.settings.pinSalt}
          hash={state.settings.pinHash}
          onUnlock={() => {
            lastActivity.current = Date.now()
            setLocked(false)
          }}
        />
      )}
    </>
  )
}

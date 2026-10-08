import { useEffect, useState } from 'react'
import type { CategoryKind, Currency, Theme } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { addCategory, categoryUsage, deleteCategory, renameCategory, updateSettings } from '../store/actions'
import { platform, type BackupInfo, type MachineConfig } from '../store/platform'
import { hashPin, isValidPin, randomSalt, verifyPin } from '../store/security'
import { backupBeforeReplace, exportExcelBackup, exportJson, readBackupByName, readDataFile, summarize, type LoadedData } from '../store/dataOps'
import { CURRENCY_LABEL } from '../domain/money'
import { HOLIDAY_DATA_YEARS } from '../domain/holidays'
import { isSystemCategory } from '../domain/analytics'
import { PageHead, Segmented } from '../ui/Common'
import { Field } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { DownloadIcon, EditIcon, TrashIcon, UploadIcon } from '../ui/Icons'

export function Settings({ onCompanies }: { onCompanies: () => void }) {
  return (
    <div className="page">
      <PageHead title="Ayarlar" />
      <div className="settings-grid">
        <GeneralSection onCompanies={onCompanies} />
        <RatesSection />
        <CategoriesSection />
        <NotificationsSection />
        <SecuritySection />
        <BackupSection />
        <AboutSection />
      </div>
    </div>
  )
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="card settings-card" id={id} aria-labelledby={`${id ?? title}-h`}>
      <div className="card-head">
        <h3 id={`${id ?? title}-h`}>{title}</h3>
      </div>
      <div className="form">{children}</div>
    </section>
  )
}

function Toggle({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint && <span className="muted small-note">{hint}</span>}
      </span>
    </label>
  )
}

function useMachineConfig(): [MachineConfig | null, (p: Partial<MachineConfig>) => Promise<void>] {
  const [cfg, setCfg] = useState<MachineConfig | null>(null)
  useEffect(() => {
    void platform.getConfig().then(setCfg)
  }, [])
  const set = async (p: Partial<MachineConfig>) => {
    const next = await platform.setConfig(p)
    setCfg((c) => ({ ...(c ?? next), ...next }))
  }
  return [cfg, set]
}

function GeneralSection({ onCompanies }: { onCompanies: () => void }) {
  const { state, apply } = useStore()
  const s = state.settings
  return (
    <Section title="Genel" id="genel">
      <Field label="Tema">
        <Segmented<Theme>
          label="Tema"
          value={s.theme}
          onChange={(theme) => apply((st) => updateSettings(st, { theme }))}
          options={[
            { value: 'system', label: 'Sistem' },
            { value: 'light', label: 'Açık' },
            { value: 'dark', label: 'Koyu' },
          ]}
        />
      </Field>
      <Toggle
        label="Vadeleri iş gününe kaydır"
        checked={s.shiftToBusinessDay}
        onChange={(v) => apply((st) => updateSettings(st, { shiftToBusinessDay: v }))}
        hint={`Kredi, kart ve çek vadesi hafta sonu veya resmi tatile denk gelirse sonraki iş günü gösterilir (bayram tarihleri ${HOLIDAY_DATA_YEARS[0]}–${HOLIDAY_DATA_YEARS.at(-1)}).`}
      />
      <div>
        <button type="button" className="btn" onClick={onCompanies}>
          Şirketleri yönet ({state.companies.length})
        </button>
      </div>
    </Section>
  )
}

function RatesSection() {
  const { state, apply } = useStore()
  const { toast } = useDialogs()
  const rates = state.settings.rates
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries((['USD', 'EUR', 'GBP', 'XAU'] as Currency[]).map((c) => [c, rates[c] ? String(rates[c]).replace('.', ',') : ''])),
  )
  const [loading, setLoading] = useState(false)
  const save = (c: Currency, v: string) => {
    const n = Number(v.replace(/\./g, '').replace(',', '.'))
    if (v.trim() === '' || (Number.isFinite(n) && n >= 0)) {
      apply((s) => updateSettings(s, { rates: { ...s.settings.rates, [c]: v.trim() === '' ? 0 : n }, ratesUpdatedAt: new Date().toISOString() }))
    }
  }
  const fetchTcmb = async () => {
    setLoading(true)
    try {
      const r = await platform.fetchRates()
      apply((s) => updateSettings(s, { rates: { ...s.settings.rates, USD: r.USD || s.settings.rates.USD, EUR: r.EUR || s.settings.rates.EUR, GBP: r.GBP || s.settings.rates.GBP }, ratesUpdatedAt: new Date().toISOString() }))
      setDraft((d) => ({ ...d, USD: String(r.USD).replace('.', ','), EUR: String(r.EUR).replace('.', ','), GBP: String(r.GBP).replace('.', ',') }))
      toast(`TCMB ${r.date} kurları alındı.`, { kind: 'success' })
    } catch (err) {
      toast(`Kurlar alınamadı: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' })
    } finally {
      setLoading(false)
    }
  }
  return (
    <Section title="Döviz Kurları" id="kurlar">
      <p className="muted form-note">Dövizli hesap, kredi ve kayıtlar toplamlarda bu kurlarla TL'ye çevrilir (1 birim = ? TL).</p>
      <div className="form-row wrap">
        {(['USD', 'EUR', 'GBP', 'XAU'] as Currency[]).map((c) => (
          <Field key={c} label={CURRENCY_LABEL[c]}>
            <input
              inputMode="decimal"
              value={draft[c] ?? ''}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, [c]: e.target.value })}
              onBlur={(e) => save(c, e.target.value)}
            />
          </Field>
        ))}
      </div>
      <div className="row-actions wrap">
        {platform.desktop && (
          <button type="button" className="btn" disabled={loading} onClick={() => void fetchTcmb()}>
            {loading ? 'Alınıyor…' : "TCMB'den güncelle (USD, EUR, GBP)"}
          </button>
        )}
        {state.settings.ratesUpdatedAt && <span className="muted">Son güncelleme: {new Date(state.settings.ratesUpdatedAt).toLocaleString('tr-TR')}</span>}
      </div>
      {platform.desktop && <p className="muted small-note">TCMB'ye yalnızca siz düğmeye bastığınızda bağlanılır; hiçbir veriniz gönderilmez. Altın kurunu elle girin.</p>}
    </Section>
  )
}

function CategoriesSection() {
  const { state, apply } = useStore()
  const { confirm } = useDialogs()
  const [kind, setKind] = useState<CategoryKind>('out')
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = state.categories.filter((c) => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  return (
    <Section title="Kategoriler" id="kategoriler">
      <Segmented
        label="Kategori türü"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'out', label: 'Gider' },
          { value: 'in', label: 'Gelir' },
        ]}
      />
      <ul className="category-list">
        {list.map((c) => (
          <li key={c.id}>
            {renaming?.id === c.id ? (
              <form
                className="inline-add"
                onSubmit={(e) => {
                  e.preventDefault()
                  try {
                    apply((s) => renameCategory(s, c.id, renaming.name), 'Kategori yeniden adlandırıldı')
                    setRenaming(null)
                    setError(null)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  }
                }}
              >
                <input value={renaming.name} autoFocus onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label="Yeni ad" />
                <button type="submit" className="btn small primary">
                  Kaydet
                </button>
                <button type="button" className="btn small" onClick={() => setRenaming(null)}>
                  Vazgeç
                </button>
              </form>
            ) : (
              <>
                <span>{c.name}</span>
                <span className="muted small-note">{categoryUsage(state, c.name)} kayıt</span>
                <button type="button" className="icon-btn" aria-label={`${c.name} adını değiştir`} title="Adını değiştir (bütün kayıtlara yansır)" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                  <EditIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`${c.name} kategorisini sil`}
                  title="Listeden kaldır"
                  onClick={async () => {
                    const n = categoryUsage(state, c.name)
                    if (await confirm({ title: 'Kategori listeden kaldırılsın mı?', message: n ? `${n} kayıt bu kategoriyi kullanıyor; kayıtlar değişmez, yalnızca seçim listesinden kalkar.` : 'Kullanılmayan kategori silinecek.', confirmLabel: 'Kaldır', danger: true }))
                      apply((s) => deleteCategory(s, c.id), `"${c.name}" kaldırıldı`)
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="field-error">{error}</p>}
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          if (isSystemCategory(draft)) return setError('Bu ad sistem tarafından kullanılıyor (kredi/kart/çek).')
          apply((s) => addCategory(s, draft, kind).state)
          setDraft('')
          setError(null)
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Yeni ${kind === 'out' ? 'gider' : 'gelir'} kategorisi`} aria-label="Yeni kategori" />
        <button type="submit" className="btn small">
          Ekle
        </button>
      </form>
    </Section>
  )
}

function NotificationsSection() {
  const { state, apply } = useStore()
  const { toast } = useDialogs()
  const [cfg, setCfg] = useMachineConfig()
  const s = state.settings
  return (
    <Section title="Bildirimler ve Başlangıç" id="bildirimler">
      <Toggle label="Vade hatırlatmaları" checked={s.notifications} onChange={(v) => apply((st) => updateSettings(st, { notifications: v }))} hint="Gecikmiş ve yaklaşan ödemeler için günde bir kez masaüstü bildirimi" />
      <Field label="Kaç gün önceden hatırlatılsın?">
        <select value={s.notifyDaysBefore} onChange={(e) => apply((st) => updateSettings(st, { notifyDaysBefore: Number(e.target.value) }))} disabled={!s.notifications}>
          {[0, 1, 2, 3, 5, 7].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Yalnızca vade günü' : `${n} gün önce`}
            </option>
          ))}
        </select>
      </Field>
      {platform.desktop && cfg && (
        <>
          <Toggle label="Kapatınca sistem tepsisine küçült" checked={cfg.closeToTray} onChange={(v) => void setCfg({ closeToTray: v })} hint="Uygulama arka planda çalışmaya devam eder, hatırlatmalar gelir" />
          <Toggle label="Windows açılışında başlat" checked={cfg.startAtLogin} onChange={(v) => void setCfg({ startAtLogin: v })} hint="Tepsiye küçült açıksa gizli başlar" />
        </>
      )}
      <div>
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            const ok = await platform.notify('Finans Takip', 'Bildirimler çalışıyor ✓')
            if (!ok) toast('Bildirim gösterilemedi. Windows bildirim ayarlarını kontrol edin.', { kind: 'error' })
          }}
        >
          Deneme bildirimi gönder
        </button>
      </div>
    </Section>
  )
}

function SecuritySection() {
  const { state, apply } = useStore()
  const { toast, confirm } = useDialogs()
  const [cfg, setCfg] = useMachineConfig()
  const s = state.settings
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hasPin = !!s.pinHash

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (hasPin && !(await verifyPin(current, s.pinSalt!, s.pinHash!))) return setError('Mevcut PIN yanlış.')
    if (!isValidPin(pin)) return setError('PIN 4–8 rakam olmalı.')
    if (pin !== pin2) return setError('PIN tekrarı eşleşmiyor.')
    const salt = randomSalt()
    const hash = await hashPin(pin, salt)
    apply((st) => updateSettings(st, { pinHash: hash, pinSalt: salt, lockAfterMinutes: st.settings.lockAfterMinutes || 10 }))
    setCurrent('')
    setPin('')
    setPin2('')
    toast('PIN kaydedildi. Uygulama açılışta ve hareketsiz kalınca kilitlenecek.', { kind: 'success' })
  }
  const removePin = async () => {
    if (!(await verifyPin(current, s.pinSalt!, s.pinHash!))) return setError('PIN kaldırmak için mevcut PIN’i girin.')
    apply((st) => updateSettings(st, { pinHash: undefined, pinSalt: undefined }))
    setCurrent('')
    toast('PIN kilidi kaldırıldı.')
  }
  return (
    <Section title="Güvenlik" id="guvenlik">
      <form className="form" onSubmit={(e) => void savePin(e)}>
        <p className="muted form-note">{hasPin ? 'PIN kilidi açık.' : 'Uygulamayı açmak için PIN isteyin (4–8 rakam).'}</p>
        {hasPin && (
          <Field label="Mevcut PIN">
            <input type="password" inputMode="numeric" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
        )}
        <div className="form-row">
          <Field label={hasPin ? 'Yeni PIN' : 'PIN'}>
            <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} />
          </Field>
          <Field label="PIN tekrar">
            <input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value)} />
          </Field>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="row-actions">
          <button type="submit" className="btn small primary">
            {hasPin ? 'PIN’i değiştir' : 'PIN belirle'}
          </button>
          {hasPin && (
            <button type="button" className="btn small" onClick={() => void removePin()}>
              PIN’i kaldır
            </button>
          )}
        </div>
      </form>
      {hasPin && (
        <Field label="Hareketsiz kalınca kilitle">
          <select value={s.lockAfterMinutes} onChange={(e) => apply((st) => updateSettings(st, { lockAfterMinutes: Number(e.target.value) }))}>
            {[0, 1, 5, 10, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Yalnızca açılışta' : `${n} dakika sonra`}
              </option>
            ))}
          </select>
        </Field>
      )}
      {platform.desktop && cfg && (
        <Toggle
          label="Veri dosyasını şifrele"
          checked={cfg.encrypt}
          disabled={!cfg.encryptionAvailable}
          onChange={async (v) => {
            if (
              v &&
              !(await confirm({
                title: 'Veri dosyası şifrelensin mi?',
                message: 'Dosya Windows hesabınıza bağlı anahtarla şifrelenir; başka bir kullanıcı veya bilgisayar okuyamaz. Windows yeniden kurulursa otomatik yedekler de açılamaz — bu yüzden ara sıra "JSON yedeği" alıp güvenli bir yere koyun.',
                confirmLabel: 'Şifrele',
              }))
            )
              return
            await setCfg({ encrypt: v })
            toast(v ? 'Veri dosyası şifrelendi.' : 'Şifreleme kapatıldı.', { kind: 'success' })
          }}
          hint={cfg.encryptionAvailable ? 'Windows Veri Koruma (DPAPI) ile' : 'Bu bilgisayarda kullanılamıyor'}
        />
      )}
    </Section>
  )
}

function BackupSection() {
  const { state, apply } = useStore()
  const { confirm, toast, alert } = useDialogs()
  const [cfg, setCfg] = useMachineConfig()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const refresh = () => void platform.listBackups().then(setBackups)
  useEffect(refresh, [])

  const replaceWith = async (loaded: LoadedData) => {
    const ok = await confirm({
      title: 'Veriler değiştirilsin mi?',
      message: (
        <>
          <p>
            Mevcut verilerin yerine <strong>{loaded.source}</strong> yüklenecek: {summarize(loaded.report) || 'boş veri'}.
          </p>
          <p className="muted">Önce mevcut verinin yedeği otomatik alınır; ayrıca "Geri al" ile dönebilirsiniz.</p>
        </>
      ),
      confirmLabel: 'Yükle',
      danger: true,
    })
    if (!ok) return
    const saved = await backupBeforeReplace(state, 'yukleme-oncesi')
    apply(() => loaded.state, 'Yedek yüklendi')
    refresh()
    if (loaded.report.notes.length) await alert('Yükleme notları', <ul>{loaded.report.notes.map((n) => <li key={n}>{n}</li>)}</ul>)
    toast(`Yüklendi.${saved ? ' Önceki veri yedeklendi.' : ''}`, { kind: 'success' })
  }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { kind: 'error' })
    }
  }

  return (
    <Section title="Yedekler" id="yedekler">
      <p className="muted form-note">
        {platform.desktop
          ? 'Her gün ilk değişiklikten önce verinin otomatik yedeği alınır (son 30 gün), içe aktarma ve geri yükleme öncesinde de ayrıca yedeklenir.'
          : 'Tarayıcı önizlemesinde son 10 günün yedeği tarayıcıda tutulur.'}
      </p>
      <div className="row-actions wrap">
        <button type="button" className="btn small" onClick={() => void run(() => exportJson(state))}>
          <DownloadIcon size={14} /> JSON yedeği al
        </button>
        <button type="button" className="btn small" onClick={() => void run(() => exportExcelBackup(state))}>
          <DownloadIcon size={14} /> Excel yedeği al
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() =>
            void run(async () => {
              const loaded = await readDataFile()
              if (loaded) await replaceWith(loaded)
            })
          }
        >
          <UploadIcon size={14} /> Dosyadan yükle (JSON / Excel)
        </button>
        {platform.desktop && (
          <button type="button" className="btn small" onClick={() => void platform.openBackupFolder()}>
            Yedek klasörünü aç
          </button>
        )}
      </div>
      {platform.desktop && cfg && (
        <Field label="İkinci yedek konumu" hint="Günlük yedekler ayrıca buraya da kopyalanır (ör. OneDrive veya harici disk). Bilgisayar arızalansa da verileriniz kalır.">
          <div className="inline-add">
            <input value={cfg.backupMirrorDir || 'Seçilmedi'} readOnly aria-label="İkinci yedek konumu" />
            <button type="button" className="btn small" onClick={async () => {
                const d = await platform.chooseMirrorDir()
                if (d) await setCfg({ backupMirrorDir: d })
              }}>
              Seç…
            </button>
            {cfg.backupMirrorDir && (
              <button type="button" className="btn small" onClick={() => void setCfg({ backupMirrorDir: '' })}>
                Kaldır
              </button>
            )}
          </div>
        </Field>
      )}
      <div className="backup-list">
        <span className="stat-label">Otomatik yedekler</span>
        {backups.length === 0 ? (
          <div className="empty-line">Henüz yedek yok — ilk değişiklikle birlikte oluşur.</div>
        ) : (
          <ul className="simple-list">
            {backups.slice(0, 15).map((b) => (
              <li key={b.name}>
                <span>
                  {b.name.replace(/\.json$/, '')}
                  <span className="muted small-note">
                    {new Date(b.mtime).toLocaleString('tr-TR')} · {(b.size / 1024).toFixed(1)} KB
                  </span>
                </span>
                <button type="button" className="btn small" onClick={() => void run(async () => replaceWith(await readBackupByName(b.name)))}>
                  Geri yükle
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

function AboutSection() {
  const [info, setInfo] = useState<{ version: string; userData: string; updaterConfigured: boolean; isPackaged: boolean } | null>(null)
  const [cfg] = useMachineConfig()
  const { toast } = useDialogs()
  useEffect(() => {
    void platform.appInfo().then(setInfo)
  }, [])
  return (
    <Section title="Hakkında" id="hakkinda">
      <p>
        <strong>Finans Takip</strong> {info ? `sürüm ${info.version}` : ''}
      </p>
      <p className="muted form-note">Verileriniz yalnızca bu bilgisayarda saklanır; internete veri gönderilmez.</p>
      {cfg?.paths && (
        <p className="muted small-note">
          Veri dosyası: <code>{cfg.paths.dataFile}</code>
        </p>
      )}
      {platform.desktop && (
        <div>
          <button
            type="button"
            className="btn small"
            onClick={async () => {
              const r = await platform.checkUpdates()
              if (r.status === 'disabled' || r.status === 'error') toast(r.reason ?? 'Güncelleme denetlenemedi.')
            }}
          >
            Güncellemeleri denetle
          </button>
        </div>
      )}
    </Section>
  )
}

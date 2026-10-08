import { useEffect, useRef, useState } from 'react'
import type { ID, Minor, State } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { addAccountMovement, deleteCompany, saveCardExpense, saveCompany } from '../store/actions'
import { verifyPin } from '../store/security'
import { platform, type BackupInfo } from '../store/platform'
import { migrate } from '../domain/migrate'
import { fmt } from '../domain/money'
import { Modal } from '../ui/Modal'
import { AccountSelect, AmountInput, CategorySelect, Field, amountOk, useDirty } from '../ui/Form'
import { Segmented } from '../ui/Common'
import { resetTips } from '../ui/Common'
import { useDialogs } from '../ui/Dialogs'
import { LockIcon, TrashIcon } from '../ui/Icons'
import { CardExpenseFields } from './Cards'

// ---------------------------------------------------------------- Hızlı harcama

export function QuickAdd({ onClose }: { onClose: () => void }) {
  const { scoped, state, today, apply } = useStore()
  const { toast } = useDialogs()
  const cards = scoped.cards.length ? scoped.cards : state.cards
  const accounts = scoped.accounts.length ? scoped.accounts : state.accounts
  const [mode, setMode] = useState<'card' | 'account'>(cards.length ? 'card' : 'account')
  const [type, setType] = useState<'out' | 'in'>('out')
  const [cardId, setCardId] = useState<ID>(cards[0]?.id ?? '')
  const [accountId, setAccountId] = useState<ID>(accounts.find((a) => a.kind !== 'deposit')?.id ?? '')
  const [v, setV] = useState({ category: 'Yemek', title: '', amount: null as Minor | null, date: today, installments: 1, countsToStatement: true })
  const dirty = useDirty({ v, type })
  const [error, setError] = useState<string | null>(null)
  const card = state.cards.find((c) => c.id === cardId)
  const account = state.accounts.find((a) => a.id === accountId)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!amountOk(v.amount, { required: true }) || v.amount === null) return
    try {
      if (mode === 'card') {
        if (!card) return
        apply((s) => saveCardExpense(s, { cardId, category: v.category, title: v.title.trim(), amount: v.amount!, date: v.date, installments: v.installments, countsToStatement: v.countsToStatement }))
        toast(`${fmt(v.amount)} ${card.name} kartına eklendi.`, { kind: 'success' })
      } else {
        if (!account) return
        apply((s) => addAccountMovement(s, accountId, { type, title: v.title.trim(), category: v.category, amount: v.amount!, date: v.date }))
        toast(`${fmt(v.amount, account.currency)} ${type === 'out' ? 'harcama' : 'gelir'} kaydedildi; ${account.name} güncellendi.`, { kind: 'success' })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={type === 'out' ? 'Harcama Ekle' : 'Gelir Ekle'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        <Segmented
          full
          label="Nasıl ödediniz?"
          value={mode}
          onChange={(m) => {
            setMode(m)
            if (m === 'card') setType('out')
          }}
          options={[
            { value: 'card', label: 'Kredi Kartı' },
            { value: 'account', label: 'Nakit / Hesap' },
          ]}
        />
        {mode === 'card' ? (
          cards.length === 0 ? (
            <div className="empty-line">Önce "Kredi Kartları" sayfasından kart ekleyin.</div>
          ) : (
            <>
              <Field label="Hangi kart?">
                <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.bank})
                    </option>
                  ))}
                </select>
              </Field>
              <CardExpenseFields card={card} value={v} onChange={(p) => setV((x) => ({ ...x, ...p }))} />
            </>
          )
        ) : accounts.length === 0 ? (
          <div className="empty-line">Önce Hesaplar sayfasından bir hesap ekleyin.</div>
        ) : (
          <>
            <Segmented
              full
              label="Tür"
              value={type}
              onChange={(t) => {
                setType(t)
                setV((x) => ({ ...x, category: t === 'in' ? 'Diğer Gelir' : 'Yemek' }))
              }}
              options={[
                { value: 'out', label: 'Harcama', tone: 'out' },
                { value: 'in', label: 'Gelir', tone: 'in' },
              ]}
            />
            <AccountSelect label={type === 'out' ? 'Hangi hesaptan?' : 'Hangi hesaba?'} value={accountId} onChange={setAccountId} />
            <CategorySelect kind={type} value={v.category} onChange={(category) => setV((x) => ({ ...x, category }))} />
            <div className="form-row">
              <AmountInput label="Tutar" value={v.amount} onChange={(amount) => setV((x) => ({ ...x, amount }))} currency={account?.currency} required autoFocus />
              <Field label="Tarih">
                <input type="date" value={v.date} onChange={(e) => setV((x) => ({ ...x, date: e.target.value }))} required />
              </Field>
            </div>
            <Field label="Açıklama (opsiyonel)">
              <input value={v.title} onChange={(e) => setV((x) => ({ ...x, title: e.target.value }))} placeholder="Öğle yemeği" />
            </Field>
            {account && (
              <p className="muted form-note">
                {account.name} bakiyesi {type === 'out' ? 'azalacak' : 'artacak'} ve kayıt raporlara işlenecek.
              </p>
            )}
          </>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn primary" disabled={(mode === 'card' && !card) || (mode === 'account' && !account)}>
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- Şirketler

export function Companies({ onClose }: { onClose: () => void }) {
  const { state, apply } = useStore()
  const { confirm } = useDialogs()
  const [name, setName] = useState('')
  return (
    <Modal title="Şirketleri Yönet" onClose={onClose}>
      <div className="form">
        <p className="muted form-note">
          Holding bünyesindeki her şirketi ayrı tanımlayın. Sol menüden şirket seçerek yalnızca o şirketin verilerini görürsünüz;
          "Holding Geneli"nde yeni kayıt eklerken şirket sorulur.
        </p>
        <ul className="company-list">
          {state.companies.map((c) => (
            <li key={c.id}>
              <input
                defaultValue={c.name}
                aria-label="Şirket adı"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== c.name) apply((s) => saveCompany(s, { id: c.id, name: v }), 'Şirket adı değişti')
                }}
              />
              <button
                type="button"
                className="icon-btn danger"
                title={state.companies.length <= 1 ? 'En az bir şirket kalmalı' : 'Şirketi sil'}
                aria-label={`${c.name} şirketini sil`}
                disabled={state.companies.length <= 1}
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Şirket silinsin mi?',
                      message: `"${c.name}" şirketi ve ona bağlı TÜM kayıtlar (hesap, kredi, kart, cari, çek, gelir/gider) silinecek. "Geri al" ile dönebilirsiniz.`,
                      confirmLabel: 'Şirketi sil',
                      danger: true,
                    })
                  )
                    apply((s) => deleteCompany(s, c.id), `"${c.name}" silindi`)
                }}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) {
              apply((s) => saveCompany(s, { name: name.trim() }))
              setName('')
            }
          }}
        >
          <Field label="Yeni şirket">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Demir Lojistik A.Ş." />
          </Field>
          <button type="submit" className="btn primary align-end">
            Ekle
          </button>
        </form>
        <div className="form-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Tamam
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- Yardım

const SHORTCUTS: [string, string][] = [
  ['Ctrl + N', 'Harcama ekle'],
  ['Ctrl + 1…9', 'Sayfalar arasında geçiş'],
  ['Ctrl + Z', 'Son değişikliği geri al (yazı alanı dışında)'],
  ['Ctrl + ,', 'Ayarlar'],
  ['Ctrl + = / − / 0', 'Yakınlaştır / uzaklaştır / sıfırla'],
  ['F1', 'Bu yardım'],
  ['Esc', 'Açık pencereyi kapat'],
]

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Nasıl Kullanılır?" onClose={onClose} wide>
      <div className="help">
        <section>
          <h4>1. Şirketler ve hesaplar</h4>
          <p>
            Ayarlar → <strong>Şirketleri yönet</strong> ile şirketleri ekleyin. <strong>Hesaplar</strong> sayfasında vadesiz hesap,
            kasa, KMH ve vadeli mevduatlarınızı girin. Dövizli hesaplar için Ayarlar'dan kur girin.
          </p>
        </section>
        <section>
          <h4>2. Kart, kredi ve düzenli ödemeler</h4>
          <p>
            <strong>Kredi Kartları</strong>'nda kesim ve son ödeme gününü girin; harcamalar doğru ekstreye, taksitliyse sonraki
            aylara yerleşir. <strong>Krediler</strong>'de taksit planı kendiliğinden oluşur. Maaş, kira, fatura gibi düzenli
            işlemleri <strong>Gelir / Gider</strong>'e "Her ay" olarak bir kez ekleyin.
          </p>
        </section>
        <section>
          <h4>3. Ödendi işaretleme</h4>
          <p>
            Bir vadeyi ödediğinizde kutucuğu işaretleyin ve hangi hesaptan ödediğinizi seçin — hesap bakiyesi kendiliğinden
            güncellenir. Tutar farklıysa gerçek tutarı yazın. İşareti kaldırırsanız bakiye geri gelir.
          </p>
        </section>
        <section>
          <h4>4. Cari ve çek/senet</h4>
          <p>
            <strong>Cari Hesaplar</strong>'da müşteri/tedarikçi açın; <strong>Çek / Senet</strong>'te evrakları vadesiyle girin. Ciro
            ettiğiniz çeki "Ciro edildi" yapın. Cari ekstresini PDF veya Excel olarak alabilirsiniz.
          </p>
        </section>
        <section>
          <h4>5. Takip</h4>
          <p>
            <strong>Haftalık Takvim</strong> hafta hafta gelen/giden parayı ve hafta sonu tahmini bakiyeyi gösterir. <strong>Bütçe</strong>{' '}
            ve <strong>Raporlar</strong> ile gerçekleşen ve planlanan harcamaları izleyin.
          </p>
        </section>
        <section>
          <h4>Verileriniz nerede?</h4>
          <p>
            Her şey yalnızca bu bilgisayarda saklanır. Uygulama her gün otomatik yedek alır; Ayarlar → Yedekler'den ikinci bir
            yedek konumu (ör. OneDrive) seçmenizi ve ara sıra JSON yedeği almanızı öneririz. Yanlışlıkla sildiğiniz bir şeyi
            ekranın altında çıkan "Geri al" ile veya Ctrl + Z ile geri getirebilirsiniz.
          </p>
        </section>
        <section>
          <h4>Klavye kısayolları</h4>
          <table className="table shortcuts">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              resetTips()
              onClose()
            }}
          >
            💡 İpuçlarını tekrar göster
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Anladım
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- Kilit ekranı

export function LockScreen({ salt, hash, onUnlock }: { salt: string; hash: string; onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const attempts = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [wait])
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (wait > 0) return
    if (await verifyPin(pin, salt, hash)) {
      attempts.current = 0
      onUnlock()
      return
    }
    attempts.current++
    setPin('')
    // Art arda yanlış denemelerde bekleme süresi artar
    if (attempts.current >= 5) {
      setWait(Math.min(300, 15 * 2 ** (attempts.current - 5)))
      setError('Çok fazla yanlış deneme. Lütfen bekleyin.')
    } else setError('PIN yanlış.')
  }
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <form className="lock-card" onSubmit={(e) => void submit(e)}>
        <span className="logo-mark big" aria-hidden="true">
          <LockIcon size={26} />
        </span>
        <h2 id="lock-title">Finans Takip kilitli</h2>
        <p className="muted">Devam etmek için PIN'inizi girin.</p>
        <input
          ref={input}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-label="PIN"
          disabled={wait > 0}
          className="pin-input"
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
            {wait > 0 && ` (${wait} sn)`}
          </p>
        )}
        <button type="submit" className="btn primary full" disabled={wait > 0 || pin.length < 4}>
          Kilidi Aç
        </button>
        <p className="muted small-note">PIN'i unuttuysanız: Ayarlar dosyası yerine son JSON yedeğinizi başka bir kurulumda açabilirsiniz.</p>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- Kurtarma ekranı

/** JSON yedeğini (sarmalanmış veya çıplak) okur; Excel modülünü yüklemez. */
function fromJsonBackupSafe(text: string): State {
  const parsed = JSON.parse(text) as { app?: string; data?: unknown }
  const data = parsed && parsed.app === 'finans-takip' && parsed.data ? parsed.data : parsed
  return migrate(data).state
}

/** Veri dosyası bozuk çıktığında: hiçbir şey silinmeden yedekten dönme seçenekleri. */
export function RecoveryScreen({
  reason,
  movedTo,
  backups,
  onRecovered,
}: {
  reason: string
  movedTo: string
  backups: BackupInfo[]
  onRecovered: (s: State | null, note: string) => void
}) {
  const { confirm } = useDialogs()
  const [error, setError] = useState<string | null>(null)
  const usable = backups.filter((b) => !b.name.startsWith('bozuk-'))
  const restore = async (name: string) => {
    try {
      const text = await platform.readBackup(name)
      const st = fromJsonBackupSafe(text)
      onRecovered(st, `${name} yedeğinden geri yüklendi.`)
    } catch (err) {
      setError(`${name} açılamadı: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return (
    <div className="recovery">
      <div className="card recovery-card" role="alert">
        <h2>Veri dosyası okunamadı</h2>
        <p>
          Dosya bozulmuş görünüyor ({reason}). <strong>Hiçbir veri silinmedi:</strong> bozuk dosya yedek klasörüne{' '}
          <code>{movedTo}</code> adıyla taşındı.
        </p>
        {usable.length > 0 ? (
          <>
            <p>Aşağıdaki yedeklerden birine dönebilirsiniz (en yenisi üstte):</p>
            <ul className="simple-list">
              {usable.slice(0, 10).map((b) => (
                <li key={b.name}>
                  <span>
                    {b.name}
                    <span className="muted small-note">{new Date(b.mtime).toLocaleString('tr-TR')}</span>
                  </span>
                  <button type="button" className="btn small primary" onClick={() => void restore(b.name)}>
                    Bu yedeğe dön
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">Otomatik yedek bulunamadı.</p>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn" onClick={() => void platform.openBackupFolder()}>
            Yedek klasörünü aç
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const f = await platform.openFile({ filters: [{ name: 'JSON yedeği', extensions: ['json'] }] })
              if (!f) return
              try {
                onRecovered(fromJsonBackupSafe(new TextDecoder().decode(f.data)), `${f.name} dosyasından yüklendi.`)
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }}
          >
            JSON yedeği seç…
          </button>
          <button
            type="button"
            className="btn danger-btn"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Boş veriyle başlansın mı?',
                  message: 'Bozuk dosya yedek klasöründe kalmaya devam eder; daha sonra yine geri yükleyebilirsiniz.',
                  confirmLabel: 'Boş başla',
                  danger: true,
                })
              )
                onRecovered(null, 'empty')
            }}
          >
            Boş başla
          </button>
        </div>
      </div>
    </div>
  )
}

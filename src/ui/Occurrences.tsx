import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ID, Minor, Occurrence } from '../domain/types'
import { fmt, toTRY } from '../domain/money'
import { fmtDate, fmtDayShort } from '../domain/dates'
import { useStore } from '../store/StoreProvider'
import { setPaymentException, settle, unsettle } from '../store/actions'
import { useDialogs } from './Dialogs'
import { Modal } from './Modal'
import { AccountSelect, AmountInput, Field, amountOk } from './Form'
import { BankIcon, CardIcon, ChequeIcon, EditIcon, FlowIcon } from './Icons'

const ICONS = {
  loan: <BankIcon size={16} />,
  card: <CardIcon size={16} />,
  payment: <FlowIcon size={16} />,
  cheque: <ChequeIcon size={16} />,
}

const LAST_ACCOUNT_KEY = 'finans-last-account'

function lastAccount(companyId: ID): ID | undefined {
  try {
    return (JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) ?? '{}') as Record<string, ID>)[companyId]
  } catch {
    return undefined
  }
}
function rememberAccount(companyId: ID, accountId: ID) {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) ?? '{}')
    m[companyId] = accountId
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(m))
  } catch {
    /* önemsiz */
  }
}

interface SettleCtx {
  toggle: (o: Occurrence) => void
  edit: (o: Occurrence) => void
}
const Ctx = createContext<SettleCtx | null>(null)

export function useSettle(): SettleCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('SettleProvider eksik')
  return c
}

/** "Ödendi" işaretleme ve vade düzenleme pencerelerini yönetir. */
export function SettleProvider({ children }: { children: ReactNode }) {
  const { apply } = useStore()
  const { toast } = useDialogs()
  const [settling, setSettling] = useState<Occurrence | null>(null)
  const [editing, setEditing] = useState<Occurrence | null>(null)

  const toggle = useCallback(
    (o: Occurrence) => {
      if (o.paid) {
        apply((s) => unsettle(s, o.key), `"${o.title}" ödenmedi olarak işaretlendi`)
      } else setSettling(o)
    },
    [apply],
  )

  return (
    <Ctx.Provider value={{ toggle, edit: setEditing }}>
      {children}
      {settling && (
        <SettleDialog
          occ={settling}
          onClose={() => setSettling(null)}
          onDone={(msg) => {
            setSettling(null)
            toast(msg, { kind: 'success' })
          }}
        />
      )}
      {editing && <OccurrenceEditDialog occ={editing} onClose={() => setEditing(null)} />}
    </Ctx.Provider>
  )
}

function SettleDialog({ occ, onClose, onDone }: { occ: Occurrence; onClose: () => void; onDone: (msg: string) => void }) {
  const { state, today, apply } = useStore()
  const defaultAccount =
    lastAccount(occ.companyId) ??
    state.accounts.find((a) => a.companyId === occ.companyId && a.kind !== 'deposit')?.id ??
    state.accounts.find((a) => a.kind !== 'deposit')?.id ??
    ''
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState<Minor | null>(occ.amount)
  const [accountId, setAccountId] = useState<ID>(state.accounts.some((a) => a.id === defaultAccount) ? defaultAccount : '')
  const [error, setError] = useState<string | null>(null)
  const isIn = occ.direction === 'in'
  const acc = state.accounts.find((a) => a.id === accountId)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!amountOk(amount, { required: true }) || amount === null) return
    try {
      apply((s) => settle(s, occ, { date, amount, accountId: accountId || undefined }))
      if (accountId) rememberAccount(occ.companyId, accountId)
      onDone(`${occ.title} ${isIn ? 'tahsil edildi' : 'ödendi'} olarak işaretlendi${acc ? ` · ${acc.name} güncellendi` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={isIn ? 'Tahsil Edildi' : 'Ödendi'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="settle-summary">
          <strong>{occ.title}</strong>
          <span className="muted">
            {occ.subtitle} · vade {fmtDate(occ.date)}
          </span>
        </div>
        <div className="form-row">
          <AmountInput
            label={`${isIn ? 'Tahsil edilen' : 'Ödenen'} tutar`}
            value={amount}
            onChange={setAmount}
            currency={occ.currency}
            required
            autoFocus
            hint={amount !== occ.amount ? `Planlanan: ${fmt(occ.amount, occ.currency)}` : undefined}
          />
          <Field label="Tarih">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <AccountSelect
          label={isIn ? 'Hangi hesaba girdi?' : 'Hangi hesaptan ödendi?'}
          value={accountId}
          onChange={setAccountId}
          companyId={occ.companyId}
          allowNone
        />
        <p className="muted form-note">
          {acc
            ? `${acc.name} bakiyesi ${isIn ? 'artırılacak' : 'azaltılacak'}; işareti kaldırırsanız geri alınır.`
            : 'Hesap seçmezseniz yalnızca işaretlenir; bakiyeyi kendiniz güncellemelisiniz.'}
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn primary">
            {isIn ? 'Tahsil Edildi' : 'Ödendi'} Olarak İşaretle
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Tekrarlayan kaydın yalnızca bu vadesini değiştir / atla. */
function OccurrenceEditDialog({ occ, onClose }: { occ: Occurrence; onClose: () => void }) {
  const { state, apply } = useStore()
  const { toast } = useDialogs()
  const p = state.payments.find((x) => x.id === occ.sourceId)
  const current = p?.exceptions[occ.scheduledDate]
  const [amount, setAmount] = useState<Minor | null>(current?.amount ?? occ.amount)
  if (!p) return null
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (amount === null || amount <= 0) return
    apply(
      (s) => setPaymentException(s, p.id, occ.scheduledDate, amount === p.amount ? undefined : { amount }),
      `${fmtDate(occ.scheduledDate)} vadesi güncellendi`,
    )
    onClose()
  }
  return (
    <Modal title="Bu Vadeyi Düzenle" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="settle-summary">
          <strong>{p.title}</strong>
          <span className="muted">
            {fmtDate(occ.scheduledDate)} vadesi · normal tutar {fmt(p.amount, p.currency)}
          </span>
        </div>
        <AmountInput label="Bu vadenin tutarı" value={amount} onChange={setAmount} currency={p.currency} required autoFocus />
        <p className="muted form-note">Yalnızca bu vade değişir; diğer ayların tutarı aynı kalır.</p>
        <div className="form-actions">
          <button
            type="button"
            className="btn danger-btn"
            onClick={() => {
              apply((s) => setPaymentException(s, p.id, occ.scheduledDate, { skip: true }), `${fmtDate(occ.scheduledDate)} vadesi atlandı`)
              toast('Vade atlandı. Gelir/Gider sayfasından geri getirebilirsiniz.')
              onClose()
            }}
          >
            Bu vadeyi atla
          </button>
          {current && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                apply((s) => setPaymentException(s, p.id, occ.scheduledDate, undefined), 'Vade eski haline döndü')
                onClose()
              }}
            >
              Normale döndür
            </button>
          )}
          <button type="submit" className="btn primary">
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Vade satırları: işaretleme kutusu, tutar, gecikme etiketi, düzenleme. */
export function OccurrenceList({ items, emptyText, showCompany }: { items: Occurrence[]; emptyText?: string; showCompany?: boolean }) {
  const { today, state } = useStore()
  const { toggle, edit } = useSettle()
  if (items.length === 0) return <div className="empty-line">{emptyText ?? 'Bu aralıkta hareket yok.'}</div>
  const rates = state.settings.rates
  const companyName = (id: ID) => state.companies.find((c) => c.id === id)?.name ?? ''
  return (
    <ul className="occ-list">
      {items.map((o) => {
        const overdue = !o.paid && o.date < today
        const label = `${o.title} ${o.paid ? 'ödenmedi olarak işaretle' : o.direction === 'in' ? 'tahsil edildi olarak işaretle' : 'ödendi olarak işaretle'}`
        return (
          <li key={o.key} className={`occ-row${o.paid ? ' paid' : ''}${overdue ? ' overdue' : ''}`}>
            <label className="occ-check" title={label}>
              <input type="checkbox" checked={o.paid} onChange={() => toggle(o)} aria-label={label} />
            </label>
            <span className={`occ-icon ${o.sourceType}`} aria-hidden="true">
              {ICONS[o.sourceType]}
            </span>
            <div className="occ-text">
              <span className="occ-title">{o.title}</span>
              <span className="occ-sub">
                {o.subtitle}
                {showCompany && state.companies.length > 1 ? ` · ${companyName(o.companyId)}` : ''}
                {o.date !== o.scheduledDate ? ` · iş gününe kaydı (${fmtDayShort(o.scheduledDate)})` : ''}
              </span>
            </div>
            <div className="occ-right">
              <span className={`occ-amount ${o.direction}`}>
                {o.direction === 'in' ? '+' : '−'}
                {fmt(o.amount, o.currency)}
              </span>
              {o.currency !== 'TRY' && <span className="occ-date">≈ {fmt(toTRY(o.amount, o.currency, rates))}</span>}
              <span className="occ-date">
                {fmtDayShort(o.date)}
                {overdue && <em className="overdue-tag">gecikmiş</em>}
              </span>
            </div>
            {o.sourceType === 'payment' && !o.paid ? (
              <button type="button" className="icon-btn" title="Bu vadeyi düzenle / atla" aria-label={`${o.title} vadesini düzenle`} onClick={() => edit(o)}>
                <EditIcon size={14} />
              </button>
            ) : (
              <span className="icon-spacer" />
            )}
          </li>
        )
      })}
    </ul>
  )
}

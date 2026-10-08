import { useEffect, useId, useState, type ReactNode } from 'react'
import type { CategoryKind, Currency, ID, Minor } from '../domain/types'
import { CURRENCIES } from '../domain/types'
import { CURRENCY_LABEL, fmt, fmtPlain, parseAmount } from '../domain/money'
import { normCategory } from '../domain/defaults'
import { useStore } from '../store/StoreProvider'
import { addCategory } from '../store/actions'

interface FieldProps {
  label: string
  children: ReactNode
  error?: string | null
  hint?: ReactNode
  className?: string
}

/** Etiket + alan + hata/ipucu satırı. */
export function Field({ label, children, error, hint, className }: FieldProps) {
  return (
    <label className={`field${error ? ' has-error' : ''}${className ? ' ' + className : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  )
}

interface AmountProps {
  label: string
  value: Minor | null
  onChange: (v: Minor | null) => void
  currency?: Currency
  required?: boolean
  allowNegative?: boolean
  allowZero?: boolean
  autoFocus?: boolean
  placeholder?: string
  hint?: ReactNode
  /** Dışarıdan gösterilecek doğrulama hatası */
  error?: string | null
}

/**
 * Tutar alanı. Türkçe yazımı anlar ("1.250.000,50"), yazarken sonucu
 * gösterir, alandan çıkınca binlik ayırıcıyla biçimlendirir. Okunamayan
 * değer sessizce 0 olmaz; hata gösterilir ve form gönderilemez.
 */
export function AmountInput({
  label,
  value,
  onChange,
  currency = 'TRY',
  required,
  allowNegative,
  allowZero,
  autoFocus,
  placeholder,
  hint,
  error,
}: AmountProps) {
  const [raw, setRaw] = useState(value === null ? '' : fmtPlain(value))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    // Dışarıdan değer değişirse (ör. önerilen tutar) kutuyu güncelle
    const parsed = parseAmount(raw)
    if (value !== parsed) setRaw(value === null ? '' : fmtPlain(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const parsed = parseAmount(raw)
  let ownError: string | null = null
  if (raw.trim() !== '' && parsed === null) ownError = 'Tutar okunamadı. Örnek: 1.250.000 veya 1.250,50'
  else if (parsed !== null && parsed < 0 && !allowNegative) ownError = 'Tutar eksi olamaz.'
  else if (parsed === 0 && !allowZero && required) ownError = 'Tutar sıfır olamaz.'
  else if (required && touched && raw.trim() === '') ownError = 'Tutar gerekli.'
  const shownError = error ?? ownError
  return (
    <Field
      label={label}
      error={shownError}
      hint={parsed !== null && raw.trim() !== '' ? <>= {fmt(parsed, currency)}</> : hint}
    >
      <input
        value={raw}
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        autoFocus={autoFocus}
        aria-invalid={!!shownError}
        onChange={(e) => {
          setRaw(e.target.value)
          const p = parseAmount(e.target.value)
          onChange(p)
        }}
        onBlur={() => {
          setTouched(true)
          if (parsed !== null) setRaw(fmtPlain(parsed))
        }}
      />
    </Field>
  )
}

/** Tutar alanının geçerli olup olmadığı (form gönderirken). */
export function amountOk(v: Minor | null, opts: { required?: boolean; allowZero?: boolean; allowNegative?: boolean } = {}) {
  if (v === null) return !opts.required
  if (v < 0 && !opts.allowNegative) return false
  if (v === 0 && !opts.allowZero && opts.required) return false
  return true
}

export function CurrencySelect({ value, onChange, label = 'Para Birimi' }: { value: Currency; onChange: (c: Currency) => void; label?: string }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as Currency)}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {CURRENCY_LABEL[c]}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Ortak kategori listesinden seçim + yeni kategori ekleme (madde 33). */
export function CategorySelect({
  kind,
  value,
  onChange,
  label = 'Kategori',
}: {
  kind: CategoryKind
  value: string
  onChange: (v: string) => void
  label?: string
}) {
  const { state, apply } = useStore()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const options = state.categories.filter((c) => c.kind === kind)
  const known = options.some((c) => normCategory(c.name) === normCategory(value))
  const id = useId()
  if (adding) {
    return (
      <Field label={label} hint="Enter ile ekleyin, Esc ile vazgeçin">
        <div className="inline-add">
          <input
            id={id}
            value={draft}
            autoFocus
            placeholder="Yeni kategori adı"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!draft.trim()) return
                let name = draft
                apply((s) => {
                  const r = addCategory(s, draft, kind)
                  name = r.name
                  return r.state
                })
                onChange(name)
                setAdding(false)
                setDraft('')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setAdding(false)
              }
            }}
          />
          <button type="button" className="btn small" onClick={() => setAdding(false)}>
            Vazgeç
          </button>
        </div>
      </Field>
    )
  }
  return (
    <Field label={label}>
      <select
        value={known ? options.find((c) => normCategory(c.name) === normCategory(value))!.name : value}
        onChange={(e) => {
          if (e.target.value === '__new__') setAdding(true)
          else onChange(e.target.value)
        }}
      >
        {!value && <option value="">— Seçin —</option>}
        {!known && value && <option value={value}>{value}</option>}
        {options.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
        <option value="__new__">+ Yeni kategori…</option>
      </select>
    </Field>
  )
}

/** "Holding Geneli" seçiliyken yeni kaydın hangi şirkete gideceğini sorar (madde 17). */
export function CompanyField({ value, onChange }: { value: ID; onChange: (id: ID) => void }) {
  const { state } = useStore()
  if (state.companies.length <= 1) return null
  return (
    <Field label="Şirket" error={value ? null : 'Kaydın hangi şirkete ait olduğunu seçin.'}>
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">— Şirket seçin —</option>
        {state.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Yeni kayıt formlarında şirket alanının başlangıç değeri. */
export function useInitialCompany(existing?: ID): [ID, (id: ID) => void, boolean] {
  const { targetCompanyId, state } = useStore()
  const [company, setCompany] = useState<ID>(existing ?? targetCompanyId ?? '')
  const ask = !existing && state.activeCompanyId === 'all' && state.companies.length > 1
  return [company, setCompany, ask]
}

export function AccountSelect({
  value,
  onChange,
  label = 'Hesap',
  companyId,
  allowNone,
  noneLabel = '— Hesaptan düşme / ekleme —',
}: {
  value: ID
  onChange: (id: ID) => void
  label?: string
  companyId?: ID
  allowNone?: boolean
  noneLabel?: string
}) {
  const { state } = useStore()
  const accounts = state.accounts
    .filter((a) => !companyId || a.companyId === companyId || state.companies.length === 1)
    .sort((a, b) => Number(a.kind === 'deposit') - Number(b.kind === 'deposit'))
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">{noneLabel}</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} — {fmt(a.balance, a.currency)}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Form ilk değerlerinden farklı mı? (kaydedilmemiş değişiklik uyarısı için) */
export function useDirty(values: unknown): boolean {
  const [initial] = useState(() => JSON.stringify(values))
  return JSON.stringify(values) !== initial
}

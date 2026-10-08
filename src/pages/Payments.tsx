import { useMemo, useState } from 'react'
import type { Currency, ID, Minor, Payment, Recurrence } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { deletePayment, savePayment, setPaymentException } from '../store/actions'
import { addDays, addMonths, fmtDate } from '../domain/dates'
import { fmt } from '../domain/money'
import { generateOccurrences } from '../domain/occurrences'
import { DataTable, type Column } from '../ui/DataTable'
import { Modal } from '../ui/Modal'
import { OccurrenceList } from '../ui/Occurrences'
import { PageHead, Segmented, Tip } from '../ui/Common'
import { AmountInput, CategorySelect, CompanyField, CurrencySelect, Field, amountOk, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { EditIcon, PlusIcon, TrashIcon } from '../ui/Icons'

const REC_LABEL: Record<Recurrence, string> = { once: 'Tek seferlik', weekly: 'Haftalık', monthly: 'Aylık' }

export function Payments() {
  const { scoped, state, today, apply } = useStore()
  const { confirm } = useDialogs()
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')
  const [editing, setEditing] = useState<Payment | 'new' | null>(null)
  const [from, setFrom] = useState(addDays(today, -30))
  const [to, setTo] = useState(addDays(today, 60))
  const [hidePaid, setHidePaid] = useState(true)

  const upcoming = useMemo(
    () =>
      from && to && from <= to
        ? generateOccurrences({ ...scoped, loans: [], cards: [], cheques: [] }, from, to).filter(
            (o) => (filter === 'all' || o.direction === filter) && (!hidePaid || !o.paid),
          )
        : [],
    [scoped, filter, from, to, hidePaid],
  )
  const rows = scoped.payments.filter((p) => filter === 'all' || p.type === filter)
  const skipped = scoped.payments.flatMap((p) =>
    Object.entries(p.exceptions)
      .filter(([, e]) => e.skip)
      .map(([d]) => ({ p, d })),
  )
  const contactName = (id?: ID) => (id ? state.contacts.find((c) => c.id === id)?.name ?? '' : '')

  const remove = async (p: Payment) => {
    if (
      await confirm({
        title: 'Kayıt silinsin mi?',
        message: `"${p.title}" ve ${p.recurrence === 'once' ? 'ödendi bilgisi' : 'bütün vadeleri'} silinecek. Hesap hareketleri korunur.`,
        confirmLabel: 'Sil',
        danger: true,
      })
    )
      apply((s) => deletePayment(s, p.id), `"${p.title}" silindi`)
  }

  const columns: Column<Payment>[] = [
    {
      key: 'title',
      header: 'Başlık',
      sort: (p) => p.title,
      render: (p) => (
        <>
          <span className={`dot ${p.type}`} aria-hidden="true" />
          {p.title}
          {p.contactId && <span className="muted small-note">{contactName(p.contactId)}</span>}
        </>
      ),
    },
    { key: 'cat', header: 'Kategori', sort: (p) => p.category, render: (p) => <span className="muted">{p.category || '—'}</span> },
    {
      key: 'amount',
      header: 'Tutar',
      align: 'right',
      sort: (p) => (p.type === 'in' ? p.amount : -p.amount),
      render: (p) => (
        <span className={p.type === 'in' ? 'pos' : 'neg'}>
          {p.type === 'in' ? '+' : '−'}
          {fmt(p.amount, p.currency)}
        </span>
      ),
    },
    { key: 'rec', header: 'Tekrar', sort: (p) => p.recurrence, render: (p) => <span className="muted">{REC_LABEL[p.recurrence]}{p.endDate ? ` · ${fmtDate(p.endDate)}'e kadar` : ''}</span> },
    { key: 'date', header: 'Başlangıç', sort: (p) => p.date, render: (p) => <span className="muted">{fmtDate(p.date)}</span> },
    {
      key: 'act',
      header: '',
      render: (p) => (
        <div className="row-actions">
          <button type="button" className="icon-btn" aria-label={`${p.title} düzenle`} title="Düzenle" onClick={() => setEditing(p)}>
            <EditIcon size={16} />
          </button>
          <button type="button" className="icon-btn danger" aria-label={`${p.title} sil`} title="Sil" onClick={() => void remove(p)}>
            <TrashIcon size={16} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <PageHead title="Gelir / Gider">
        <Segmented
          label="Tür filtresi"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tümü' },
            { value: 'in', label: 'Gelen' },
            { value: 'out', label: 'Giden' },
          ]}
        />
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Kayıt Ekle
        </button>
      </PageHead>
      <Tip id="payments">
        Maaş, kira, fatura gibi düzenli işlemleri "Her ay" tekrarıyla bir kez ekleyin. Bir ay tutar farklı gelirse
        takvimdeki satırın kalem simgesiyle yalnızca o vadeyi değiştirebilir veya atlayabilirsiniz.
      </Tip>
      <div className="card">
        <div className="card-head">
          <h3>Tanımlı Kayıtlar</h3>
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          searchText={(p) => `${p.title} ${p.category} ${contactName(p.contactId)}`}
          searchPlaceholder="Başlık, kategori veya cari ara"
          defaultSort={{ key: 'date', dir: 'desc' }}
          emptyText="Kayıt yok."
        />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Hareketler</h3>
          <div className="range-filter">
            <label>
              <span className="sr-only">Başlangıç</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Başlangıç tarihi" />
            </label>
            <span className="muted">–</span>
            <label>
              <span className="sr-only">Bitiş</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Bitiş tarihi" />
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={hidePaid} onChange={(e) => setHidePaid(e.target.checked)} />
              Ödenenleri gizle
            </label>
          </div>
        </div>
        {from > to && <p className="field-error">Başlangıç tarihi bitişten sonra olamaz.</p>}
        <OccurrenceList items={upcoming} emptyText="Bu aralıkta hareket yok." showCompany />
      </div>
      {skipped.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Atlanan Vadeler</h3>
          </div>
          <ul className="simple-list">
            {skipped.map(({ p, d }) => (
              <li key={p.id + d}>
                <span>
                  {p.title} · <span className="muted">{fmtDate(d)}</span>
                </span>
                <button type="button" className="btn small" onClick={() => apply((s) => setPaymentException(s, p.id, d, undefined), 'Vade geri getirildi')}>
                  Geri getir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && <PaymentForm payment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

export function PaymentForm({ payment, onClose, preset }: { payment: Payment | null; onClose: () => void; preset?: Partial<Payment> }) {
  const { apply, state, today } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(payment?.companyId)
  const [type, setType] = useState<'in' | 'out'>(payment?.type ?? preset?.type ?? 'out')
  const [title, setTitle] = useState(payment?.title ?? preset?.title ?? '')
  const [category, setCategory] = useState(payment?.category ?? preset?.category ?? '')
  const [contactId, setContactId] = useState<ID>(payment?.contactId ?? preset?.contactId ?? '')
  const [currency, setCurrency] = useState<Currency>(payment?.currency ?? 'TRY')
  const [amount, setAmount] = useState<Minor | null>(payment?.amount ?? null)
  const [date, setDate] = useState(payment?.date ?? preset?.date ?? today)
  const [recurrence, setRecurrence] = useState<Recurrence>(payment?.recurrence ?? preset?.recurrence ?? 'once')
  const [endDate, setEndDate] = useState(payment?.endDate ?? '')
  const [count, setCount] = useState('')
  const dirty = useDirty({ type, title, category, contactId, currency, amount, date, recurrence, endDate })
  const contacts = state.contacts.filter((c) => !company || c.companyId === company)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !amountOk(amount, { required: true }) || amount === null || (askCompany && !company)) return
    apply(
      (s) =>
        savePayment(
          s,
          {
            ...(payment ?? { exceptions: {} }),
            id: payment?.id,
            companyId: company || undefined,
            type,
            title: title.trim(),
            category,
            contactId: contactId || undefined,
            currency,
            amount,
            date,
            recurrence,
            endDate: recurrence !== 'once' && endDate ? endDate : undefined,
            exceptions: payment?.exceptions ?? {},
          },
          company || state.companies[0]!.id,
        ),
      payment ? `"${title}" güncellendi` : undefined,
    )
    onClose()
  }

  return (
    <Modal title={payment ? 'Kaydı Düzenle' : 'Yeni Gelir / Gider'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        <Segmented
          full
          label="Tür"
          value={type}
          onChange={(v) => {
            setType(v)
            setCategory('')
          }}
          options={[
            { value: 'in', label: 'Gelen Para', tone: 'in' },
            { value: 'out', label: 'Giden Para', tone: 'out' },
          ]}
        />
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <Field label="Başlık" error={dirty && !title.trim() ? 'Başlık gerekli.' : null}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Maaş, Kira, Fatura…" required autoFocus />
        </Field>
        <div className="form-row">
          <CategorySelect kind={type} value={category} onChange={setCategory} />
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <div className="form-row">
          <AmountInput label="Tutar" value={amount} onChange={setAmount} currency={currency} required />
          <Field label={recurrence === 'once' ? 'Tarih' : 'İlk vade'}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Tekrar">
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              <option value="once">Tek seferlik</option>
              <option value="weekly">Her hafta</option>
              <option value="monthly">Her ay</option>
            </select>
          </Field>
          {recurrence !== 'once' && (
            <Field label="Bitiş tarihi (opsiyonel)" hint={recurrence === 'monthly' ? 'veya taksit sayısı yazın →' : undefined}>
              <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          )}
          {recurrence === 'monthly' && (
            <Field label="Kaç ay?">
              <input
                inputMode="numeric"
                value={count}
                placeholder="ör. 12"
                onChange={(e) => {
                  setCount(e.target.value)
                  const n = Number(e.target.value)
                  if (Number.isInteger(n) && n > 0 && n < 600) setEndDate(addMonths(date, n - 1))
                }}
              />
            </Field>
          )}
        </div>
        <Field label="Cari (opsiyonel)">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— Seçilmedi —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn primary">
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  )
}

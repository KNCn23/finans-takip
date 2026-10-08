import { useState } from 'react'
import type { Cheque, ChequeStatus, Currency, ID, Minor } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { deleteCheque, saveCheque, setChequeStatus } from '../store/actions'
import { fmtDate } from '../domain/dates'
import { fmt, toTRY } from '../domain/money'
import { DataTable, type Column } from '../ui/DataTable'
import { Modal } from '../ui/Modal'
import { PageHead, Segmented, StatCard, Tip } from '../ui/Common'
import { AccountSelect, AmountInput, CompanyField, CurrencySelect, Field, amountOk, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { EditIcon, PlusIcon, TrashIcon } from '../ui/Icons'

export const STATUS_LABEL: Record<ChequeStatus, string> = {
  pending: 'Bekliyor',
  cleared: 'Tamamlandı',
  bounced: 'Karşılıksız',
  endorsed: 'Ciro edildi',
}

export function Cheques() {
  const { scoped, state, today, apply } = useStore()
  const { confirm, toast } = useDialogs()
  const [editing, setEditing] = useState<Cheque | 'new' | null>(null)
  const [action, setAction] = useState<{ cheque: Cheque; status: 'cleared' | 'endorsed' } | null>(null)
  const [history, setHistory] = useState<Cheque | null>(null)
  const [type, setType] = useState<'all' | 'received' | 'issued'>('all')
  const [instrument, setInstrument] = useState<'all' | 'cheque' | 'note'>('all')
  const showCompany = state.activeCompanyId === 'all' && state.companies.length > 1
  const rates = scoped.settings.rates
  const rows = scoped.cheques.filter((c) => (type === 'all' || c.type === type) && (instrument === 'all' || c.instrument === instrument))
  const total = (f: (c: Cheque) => boolean) => scoped.cheques.filter(f).reduce((t, c) => t + toTRY(c.amount, c.currency, rates), 0)
  const contactName = (id?: ID) => (id ? state.contacts.find((c) => c.id === id)?.name : undefined)

  const changeStatus = async (c: Cheque, status: ChequeStatus) => {
    if (status === 'cleared' || status === 'endorsed') return setAction({ cheque: c, status })
    if (status === 'bounced') {
      const ok = await confirm({
        title: 'Karşılıksız olarak işaretlensin mi?',
        message: 'Nakit akışından çıkarılır; cari ekstresinde açık alacak/borç olarak kalmaya devam eder.',
        confirmLabel: 'Karşılıksız',
        danger: true,
      })
      if (!ok) return
    }
    apply((s) => setChequeStatus(s, c.id, status, { date: today }), `Durum: ${STATUS_LABEL[status]}`)
  }

  const remove = async (c: Cheque) => {
    if (await confirm({ title: 'Evrak silinsin mi?', message: `${c.bank} ${c.number} — ${fmt(c.amount, c.currency)}`, confirmLabel: 'Sil', danger: true })) {
      apply((s) => deleteCheque(s, c.id), 'Çek/senet silindi')
      toast('Silindi.', { kind: 'info' })
    }
  }

  const columns: Column<Cheque>[] = [
    {
      key: 'due',
      header: 'Vade',
      sort: (c) => c.dueDate,
      render: (c) => (
        <>
          {fmtDate(c.dueDate)}
          {c.status === 'pending' && c.dueDate < today && <em className="overdue-tag">vadesi geçti</em>}
        </>
      ),
    },
    {
      key: 'type',
      header: 'Tür',
      sort: (c) => c.instrument + c.type,
      render: (c) => (
        <span className={`badge-type ${c.type === 'received' ? 'customer' : 'supplier'}`}>
          {c.type === 'received' ? 'Alınan' : 'Verilen'} {c.instrument === 'note' ? 'senet' : 'çek'}
        </span>
      ),
    },
    {
      key: 'bank',
      header: 'Banka / No',
      sort: (c) => c.bank,
      render: (c) => (
        <>
          {c.bank || '—'}
          {c.number && <span className="muted small-note">No: {c.number}</span>}
        </>
      ),
    },
    {
      key: 'contact',
      header: 'Cari',
      sort: (c) => contactName(c.contactId) ?? '',
      render: (c) => (
        <span className="muted">
          {contactName(c.contactId) ?? (c.description || '—')}
          {c.status === 'endorsed' && c.endorsedToContactId && <span className="small-note">→ {contactName(c.endorsedToContactId)}</span>}
        </span>
      ),
    },
    ...(showCompany ? [{ key: 'co', header: 'Şirket', render: (c: Cheque) => <span className="muted">{state.companies.find((x) => x.id === c.companyId)?.name}</span> }] : []),
    {
      key: 'amount',
      header: 'Tutar',
      align: 'right',
      sort: (c) => toTRY(c.amount, c.currency, rates),
      render: (c) => (
        <span className={c.type === 'received' ? 'pos' : 'neg'}>
          {c.type === 'received' ? '+' : '−'}
          {fmt(c.amount, c.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Durum',
      sort: (c) => c.status,
      render: (c) => (
        <select className="status-select" value={c.status} aria-label="Durum" onChange={(e) => void changeStatus(c, e.target.value as ChequeStatus)}>
          {(Object.keys(STATUS_LABEL) as ChequeStatus[])
            .filter((s) => s !== 'endorsed' || c.type === 'received')
            .map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
        </select>
      ),
    },
    {
      key: 'act',
      header: '',
      render: (c) => (
        <div className="row-actions">
          <button type="button" className="btn small" onClick={() => setHistory(c)} title="Portföy hareketleri">
            Geçmiş
          </button>
          <button type="button" className="icon-btn" aria-label="Düzenle" title="Düzenle" onClick={() => setEditing(c)}>
            <EditIcon size={15} />
          </button>
          <button type="button" className="icon-btn danger" aria-label="Sil" title="Sil" onClick={() => void remove(c)}>
            <TrashIcon size={15} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <PageHead title="Çek / Senet">
        <Segmented
          label="Evrak türü"
          value={instrument}
          onChange={setInstrument}
          options={[
            { value: 'all', label: 'Tümü' },
            { value: 'cheque', label: 'Çek' },
            { value: 'note', label: 'Senet' },
          ]}
        />
        <Segmented
          label="Yön"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'Hepsi' },
            { value: 'received', label: 'Alınan' },
            { value: 'issued', label: 'Verilen' },
          ]}
        />
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Evrak Ekle
        </button>
      </PageHead>
      <Tip id="cheques">
        Aldığınız ve verdiğiniz çek ile senetleri vade tarihiyle kaydedin; vadeler takvime ve nakit akışına yansır.
        Müşteriden aldığınız bir çeki tedarikçiye verdiyseniz durumunu "Ciro edildi" yapın. "Geçmiş" düğmesi evrakın
        bütün durum değişikliklerini gösterir.
      </Tip>
      <div className="stat-grid">
        <StatCard icon="↓" tone="net-pos" label="Portföyde (alınan, bekleyen)" value={fmt(total((c) => c.type === 'received' && c.status === 'pending'))} valueClass="pos" />
        <StatCard icon="↑" tone="net-neg" label="Ödenecek (verilen, bekleyen)" value={fmt(total((c) => c.type === 'issued' && c.status === 'pending'))} valueClass="neg" />
        <StatCard icon="⇄" tone="wallet" label="Ciro edilen" value={fmt(total((c) => c.status === 'endorsed'))} />
        <StatCard icon="!" tone="net-neg" label="Karşılıksız" value={fmt(total((c) => c.status === 'bounced'))} />
      </div>
      <div className="card">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          searchText={(c) => `${c.bank} ${c.number} ${c.description} ${contactName(c.contactId) ?? ''}`}
          searchPlaceholder="Banka, numara, açıklama veya cari ara"
          defaultSort={{ key: 'due', dir: 'asc' }}
          rowClassName={(c) => (c.status === 'pending' && c.dueDate < today ? 'overdue' : c.status !== 'pending' ? 'paid' : '')}
          emptyText='Kayıtlı çek/senet yok. "Evrak Ekle" ile başlayın.'
        />
      </div>
      {editing && <ChequeForm cheque={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {action && <ChequeActionDialog {...action} onClose={() => setAction(null)} />}
      {history && <HistoryDialog cheque={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

function ChequeActionDialog({ cheque, status, onClose }: { cheque: Cheque; status: 'cleared' | 'endorsed'; onClose: () => void }) {
  const { state, today, apply } = useStore()
  const [date, setDate] = useState(today)
  const [accountId, setAccountId] = useState<ID>(state.accounts.find((a) => a.companyId === cheque.companyId && a.kind !== 'deposit')?.id ?? '')
  const [contact, setContact] = useState<ID>('')
  const [error, setError] = useState<string | null>(null)
  const suppliers = state.contacts.filter((c) => c.companyId === cheque.companyId && c.id !== cheque.contactId)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    try {
      apply(
        (s) => setChequeStatus(s, cheque.id, status, { date, accountId: accountId || undefined, endorsedTo: contact || undefined }),
        status === 'cleared' ? 'Çek tamamlandı' : 'Çek ciro edildi',
      )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <Modal title={status === 'cleared' ? (cheque.type === 'received' ? 'Tahsil Edildi' : 'Ödendi') : 'Ciro Et'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="settle-summary">
          <strong>
            {cheque.bank} {cheque.number}
          </strong>
          <span className="muted">
            {fmt(cheque.amount, cheque.currency)} · vade {fmtDate(cheque.dueDate)}
          </span>
        </div>
        <Field label="Tarih">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        {status === 'cleared' ? (
          <AccountSelect label={cheque.type === 'received' ? 'Hangi hesaba girdi?' : 'Hangi hesaptan ödendi?'} value={accountId} onChange={setAccountId} companyId={cheque.companyId} allowNone />
        ) : (
          <Field label="Ciro edilen cari" error={!contact ? 'Çeki kime verdiğinizi seçin.' : null}>
            <select value={contact} onChange={(e) => setContact(e.target.value)} required autoFocus>
              <option value="">— Cari seçin —</option>
              {suppliers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn primary">
            Onayla
          </button>
        </div>
      </form>
    </Modal>
  )
}

function HistoryDialog({ cheque, onClose }: { cheque: Cheque; onClose: () => void }) {
  const { state } = useStore()
  const c = state.cheques.find((x) => x.id === cheque.id) ?? cheque
  return (
    <Modal title="Portföy Hareketleri" onClose={onClose}>
      <div className="settle-summary">
        <strong>
          {c.instrument === 'note' ? 'Senet' : 'Çek'} {c.number} · {c.bank}
        </strong>
        <span className="muted">
          {fmt(c.amount, c.currency)} · vade {fmtDate(c.dueDate)}
        </span>
      </div>
      <ol className="timeline">
        {[...c.history].reverse().map((h, i) => (
          <li key={i}>
            <strong>{STATUS_LABEL[h.status]}</strong>
            <span className="muted">
              {fmtDate(h.date)}
              {h.note ? ` · ${h.note}` : ''}
            </span>
          </li>
        ))}
      </ol>
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Kapat
        </button>
      </div>
    </Modal>
  )
}

function ChequeForm({ cheque, onClose }: { cheque: Cheque | null; onClose: () => void }) {
  const { apply, state, today } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(cheque?.companyId)
  const [instrument, setInstrument] = useState<'cheque' | 'note'>(cheque?.instrument ?? 'cheque')
  const [type, setType] = useState<'received' | 'issued'>(cheque?.type ?? 'received')
  const [bank, setBank] = useState(cheque?.bank ?? '')
  const [number, setNumber] = useState(cheque?.number ?? '')
  const [contactId, setContactId] = useState<ID>(cheque?.contactId ?? '')
  const [description, setDescription] = useState(cheque?.description ?? '')
  const [currency, setCurrency] = useState<Currency>(cheque?.currency ?? 'TRY')
  const [amount, setAmount] = useState<Minor | null>(cheque?.amount ?? null)
  const [dueDate, setDueDate] = useState(cheque?.dueDate ?? today)
  const [submitted, setSubmitted] = useState(false)
  const dirty = useDirty({ instrument, type, bank, number, contactId, description, currency, amount, dueDate })
  const bankRequired = instrument === 'cheque'
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!amountOk(amount, { required: true }) || amount === null || (bankRequired && !bank.trim()) || (askCompany && !company)) return
    apply(
      (s) =>
        saveCheque(
          s,
          {
            ...(cheque ?? { status: 'pending' as const, history: [] }),
            id: cheque?.id,
            companyId: company || undefined,
            instrument,
            type,
            bank: bank.trim(),
            number: number.trim(),
            contactId: contactId || undefined,
            description: description.trim(),
            currency,
            amount,
            dueDate,
            status: cheque?.status ?? 'pending',
            history: cheque?.history ?? [],
          },
          company || state.companies[0]!.id,
        ),
      cheque ? 'Evrak güncellendi' : undefined,
    )
    onClose()
  }
  return (
    <Modal title={cheque ? 'Evrakı Düzenle' : 'Yeni Çek / Senet'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <Segmented
          full
          label="Evrak"
          value={instrument}
          onChange={setInstrument}
          options={[
            { value: 'cheque', label: 'Çek' },
            { value: 'note', label: 'Senet' },
          ]}
        />
        <Segmented
          full
          label="Yön"
          value={type}
          onChange={setType}
          options={[
            { value: 'received', label: 'Alınan', tone: 'in' },
            { value: 'issued', label: 'Verilen', tone: 'out' },
          ]}
        />
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <div className="form-row">
          <Field label={bankRequired ? 'Banka' : 'Banka (opsiyonel)'} error={submitted && bankRequired && !bank.trim() ? 'Çekin bankasını girin.' : null}>
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Akbank" autoFocus />
          </Field>
          <Field label={instrument === 'cheque' ? 'Çek No' : 'Senet No'}>
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="0451208" />
          </Field>
        </div>
        <div className="form-row">
          <AmountInput label="Tutar" value={amount} onChange={setAmount} currency={currency} required />
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <Field label="Vade Tarihi">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
        <Field label="Cari (opsiyonel)">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— Seçilmedi —</option>
            {state.contacts
              .filter((c) => !company || c.companyId === company)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Açıklama">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ör. B Blok hakediş" />
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

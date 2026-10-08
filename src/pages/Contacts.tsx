import { useMemo, useState } from 'react'
import type { Contact, ContactType, ID, Minor } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { deleteContact, saveContact } from '../store/actions'
import { contactLedger, isValidEmail, isValidPhone, isValidTaxNo, LEDGER_STATUS_LABEL } from '../domain/contacts'
import { fmtDate, fmtDateNumeric } from '../domain/dates'
import { fmt, toMajor } from '../domain/money'
import { DataTable, type Column } from '../ui/DataTable'
import { Modal } from '../ui/Modal'
import { PageHead, Segmented, StatCard, Tip } from '../ui/Common'
import { AmountInput, CompanyField, Field, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { DownloadIcon, EditIcon, PlusIcon, PrintIcon, TrashIcon } from '../ui/Icons'
import { fileStamp, safeFileName, saveAsPdf, saveTableAsExcel } from '../ui/exporting'

const TYPE_LABEL: Record<ContactType, string> = { customer: 'Müşteri', supplier: 'Tedarikçi', both: 'Müşteri + Tedarikçi' }

export function Contacts() {
  const { scoped, state, today, apply } = useStore()
  const { confirm } = useDialogs()
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [ledgerOf, setLedgerOf] = useState<Contact | null>(null)
  const [filter, setFilter] = useState<'all' | 'customer' | 'supplier'>('all')
  const showCompany = state.activeCompanyId === 'all' && state.companies.length > 1

  const balances = useMemo(() => {
    const m = new Map<ID, ReturnType<typeof contactLedger>['balance']>()
    for (const c of scoped.contacts) m.set(c.id, contactLedger(scoped, c, today).balance)
    return m
  }, [scoped, today])
  const rows = scoped.contacts.filter((c) => filter === 'all' || c.type === filter || c.type === 'both')
  const totalRec = rows.reduce((t, c) => t + (balances.get(c.id)?.overdueReceivable ?? 0) + (balances.get(c.id)?.upcomingReceivable ?? 0), 0)
  const totalPay = rows.reduce((t, c) => t + (balances.get(c.id)?.overduePayable ?? 0) + (balances.get(c.id)?.upcomingPayable ?? 0), 0)
  const totalOverdue = rows.reduce((t, c) => t + (balances.get(c.id)?.overdueReceivable ?? 0), 0)

  const remove = async (c: Contact) => {
    if (
      await confirm({
        title: 'Cari silinsin mi?',
        message: `"${c.name}" silinecek. Bağlı gelir/gider ve çek kayıtları silinmez, yalnızca cari bağlantısı kalkar.`,
        confirmLabel: 'Sil',
        danger: true,
      })
    )
      apply((s) => deleteContact(s, c.id), `"${c.name}" carisi silindi`)
  }

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Ünvan',
      sort: (c) => c.name,
      render: (c) => (
        <>
          <strong>{c.name}</strong>
          {c.note && <span className="muted small-note">{c.note}</span>}
        </>
      ),
    },
    ...(showCompany ? [{ key: 'co', header: 'Şirket', sort: (c: Contact) => c.companyId, render: (c: Contact) => <span className="muted">{state.companies.find((x) => x.id === c.companyId)?.name}</span> }] : []),
    { key: 'type', header: 'Tür', sort: (c) => c.type, render: (c) => <span className={`badge-type ${c.type}`}>{TYPE_LABEL[c.type]}</span> },
    {
      key: 'contact',
      header: 'İletişim',
      render: (c) => (
        <span className="muted">
          {c.phone}
          {c.phone && c.email ? ' · ' : ''}
          {c.email}
        </span>
      ),
    },
    {
      key: 'overdue',
      header: 'Vadesi Geçmiş',
      align: 'right',
      sort: (c) => balances.get(c.id)?.overdueReceivable ?? 0,
      render: (c) => {
        const v = balances.get(c.id)?.overdueReceivable ?? 0
        return v > 0 ? <span className="neg">{fmt(v)}</span> : <span className="muted">—</span>
      },
    },
    {
      key: 'net',
      header: 'Net Bakiye',
      align: 'right',
      sort: (c) => balances.get(c.id)?.net ?? 0,
      render: (c) => {
        const v = balances.get(c.id)?.net ?? 0
        return v === 0 ? <span className="muted">—</span> : <span className={v > 0 ? 'pos' : 'neg'} title={v > 0 ? 'Bizim alacağımız' : 'Bizim borcumuz'}>{fmt(v)}</span>
      },
    },
    {
      key: 'act',
      header: '',
      render: (c) => (
        <div className="row-actions">
          <button type="button" className="btn small" onClick={() => setLedgerOf(c)}>
            Ekstre
          </button>
          <button type="button" className="icon-btn" aria-label={`${c.name} düzenle`} title="Düzenle" onClick={() => setEditing(c)}>
            <EditIcon size={15} />
          </button>
          <button type="button" className="icon-btn danger" aria-label={`${c.name} sil`} title="Sil" onClick={() => void remove(c)}>
            <TrashIcon size={15} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <PageHead title="Cari Hesaplar">
        <Segmented
          label="Cari türü"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tümü' },
            { value: 'customer', label: 'Müşteriler' },
            { value: 'supplier', label: 'Tedarikçiler' },
          ]}
        />
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Cari Ekle
        </button>
      </PageHead>
      <Tip id="contacts">
        Gelir/gider kaydı veya çek eklerken cari seçerseniz, o carinin alacak/borç bakiyesi — tekrarlayan kayıtlar ve
        açılış bakiyesi dahil — otomatik hesaplanır. "Ekstre" ile hareket dökümünü görüp PDF/Excel alabilirsiniz.
      </Tip>
      <div className="stat-grid">
        <StatCard icon="↓" tone="net-pos" label="Bekleyen Tahsilat" value={fmt(totalRec)} valueClass="pos" sub="Vadesi geçmiş + 12 ay" />
        <StatCard icon="!" tone="net-neg" label="Vadesi Geçmiş Alacak" value={fmt(totalOverdue)} valueClass={totalOverdue ? 'neg' : ''} />
        <StatCard icon="↑" tone="net-neg" label="Bekleyen Ödeme" value={fmt(totalPay)} valueClass="neg" sub="Vadesi geçmiş + 12 ay" />
      </div>
      <div className="card">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          searchText={(c) => `${c.name} ${c.phone} ${c.email} ${c.taxNo} ${c.note}`}
          searchPlaceholder="Ünvan, telefon, e-posta, VKN ara"
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyText='Kayıtlı cari yok. Müşteri ve tedarikçilerinizi "Cari Ekle" ile tanıtın.'
        />
      </div>
      {editing && <ContactForm contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {ledgerOf && <LedgerModal contact={ledgerOf} onClose={() => setLedgerOf(null)} />}
    </div>
  )
}

function ContactForm({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const { apply, state } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(contact?.companyId)
  const [name, setName] = useState(contact?.name ?? '')
  const [type, setType] = useState<ContactType>(contact?.type ?? 'customer')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [taxNo, setTaxNo] = useState(contact?.taxNo ?? '')
  const [note, setNote] = useState(contact?.note ?? '')
  const [opening, setOpening] = useState<Minor | null>(contact?.openingBalance ?? 0)
  const [submitted, setSubmitted] = useState(false)
  const dirty = useDirty({ name, type, phone, email, taxNo, note, opening })
  const errors = {
    name: !name.trim() ? 'Ünvan gerekli.' : null,
    phone: !isValidPhone(phone) ? 'Telefon numarası geçersiz (ör. 0212 555 10 20).' : null,
    email: !isValidEmail(email.trim()) ? 'E-posta adresi geçersiz.' : null,
    taxNo: !isValidTaxNo(taxNo) ? 'VKN 10, TCKN 11 haneli olmalı.' : null,
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.values(errors).some(Boolean) || (askCompany && !company)) return
    apply(
      (s) =>
        saveContact(
          s,
          { id: contact?.id, companyId: company || undefined, name: name.trim(), type, phone: phone.trim(), email: email.trim(), taxNo: taxNo.trim(), note, openingBalance: opening ?? 0 },
          company || state.companies[0]!.id,
        ),
      contact ? `"${name}" güncellendi` : undefined,
    )
    onClose()
  }
  const show = (k: keyof typeof errors) => (submitted || k !== 'name' ? errors[k] : null)
  return (
    <Modal title={contact ? 'Cariyi Düzenle' : 'Yeni Cari'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <Field label="Ünvan / Ad" error={show('name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Yılmaz Konut Geliştirme" autoFocus required />
        </Field>
        <Segmented
          full
          label="Cari türü"
          value={type}
          onChange={setType}
          options={[
            { value: 'customer', label: 'Müşteri' },
            { value: 'supplier', label: 'Tedarikçi' },
            { value: 'both', label: 'Her İkisi' },
          ]}
        />
        <div className="form-row">
          <Field label="Telefon" error={show('phone')}>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0212 555 10 20" />
          </Field>
          <Field label="E-posta" error={show('email')}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="muhasebe@firma.com.tr" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="VKN / TCKN" error={show('taxNo')}>
            <input inputMode="numeric" value={taxNo} onChange={(e) => setTaxNo(e.target.value)} placeholder="10 veya 11 hane" />
          </Field>
          <AmountInput
            label="Açılış bakiyesi"
            value={opening}
            onChange={setOpening}
            allowNegative
            allowZero
            hint="+ bizim alacağımız, − bizim borcumuz"
          />
        </div>
        <Field label="Not">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. 45 gün vade" />
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

function LedgerModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { state, today } = useStore()
  const { entries, balance } = useMemo(() => contactLedger(state, contact, today), [state, contact, today])
  let running = 0
  const rows = entries.map((e) => {
    if (e.status === 'opening' || e.status === 'overdue' || e.status === 'pending' || e.status === 'bounced') running += e.amount
    return { ...e, running }
  })
  const exportExcel = () =>
    saveTableAsExcel(`cari-ekstre-${safeFileName(contact.name)}-${fileStamp()}.xlsx`, 'Ekstre', [
      ['Tarih', 'Açıklama', 'Tür', 'Tutar (TL)', 'Durum', 'Açık Bakiye (TL)'],
      ...rows.map((r) => [r.date ? fmtDateNumeric(r.date) : '', r.title, r.kind, toMajor(r.amount), LEDGER_STATUS_LABEL[r.status], toMajor(r.running)]),
    ])
  return (
    <Modal title={`Cari Ekstresi — ${contact.name}`} onClose={onClose} wide>
      <div className="ledger print-target">
        <div className="print-only print-title">
          <h2>{contact.name} — Cari Ekstresi</h2>
          <p>{fmtDate(today)} itibarıyla · Finans Takip</p>
        </div>
        <div className="stat-grid compact">
          <StatCard icon="!" tone="net-neg" label="Vadesi geçmiş alacak" value={fmt(balance.overdueReceivable)} />
          <StatCard icon="↓" tone="net-pos" label="Vadesi gelmemiş alacak" value={fmt(balance.upcomingReceivable)} />
          <StatCard icon="↑" tone="net-neg" label="Bekleyen borcumuz" value={fmt(balance.overduePayable + balance.upcomingPayable)} />
          <StatCard icon="=" tone={balance.net >= 0 ? 'net-pos' : 'net-neg'} label="Net bakiye" value={fmt(balance.net)} valueClass={balance.net >= 0 ? 'pos' : 'neg'} />
        </div>
        {rows.length === 0 ? (
          <div className="empty-line">Bu cariye bağlı hareket yok.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Açıklama</th>
                  <th>Tür</th>
                  <th className="right">Tutar</th>
                  <th>Durum</th>
                  <th className="right">Açık Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.status === 'overdue' || r.status === 'bounced' ? 'overdue' : r.status === 'settled' || r.status === 'endorsed' ? 'paid' : ''}>
                    <td>{r.date ? fmtDate(r.date) : '—'}</td>
                    <td>
                      {r.title}
                      {r.original && <span className="muted small-note">{r.original}</span>}
                    </td>
                    <td className="muted">{r.kind}</td>
                    <td className={`right ${r.amount >= 0 ? 'pos' : 'neg'}`}>{fmt(r.amount)}</td>
                    <td>{LEDGER_STATUS_LABEL[r.status]}</td>
                    <td className="right">{fmt(r.running)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="form-actions no-print">
        <button type="button" className="btn" onClick={() => void exportExcel()}>
          <DownloadIcon size={15} /> Excel
        </button>
        <button type="button" className="btn" onClick={() => void saveAsPdf(`cari-ekstre-${safeFileName(contact.name)}-${fileStamp()}.pdf`, 'modal')}>
          <PrintIcon size={15} /> PDF / Yazdır
        </button>
        <button type="button" className="btn primary" onClick={onClose}>
          Kapat
        </button>
      </div>
    </Modal>
  )
}

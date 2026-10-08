import { useMemo, useState } from 'react'
import type { Account, AccountKind, Currency, ID, Minor } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { deleteAccount, deleteAccountTx, saveAccount, transfer } from '../store/actions'
import { accountTotals, depositMaturityValue, overdraftMonthlyInterest } from '../domain/analytics'
import { convert, fmt, toTRY } from '../domain/money'
import { fmtDate } from '../domain/dates'
import { DataTable, type Column } from '../ui/DataTable'
import { Modal } from '../ui/Modal'
import { PageHead, StatCard, Tip } from '../ui/Common'
import { AccountSelect, AmountInput, CompanyField, CurrencySelect, Field, amountOk, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { EditIcon, PlusIcon, TransferIcon, TrashIcon, UploadIcon, WalletIcon } from '../ui/Icons'
import { BankImportDialog } from './BankImport'

export const KIND_LABEL: Record<AccountKind, string> = {
  bank: 'Vadesiz hesap',
  cash: 'Kasa / nakit',
  deposit: 'Vadeli mevduat',
  overdraft: 'KMH (kredili mevduat)',
}

export function Accounts({ onEditAccount }: { onEditAccount: (a: Account | 'new') => void }) {
  const { scoped, state, today, apply } = useStore()
  const { confirm } = useDialogs()
  const [transferOpen, setTransferOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [txOf, setTxOf] = useState<Account | null>(null)
  const rates = scoped.settings.rates
  const totals = accountTotals(scoped)
  const showCompany = state.activeCompanyId === 'all' && state.companies.length > 1
  const missingRates = [...new Set(scoped.accounts.filter((a) => a.currency !== 'TRY' && !rates[a.currency]).map((a) => a.currency))]

  const remove = async (a: Account) => {
    if (await confirm({ title: 'Hesap silinsin mi?', message: `"${a.name}" ve hareket geçmişi silinecek. Bu hesaptan yapılmış ödemeler "ödendi" olarak kalır.`, confirmLabel: 'Sil', danger: true }))
      apply((s) => deleteAccount(s, a.id), `"${a.name}" silindi`)
  }

  const columns: Column<Account>[] = [
    {
      key: 'name',
      header: 'Hesap',
      sort: (a) => a.name,
      render: (a) => (
        <>
          <strong>{a.name}</strong>
          <span className="muted small-note">
            {KIND_LABEL[a.kind]}
            {showCompany ? ` · ${state.companies.find((c) => c.id === a.companyId)?.name}` : ''}
          </span>
        </>
      ),
    },
    {
      key: 'detail',
      header: 'Ayrıntı',
      render: (a) => {
        if (a.kind === 'overdraft') {
          const interest = overdraftMonthlyInterest(a)
          return (
            <span className="muted">
              Limit {fmt(a.overdraftLimit ?? 0, a.currency)} · kullanılabilir {fmt((a.overdraftLimit ?? 0) + a.balance, a.currency)}
              {interest > 0 && <span className="small-note neg">Aylık faiz ≈ {fmt(interest, a.currency)}</span>}
            </span>
          )
        }
        if (a.kind === 'deposit') {
          const v = depositMaturityValue(a, today)
          return (
            <span className="muted">
              {a.maturityDate ? `Vade ${fmtDate(a.maturityDate)}` : 'Vade girilmedi'}
              {a.interestRate ? ` · %${a.interestRate}` : ''}
              {v !== undefined && <span className="small-note pos">Vade sonu ≈ {fmt(v, a.currency)} (brüt)</span>}
            </span>
          )
        }
        return <span className="muted">—</span>
      },
    },
    {
      key: 'balance',
      header: 'Bakiye',
      align: 'right',
      sort: (a) => toTRY(a.balance, a.currency, rates),
      render: (a) => (
        <>
          <strong className={a.balance < 0 ? 'neg' : ''}>{fmt(a.balance, a.currency)}</strong>
          {a.currency !== 'TRY' && <span className="muted small-note">≈ {fmt(toTRY(a.balance, a.currency, rates))}</span>}
        </>
      ),
    },
    {
      key: 'act',
      header: '',
      render: (a) => (
        <div className="row-actions">
          <button type="button" className="btn small" onClick={() => setTxOf(a)}>
            Hareketler
          </button>
          <button type="button" className="icon-btn" aria-label={`${a.name} düzenle`} title="Düzenle / bakiye güncelle" onClick={() => onEditAccount(a)}>
            <EditIcon size={15} />
          </button>
          <button type="button" className="icon-btn danger" aria-label={`${a.name} sil`} title="Sil" onClick={() => void remove(a)}>
            <TrashIcon size={15} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <PageHead title="Hesaplar">
        <button type="button" className="btn" onClick={() => setImportOpen(true)} disabled={scoped.accounts.length === 0}>
          <UploadIcon size={16} /> Ekstre İçe Aktar
        </button>
        <button type="button" className="btn" onClick={() => setTransferOpen(true)} disabled={scoped.accounts.length < 2 && state.accounts.length < 2}>
          <TransferIcon size={16} /> Virman
        </button>
        <button type="button" className="btn primary" onClick={() => onEditAccount('new')}>
          <PlusIcon size={16} /> Hesap Ekle
        </button>
      </PageHead>
      <Tip id="accounts-page">
        Vadesiz hesap, kasa, KMH ve vadeli mevduatlarınızı burada yönetin. Dövizli ve altın hesaplar Ayarlar'daki kurlarla
        TL'ye çevrilir. Hesaplar arası para aktarımı için "Virman", bankadan indirdiğiniz hareket dökümü için "Ekstre İçe
        Aktar" kullanın.
      </Tip>
      {missingRates.length > 0 && (
        <div className="card warn-card" role="alert">
          {missingRates.join(', ')} için kur tanımlı değil; bu hesaplar toplamlara 0 TL olarak giriyor. Ayarlar → Döviz Kurları'ndan girin.
        </div>
      )}
      <div className="stat-grid">
        <StatCard icon={<WalletIcon size={20} />} tone="wallet" label="Harcanabilir" value={fmt(totals.liquid)} valueClass={totals.liquid < 0 ? 'neg' : ''} sub="Vadesiz + kasa + KMH" />
        <StatCard icon="%" tone="net-pos" label="Vadeli mevduat" value={fmt(totals.deposits)} />
        <StatCard icon="Σ" tone="wallet" label="Toplam varlık" value={fmt(totals.total)} />
        <StatCard icon="+" tone="loan" label="Kullanılabilir KMH limiti" value={fmt(totals.overdraftAvailable)} />
      </div>
      <div className="card">
        <DataTable
          rows={scoped.accounts}
          columns={columns}
          rowKey={(a) => a.id}
          searchText={(a) => `${a.name} ${KIND_LABEL[a.kind]} ${a.currency}`}
          searchPlaceholder="Hesap ara"
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyText="Henüz hesap yok."
        />
      </div>
      {transferOpen && <TransferDialog onClose={() => setTransferOpen(false)} />}
      {importOpen && <BankImportDialog onClose={() => setImportOpen(false)} />}
      {txOf && <AccountTxModal account={txOf} onClose={() => setTxOf(null)} />}
    </div>
  )
}

export function AccountForm({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { apply, state } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(account?.companyId)
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank')
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? 'TRY')
  const [balance, setBalance] = useState<Minor | null>(account?.balance ?? null)
  const [limit, setLimit] = useState<Minor | null>(account?.overdraftLimit ?? null)
  const [rate, setRate] = useState(account?.interestRate !== undefined ? String(account.interestRate).replace('.', ',') : '')
  const [maturity, setMaturity] = useState(account?.maturityDate ?? '')
  const [submitted, setSubmitted] = useState(false)
  const dirty = useDirty({ name, kind, currency, balance, limit, rate, maturity })
  const rateNum = rate.trim() === '' ? undefined : Number(rate.replace(',', '.'))
  const rateOk = rateNum === undefined || (Number.isFinite(rateNum) && rateNum >= 0)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !amountOk(balance, { allowNegative: true, allowZero: true }) || !rateOk || (askCompany && !company)) return
    apply(
      (s) =>
        saveAccount(
          s,
          {
            id: account?.id,
            companyId: company || undefined,
            name: name.trim(),
            kind,
            currency,
            balance: balance ?? 0,
            overdraftLimit: kind === 'overdraft' ? (limit ?? 0) : undefined,
            interestRate: kind === 'deposit' || kind === 'overdraft' ? rateNum : undefined,
            maturityDate: kind === 'deposit' && maturity ? maturity : undefined,
          },
          company || state.companies[0]!.id,
        ),
      account ? `"${name}" güncellendi` : undefined,
    )
    onClose()
  }
  return (
    <Modal title={account ? 'Hesabı Düzenle' : 'Yeni Hesap'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <Field label="Hesap adı" error={submitted && !name.trim() ? 'Hesap adı gerekli.' : null}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Ziraat Vadesiz, Kasa" autoFocus />
        </Field>
        <div className="form-row">
          <Field label="Tür">
            <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <AmountInput
          label="Güncel bakiye"
          value={balance}
          onChange={setBalance}
          currency={currency}
          allowNegative
          allowZero
          hint={account ? 'Değiştirirseniz fark "bakiye düzeltmesi" hareketi olarak kaydedilir.' : kind === 'overdraft' ? 'KMH kullanıyorsanız eksi bakiye girin (ör. -25.000)' : undefined}
        />
        {kind === 'overdraft' && <AmountInput label="KMH limiti" value={limit} onChange={setLimit} currency={currency} allowZero />}
        {(kind === 'deposit' || kind === 'overdraft') && (
          <div className="form-row">
            <Field label="Yıllık faiz (%)" error={!rateOk ? 'Geçerli bir oran girin.' : null}>
              <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="ör. 45" />
            </Field>
            {kind === 'deposit' && (
              <Field label="Vade tarihi">
                <input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
              </Field>
            )}
          </div>
        )}
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

function TransferDialog({ onClose }: { onClose: () => void }) {
  const { state, scoped, today, apply } = useStore()
  const list = scoped.accounts.length >= 2 ? scoped.accounts : state.accounts
  const [fromId, setFromId] = useState<ID>(list[0]?.id ?? '')
  const [toId, setToId] = useState<ID>(list[1]?.id ?? '')
  const [amountFrom, setAmountFrom] = useState<Minor | null>(null)
  const [amountTo, setAmountTo] = useState<Minor | null>(null)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const from = state.accounts.find((a) => a.id === fromId)
  const to = state.accounts.find((a) => a.id === toId)
  const cross = from && to && from.currency !== to.currency
  const suggested = from && to && amountFrom ? convert(amountFrom, from.currency, to.currency, state.settings.rates) : null
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!from || !to || !amountFrom || amountFrom <= 0) return
    const target = cross ? (amountTo ?? suggested ?? 0) : amountFrom
    if (cross && target <= 0) return setError('Karşı hesaba geçen tutarı girin.')
    try {
      apply((s) => transfer(s, { fromId, toId, amountFrom, amountTo: target, date, note: note.trim() }), 'Virman yapıldı')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <Modal title="Virman (Hesaplar Arası Aktarım)" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <AccountSelect label="Gönderen hesap" value={fromId} onChange={setFromId} />
          <AccountSelect label="Alan hesap" value={toId} onChange={setToId} />
        </div>
        <div className="form-row">
          <AmountInput label={`Tutar${from ? ` (${from.currency})` : ''}`} value={amountFrom} onChange={setAmountFrom} currency={from?.currency} required autoFocus />
          {cross && (
            <AmountInput
              label={`Karşı hesaba geçen (${to!.currency})`}
              value={amountTo ?? suggested}
              onChange={setAmountTo}
              currency={to!.currency}
              required
              hint="Bankanın uyguladığı kurla değişebilir"
            />
          )}
        </div>
        <div className="form-row">
          <Field label="Tarih">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Açıklama (opsiyonel)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Kasaya nakit çekim" />
          </Field>
        </div>
        {fromId === toId && <p className="field-error">Gönderen ve alan hesap farklı olmalı.</p>}
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn primary" disabled={fromId === toId}>
            Aktar
          </button>
        </div>
      </form>
    </Modal>
  )
}

const TX_LABEL = { adjust: 'Bakiye düzeltmesi', expense: 'Harcama', income: 'Gelir', transfer: 'Virman', settlement: 'Ödeme / tahsilat', import: 'Ekstreden' } as const

function AccountTxModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { state, apply } = useStore()
  const { confirm } = useDialogs()
  const acc = state.accounts.find((a) => a.id === account.id) ?? account
  const txs = useMemo(() => state.accountTx.filter((t) => t.accountId === account.id), [state.accountTx, account.id])
  return (
    <Modal title={`Hesap Hareketleri — ${acc.name}`} onClose={onClose} wide>
      <p className="muted form-note">
        Güncel bakiye <strong>{fmt(acc.balance, acc.currency)}</strong>. Bir hareketi silmek bakiyeyi geri alır; ödeme hareketini
        silmek ilgili "ödendi" işaretini de kaldırır.
      </p>
      <DataTable
        rows={txs}
        rowKey={(t) => t.id}
        searchText={(t) => `${t.note} ${TX_LABEL[t.kind]}`}
        searchPlaceholder="Hareket ara"
        defaultSort={{ key: 'date', dir: 'desc' }}
        emptyText="Bu hesapta henüz kayıtlı hareket yok. Ödendi işaretlerken bu hesabı seçtiğinizde hareketler burada görünür."
        columns={[
          { key: 'date', header: 'Tarih', sort: (t) => t.date, render: (t) => fmtDate(t.date) },
          { key: 'kind', header: 'Tür', sort: (t) => t.kind, render: (t) => <span className="muted">{TX_LABEL[t.kind]}</span> },
          { key: 'note', header: 'Açıklama', render: (t) => t.note },
          { key: 'amount', header: 'Tutar', align: 'right', sort: (t) => t.amount, render: (t) => <span className={t.amount >= 0 ? 'pos' : 'neg'}>{fmt(t.amount, acc.currency)}</span> },
          {
            key: 'act',
            header: '',
            render: (t) => (
              <button
                type="button"
                className="icon-btn danger"
                title="Hareketi sil (bakiyeyi geri al)"
                aria-label="Hareketi sil"
                onClick={async () => {
                  if (await confirm({ title: 'Hareket silinsin mi?', message: `${t.note} — ${fmt(t.amount, acc.currency)}. Bakiye geri alınacak.`, confirmLabel: 'Sil', danger: true }))
                    apply((s) => deleteAccountTx(s, t.id), 'Hareket silindi')
                }}
              >
                <TrashIcon size={14} />
              </button>
            ),
          },
        ]}
      />
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Kapat
        </button>
      </div>
    </Modal>
  )
}

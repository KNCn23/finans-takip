import { useMemo, useState } from 'react'
import type { Currency, ID, Loan, Minor } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { closeLoanEarly, deleteLoan, reopenLoan, saveLoan, setInstallmentOverride } from '../store/actions'
import { annuityPayment, loanSchedule, loanSummary, type Installment } from '../domain/loans'
import { fmtDate, nextBusinessDay } from '../domain/dates'
import { fmt } from '../domain/money'
import { generateOccurrences } from '../domain/occurrences'
import { Modal } from '../ui/Modal'
import { PageHead, Progress, Tip } from '../ui/Common'
import { AccountSelect, AmountInput, CompanyField, CurrencySelect, Field, amountOk, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { useSettle } from '../ui/Occurrences'
import { EditIcon, PlusIcon, TrashIcon } from '../ui/Icons'

export function Loans() {
  const { scoped, apply } = useStore()
  const { confirm } = useDialogs()
  const [editing, setEditing] = useState<Loan | 'new' | null>(null)
  const [open, setOpen] = useState<ID | null>(null)
  const [closing, setClosing] = useState<Loan | null>(null)

  const remove = async (l: Loan) => {
    if (await confirm({ title: 'Kredi silinsin mi?', message: `"${l.name}" ve ödeme kayıtları silinecek. Hesap hareketleri korunur.`, confirmLabel: 'Sil', danger: true }))
      apply((s) => deleteLoan(s, l.id), `"${l.name}" silindi`)
  }

  return (
    <div className="page">
      <PageHead title="Krediler">
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Kredi Ekle
        </button>
      </PageHead>
      <Tip id="loans">
        Aylık taksit, taksit sayısı ve ilk taksit tarihini girin — ödeme planı kendiliğinden oluşur. Çekilen anaparayı da
        girerseniz her taksitin faiz/anapara ayrımı ve erken kapama tutarı hesaplanır. Değişken faizli kredilerde farklı
        gelen taksiti tablodaki kalem simgesiyle düzeltin.
      </Tip>
      {scoped.loans.length === 0 ? (
        <div className="card empty-line">Henüz kredi eklenmemiş. Bankadan kullandığınız krediyi "Kredi Ekle" ile tanıtın.</div>
      ) : (
        scoped.loans.map((l) => (
          <LoanCard
            key={l.id}
            loan={l}
            open={open === l.id}
            onToggle={() => setOpen(open === l.id ? null : l.id)}
            onEdit={() => setEditing(l)}
            onDelete={() => void remove(l)}
            onClose={() => setClosing(l)}
            onReopen={async () => {
              if (await confirm({ title: 'Erken kapama geri alınsın mı?', message: 'Kapama ödemesi silinir (hesaptan düşüldüyse geri eklenir) ve kalan taksitler takvime geri döner.' }))
                apply((s) => reopenLoan(s, l.id), 'Erken kapama geri alındı')
            }}
          />
        ))
      )}
      {editing && <LoanForm loan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {closing && <EarlyCloseDialog loan={closing} onClose={() => setClosing(null)} />}
    </div>
  )
}

function LoanCard({
  loan,
  open,
  onToggle,
  onEdit,
  onDelete,
  onClose,
  onReopen,
}: {
  loan: Loan
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
  onReopen: () => void
}) {
  const { state, today } = useStore()
  const { toggle } = useSettle()
  const [overrideOf, setOverrideOf] = useState<Installment | null>(null)
  const schedule = useMemo(() => loanSchedule(loan, state.settlements), [loan, state.settlements])
  const sum = loanSummary(loan, schedule)
  const occByKey = useMemo(() => {
    const occ = generateOccurrences({ ...state, loans: [loan], cards: [], cheques: [], payments: [] }, '1900-01-01', '2999-12-31')
    return new Map(occ.map((o) => [o.key, o]))
  }, [state, loan])
  const hasSplit = schedule.some((i) => i.interest !== undefined)
  const pct = (sum.paidCount / loan.installmentCount) * 100
  const shift = state.settings.shiftToBusinessDay

  return (
    <div className="card loan-card">
      <div className="loan-head">
        <button type="button" className="loan-title" onClick={onToggle} aria-expanded={open}>
          <h3>
            {loan.name}
            {sum.closed && loan.earlyClosure && <span className="badge success">Erken kapatıldı</span>}
          </h3>
          <span className="muted">
            {loan.bank} · {open ? 'planı gizle ▲' : 'ödeme planını göster ▼'}
          </span>
        </button>
        <div className="loan-meta">
          <div>
            <span className="stat-label">Taksit</span>
            <strong>{fmt(loan.installmentAmount, loan.currency)}/ay</strong>
          </div>
          <div>
            <span className="stat-label" title="Faiz dahil, ödenmemiş taksitlerin toplamı">
              Kalan taksitler
            </span>
            <strong>{fmt(sum.remainingInstallmentsTotal, loan.currency)}</strong>
          </div>
          {sum.remainingPrincipal !== undefined && (
            <div>
              <span className="stat-label" title="Bugün kapatılsa yaklaşık ödenecek anapara">
                Kalan anapara
              </span>
              <strong>{fmt(sum.remainingPrincipal, loan.currency)}</strong>
            </div>
          )}
          <div>
            <span className="stat-label">Ödenen</span>
            <strong>
              {sum.paidCount}/{loan.installmentCount}
            </strong>
          </div>
          {sum.effectiveAnnualRate !== undefined && (
            <div>
              <span className="stat-label">Yıllık faiz</span>
              <strong>%{sum.effectiveAnnualRate.toFixed(2)}</strong>
            </div>
          )}
        </div>
        <div className="row-actions">
          {loan.earlyClosure ? (
            <button type="button" className="btn small" onClick={onReopen}>
              Kapamayı geri al
            </button>
          ) : (
            !sum.closed && (
              <button type="button" className="btn small" onClick={onClose}>
                Erken Kapat
              </button>
            )
          )}
          <button type="button" className="icon-btn" onClick={onEdit} aria-label={`${loan.name} düzenle`} title="Düzenle">
            <EditIcon size={16} />
          </button>
          <button type="button" className="icon-btn danger" onClick={onDelete} aria-label={`${loan.name} sil`} title="Sil">
            <TrashIcon size={16} />
          </button>
        </div>
      </div>
      <Progress pct={pct} />
      {sum.remainingInterest !== undefined && sum.remainingInterest > 0 && (
        <p className="muted small-note">Kalan faiz yükü ≈ {fmt(sum.remainingInterest, loan.currency)} (tahmini; KKDF/BSMV dahil oran girildiyse)</p>
      )}
      {open && (
        <div className="table-scroll">
          <table className="table installments">
            <thead>
              <tr>
                <th>#</th>
                <th>Vade</th>
                <th className="right">Tutar</th>
                {hasSplit && (
                  <>
                    <th className="right">Faiz</th>
                    <th className="right">Anapara</th>
                    <th className="right">Kalan anapara</th>
                  </>
                )}
                <th>Durum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedule.map((i) => {
                const occ = occByKey.get(`loan:${loan.id}:${i.n}`)
                const eff = shift ? nextBusinessDay(i.dueDate) : i.dueDate
                const overdue = !i.paid && !i.closed && eff < today
                return (
                  <tr key={i.n} className={i.paid || i.closed ? 'paid' : overdue ? 'overdue' : ''}>
                    <td>{i.n}</td>
                    <td>
                      {fmtDate(eff)}
                      {eff !== i.dueDate && <span className="muted small-note">iş gününe kaydı</span>}
                    </td>
                    <td className="right">
                      {fmt(i.amount, loan.currency)}
                      {loan.installmentOverrides[i.n] !== undefined && <span className="muted small-note">farklı tutar</span>}
                    </td>
                    {hasSplit && (
                      <>
                        <td className="right muted">{i.interest !== undefined ? fmt(i.interest, loan.currency) : ''}</td>
                        <td className="right muted">{i.principalPart !== undefined ? fmt(i.principalPart, loan.currency) : ''}</td>
                        <td className="right muted">{i.remainingPrincipal !== undefined ? fmt(i.remainingPrincipal, loan.currency) : ''}</td>
                      </>
                    )}
                    <td>
                      {i.closed ? (
                        <span className="muted">Kapatıldı</span>
                      ) : (
                        <label className="check-label">
                          <input type="checkbox" checked={i.paid} onChange={() => occ && toggle(occ)} aria-label={`${i.n}. taksit ödendi`} />
                          {i.paid ? 'Ödendi' : overdue ? 'Gecikmiş' : 'Bekliyor'}
                        </label>
                      )}
                    </td>
                    <td>
                      {!i.paid && !i.closed && (
                        <button type="button" className="icon-btn" title="Bu taksitin tutarını değiştir" aria-label={`${i.n}. taksit tutarını değiştir`} onClick={() => setOverrideOf(i)}>
                          <EditIcon size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {overrideOf && <InstallmentDialog loan={loan} inst={overrideOf} onClose={() => setOverrideOf(null)} />}
    </div>
  )
}

function InstallmentDialog({ loan, inst, onClose }: { loan: Loan; inst: Installment; onClose: () => void }) {
  const { apply } = useStore()
  const [amount, setAmount] = useState<Minor | null>(inst.amount)
  const [applyRest, setApplyRest] = useState(false)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (amount === null || amount <= 0) return
    apply((s) => {
      let next = s
      const last = applyRest ? loan.installmentCount : inst.n
      for (let n = inst.n; n <= last; n++) next = setInstallmentOverride(next, loan.id, n, amount === loan.installmentAmount ? undefined : amount)
      return next
    }, `${inst.n}. taksit tutarı güncellendi`)
    onClose()
  }
  return (
    <Modal title={`${inst.n}. Taksit Tutarı`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <AmountInput label="Taksit tutarı" value={amount} onChange={setAmount} currency={loan.currency} required autoFocus hint={`Sözleşmedeki tutar: ${fmt(loan.installmentAmount, loan.currency)}`} />
        <label className="check-inline">
          <input type="checkbox" checked={applyRest} onChange={(e) => setApplyRest(e.target.checked)} />
          Sonraki bütün taksitlere de uygula (faiz değişti)
        </label>
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

function EarlyCloseDialog({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { state, today, apply } = useStore()
  const sum = loanSummary(loan, loanSchedule(loan, state.settlements))
  const [amount, setAmount] = useState<Minor | null>(sum.remainingPrincipal ?? sum.remainingInstallmentsTotal)
  const [date, setDate] = useState(today)
  const [accountId, setAccountId] = useState<ID>(state.accounts.find((a) => a.companyId === loan.companyId && a.kind !== 'deposit')?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (amount === null || amount <= 0) return
    try {
      apply((s) => closeLoanEarly(s, loan.id, { date, amount, accountId: accountId || undefined }), `"${loan.name}" erken kapatıldı`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <Modal title="Krediyi Erken Kapat" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="settle-summary">
          <strong>{loan.name}</strong>
          <span className="muted">
            Ödenen {sum.paidCount}/{loan.installmentCount} · kalan taksitler {fmt(sum.remainingInstallmentsTotal, loan.currency)}
          </span>
        </div>
        <AmountInput
          label="Kapama tutarı (bankanın bildirdiği)"
          value={amount}
          onChange={setAmount}
          currency={loan.currency}
          required
          autoFocus
          hint={sum.remainingPrincipal !== undefined ? `Tahmini kalan anapara: ${fmt(sum.remainingPrincipal, loan.currency)} (erken ödeme ücreti hariç)` : 'Anapara girilmediği için tahmin yapılamadı.'}
        />
        <Field label="Kapama tarihi">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <AccountSelect label="Hangi hesaptan ödendi?" value={accountId} onChange={setAccountId} companyId={loan.companyId} allowNone />
        <p className="muted form-note">Ödenmemiş son taksitten sonraki bütün taksitler takvimden kalkar. İşlem geri alınabilir.</p>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn primary">
            Erken Kapat
          </button>
        </div>
      </form>
    </Modal>
  )
}

function LoanForm({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const { apply, state, today } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(loan?.companyId)
  const [name, setName] = useState(loan?.name ?? '')
  const [bank, setBank] = useState(loan?.bank ?? '')
  const [currency, setCurrency] = useState<Currency>(loan?.currency ?? 'TRY')
  const [amount, setAmount] = useState<Minor | null>(loan?.installmentAmount ?? null)
  const [count, setCount] = useState(loan ? String(loan.installmentCount) : '')
  const [first, setFirst] = useState(loan?.firstDueDate ?? today)
  const [principal, setPrincipal] = useState<Minor | null>(loan?.principal ?? null)
  const [rate, setRate] = useState(loan?.annualRate !== undefined ? String(loan.annualRate).replace('.', ',') : '')
  const [submitted, setSubmitted] = useState(false)
  const dirty = useDirty({ name, bank, currency, amount, count, first, principal, rate })
  const n = Number(count)
  const countOk = Number.isInteger(n) && n >= 1 && n <= 600
  const rateNum = rate.trim() === '' ? undefined : Number(rate.replace(',', '.'))
  const rateOk = rateNum === undefined || (Number.isFinite(rateNum) && rateNum >= 0 && rateNum < 1000)
  const canCompute = principal !== null && principal > 0 && rateNum !== undefined && rateOk && countOk

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !amountOk(amount, { required: true }) || amount === null || !countOk || !rateOk || (askCompany && !company)) return
    apply(
      (s) =>
        saveLoan(
          s,
          {
            ...(loan ?? { installmentOverrides: {} }),
            id: loan?.id,
            companyId: company || undefined,
            name: name.trim(),
            bank: bank.trim(),
            currency,
            installmentAmount: amount,
            installmentCount: n,
            firstDueDate: first,
            principal: principal ?? undefined,
            annualRate: rateNum,
            installmentOverrides: loan?.installmentOverrides ?? {},
          },
          company || state.companies[0]!.id,
        ),
      loan ? `"${name}" güncellendi` : undefined,
    )
    onClose()
  }

  return (
    <Modal title={loan ? 'Krediyi Düzenle' : 'Yeni Kredi'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <div className="form-row">
          <Field label="Kredi Adı" error={submitted && !name.trim() ? 'Kredi adı gerekli.' : null}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="İhtiyaç Kredisi" autoFocus />
          </Field>
          <Field label="Banka">
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Ziraat Bankası" />
          </Field>
        </div>
        <div className="form-row">
          <AmountInput label="Aylık taksit" value={amount} onChange={setAmount} currency={currency} required />
          <Field label="Taksit sayısı" error={count && !countOk ? '1–600 arası tam sayı girin.' : submitted && !count ? 'Gerekli.' : null}>
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" placeholder="24" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="İlk taksit tarihi">
            <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} required />
          </Field>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <fieldset className="fieldset">
          <legend>Faiz bilgisi (opsiyonel)</legend>
          <div className="form-row">
            <AmountInput label="Çekilen anapara" value={principal} onChange={setPrincipal} currency={currency} />
            <Field label="Yıllık faiz (%)" error={!rateOk ? 'Geçerli bir oran girin (ör. 42,5).' : null} hint="KKDF/BSMV dahil efektif oran">
              <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="ör. 42,5" />
            </Field>
          </div>
          {canCompute && (
            <button type="button" className="link-btn" onClick={() => setAmount(annuityPayment(principal!, rateNum!, n))}>
              Taksiti anapara ve faizden hesapla → {fmt(annuityPayment(principal!, rateNum!, n), currency)}
            </button>
          )}
        </fieldset>
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

import { useMemo, useState } from 'react'
import type { Card, CardExpense, Minor } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { deleteCard, deleteCardExpense, saveCard, saveCardExpense, setStatementOverride } from '../store/actions'
import { cardKey, cardStatements, cardSummary, periodForDate, statementRange, type Statement } from '../domain/cards'
import { addMonthKey, fmtDate, fmtDayShort, fmtMonth, monthKey } from '../domain/dates'
import { fmt } from '../domain/money'
import { generateOccurrences } from '../domain/occurrences'
import { Modal } from '../ui/Modal'
import { PageHead, Progress, Tip } from '../ui/Common'
import { AmountInput, CategorySelect, CompanyField, Field, amountOk, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { useSettle } from '../ui/Occurrences'
import { EditIcon, PlusIcon, TrashIcon } from '../ui/Icons'

export const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 18, 24, 36]

export function Cards() {
  const { scoped, apply } = useStore()
  const { confirm } = useDialogs()
  const [editing, setEditing] = useState<Card | 'new' | null>(null)
  const [expenseFor, setExpenseFor] = useState<{ card: Card; expense?: CardExpense } | null>(null)

  const remove = async (c: Card) => {
    if (await confirm({ title: 'Kart silinsin mi?', message: `"${c.name}" kartı, bütün harcamaları ve ekstre ödeme kayıtları silinecek.`, confirmLabel: 'Sil', danger: true }))
      apply((s) => deleteCard(s, c.id), `"${c.name}" silindi`)
  }

  return (
    <div className="page">
      <PageHead title="Kredi Kartları">
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Kart Ekle
        </button>
      </PageHead>
      <Tip id="cards">
        Harcamaları kart sayfasından veya soldaki "Harcama Ekle" ile girin; kesim gününe göre doğru ekstreye, taksitliyse
        sonraki aylara bölünerek yerleşir. Bankadan gelen ekstre farklıysa "Gerçek tutarı gir" ile düzeltin. Ekstreyi
        ödediğinizde işaretleyin — borç düşer, sonraki ayda tekrar etmez.
      </Tip>
      {scoped.cards.length === 0 ? (
        <div className="card empty-line">Henüz kart eklenmemiş. Kredi kartlarınızı "Kart Ekle" ile tanıtın.</div>
      ) : (
        <div className="cards-grid">
          {scoped.cards.map((c) => (
            <CardTile key={c.id} card={c} onEdit={() => setEditing(c)} onDelete={() => void remove(c)} onExpense={(e) => setExpenseFor({ card: c, expense: e })} />
          ))}
        </div>
      )}
      {editing && <CardForm card={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {expenseFor && <CardExpenseForm card={expenseFor.card} expense={expenseFor.expense} onClose={() => setExpenseFor(null)} />}
    </div>
  )
}

function CardTile({ card, onEdit, onDelete, onExpense }: { card: Card; onEdit: () => void; onDelete: () => void; onExpense: (e?: CardExpense) => void }) {
  const { state, today, apply } = useStore()
  const { confirm } = useDialogs()
  const { toggle } = useSettle()
  const [showAll, setShowAll] = useState(false)
  const [overrideOf, setOverrideOf] = useState<Statement | null>(null)
  const statements = useMemo(() => cardStatements(card, state.cardExpenses, state.settlements), [card, state.cardExpenses, state.settlements])
  const sum = cardSummary(card, statements, today)
  const occ = useMemo(() => {
    const list = generateOccurrences({ ...state, loans: [], payments: [], cheques: [], cards: [card] }, '1900-01-01', '2999-12-31')
    return new Map(list.map((o) => [o.key, o]))
  }, [state, card])
  const usage = card.limit > 0 ? (sum.totalUnpaid / card.limit) * 100 : 0
  const openRange = statementRange(card, sum.openPeriod)
  const expenses = state.cardExpenses.filter((e) => e.cardId === card.id).sort((a, b) => (a.date > b.date ? -1 : 1))
  const openExpenses = expenses.filter((e) => e.date >= openRange.from && e.date <= openRange.to)
  const visible = showAll ? expenses : openExpenses.slice(0, 5)
  const listed = statements.filter((s) => !s.paid || s.period >= addMonthKey(monthKey(today), -2))

  const removeExpense = async (e: CardExpense) => {
    if (await confirm({ title: 'Harcama silinsin mi?', message: `${e.title || e.category} — ${fmt(e.amount)}${e.installments > 1 ? ` (${e.installments} taksit)` : ''}`, confirmLabel: 'Sil', danger: true }))
      apply((s) => deleteCardExpense(s, e.id), 'Harcama silindi')
  }

  return (
    <div className="card credit-card">
      <div className="card-head">
        <div>
          <h3>{card.name}</h3>
          <span className="muted">
            {card.bank} · kesim her ayın {card.statementDay}'i, son ödeme {card.dueDay}'i
          </span>
        </div>
        <div className="row-actions">
          <button type="button" className="icon-btn" aria-label={`${card.name} düzenle`} title="Düzenle" onClick={onEdit}>
            <EditIcon size={16} />
          </button>
          <button type="button" className="icon-btn danger" aria-label={`${card.name} sil`} title="Sil" onClick={onDelete}>
            <TrashIcon size={16} />
          </button>
        </div>
      </div>

      <div className="cc-figures">
        <div>
          <span className="stat-label">Ödenmemiş ekstre</span>
          <strong className={sum.unpaidClosed.length ? 'neg big' : 'big'}>{fmt(sum.unpaidClosed.reduce((t, s) => t + s.amount, 0))}</strong>
        </div>
        <div>
          <span className="stat-label">Açık dönem ({fmtDayShort(openRange.to)} kesim)</span>
          <strong>{fmt(sum.openStatement?.amount ?? 0)}</strong>
        </div>
        <div>
          <span className="stat-label">Gelecek taksitler</span>
          <strong>{fmt(sum.futureInstallments)}</strong>
        </div>
      </div>
      <Progress pct={usage} tone={usage > 80 ? 'danger' : undefined} />
      <div className="cc-limit muted">
        Limit {fmt(card.limit)} · kullanılabilir {fmt(sum.available)} · %{usage.toFixed(0)}
      </div>

      <div className="cc-section">
        <div className="cc-section-head">
          <span className="stat-label">Ekstreler</span>
        </div>
        {listed.length === 0 ? (
          <div className="empty-line">Ekstre yok.</div>
        ) : (
          <ul className="statement-list">
            {listed.map((s) => {
              const o = occ.get(cardKey(card.id, s.period))
              const overdue = !s.paid && (o?.date ?? s.dueDate) < today
              const open = s.period === sum.openPeriod
              const future = s.period > sum.openPeriod
              return (
                <li key={s.period} className={`${s.paid ? 'paid' : ''}${overdue ? ' overdue' : ''}`}>
                  <label className="occ-check" title={s.paid ? 'Ödenmedi olarak işaretle' : 'Ödendi olarak işaretle'}>
                    <input type="checkbox" checked={s.paid} disabled={!o} onChange={() => o && toggle(o)} aria-label={`${fmtMonth(s.period)} ekstresi ödendi`} />
                  </label>
                  <div className="occ-text">
                    <span className="occ-title">
                      {fmtMonth(s.period)}
                      {open && <em className="tag">açık dönem</em>}
                      {future && <em className="tag">taksitler</em>}
                      {overdue && <em className="overdue-tag">gecikmiş</em>}
                    </span>
                    <span className="occ-sub">
                      Kesim {fmtDate(s.closeDate)} · son ödeme {fmtDate(o?.date ?? s.dueDate)}
                      {s.overridden ? ` · bankadan girilen (hesaplanan ${fmt(s.computed)})` : ''}
                    </span>
                  </div>
                  <strong className={s.paid ? '' : 'neg'}>{fmt(s.paid && s.settlement ? s.settlement.amount : s.amount)}</strong>
                  {!s.paid && (
                    <button type="button" className="icon-btn" title="Bankadan gelen gerçek ekstre tutarını gir" aria-label="Gerçek ekstre tutarını gir" onClick={() => setOverrideOf(s)}>
                      <EditIcon size={14} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="cc-section">
        <div className="cc-section-head">
          <span className="stat-label">{showAll ? 'Tüm harcamalar' : `Açık dönem harcamaları (${fmtDayShort(openRange.from)}'den beri)`}</span>
          <button type="button" className="btn small" onClick={() => onExpense()}>
            <PlusIcon size={14} /> Harcama Ekle
          </button>
        </div>
        {visible.length === 0 ? (
          <div className="empty-line">Bu dönem harcama girilmemiş.</div>
        ) : (
          <ul className="expense-list">
            {visible.map((e) => (
              <li key={e.id}>
                <span className="expense-cat">{e.category}</span>
                <span className="expense-title">
                  {e.title || '—'}
                  {e.installments > 1 && <span className="muted"> · {e.installments} taksit</span>}
                  {!e.countsToStatement && <span className="muted" title="Ekstre borcuna eklenmiyor (önceki sürümden aktarıldı veya elle kapatıldı)"> · ekstre dışı</span>}
                </span>
                <span className="expense-date muted">{fmtDayShort(e.date)}</span>
                <span className="expense-amount neg">−{fmt(e.amount)}</span>
                <button type="button" className="icon-btn" title="Düzenle" aria-label="Harcamayı düzenle" onClick={() => onExpense(e)}>
                  <EditIcon size={13} />
                </button>
                <button type="button" className="icon-btn danger" title="Harcamayı sil" aria-label="Harcamayı sil" onClick={() => void removeExpense(e)}>
                  <TrashIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {(expenses.length > visible.length || showAll) && (
          <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Daralt' : `Tüm harcamaları göster (${expenses.length})`}
          </button>
        )}
      </div>
      {overrideOf && <StatementOverrideDialog card={card} st={overrideOf} onClose={() => setOverrideOf(null)} />}
    </div>
  )
}

function StatementOverrideDialog({ card, st, onClose }: { card: Card; st: Statement; onClose: () => void }) {
  const { apply } = useStore()
  const [amount, setAmount] = useState<Minor | null>(st.amount)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (amount === null || amount < 0) return
    apply((s) => setStatementOverride(s, card.id, st.period, amount === st.computed ? undefined : amount), `${fmtMonth(st.period)} ekstresi güncellendi`)
    onClose()
  }
  return (
    <Modal title={`${fmtMonth(st.period)} Ekstresi`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted form-note">
          Uygulamanın hesapladığı tutar {fmt(st.computed)}. Bankadan gelen ekstre farklıysa (girilmemiş harcama, faiz, ücret)
          gerçek tutarı yazın; takvim ve nakit akışı bu tutarı kullanır.
        </p>
        <AmountInput label="Ekstre tutarı" value={amount} onChange={setAmount} required allowZero autoFocus />
        <div className="form-actions">
          {st.overridden && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                apply((s) => setStatementOverride(s, card.id, st.period, undefined), 'Hesaplanan tutara dönüldü')
                onClose()
              }}
            >
              Hesaplanana dön
            </button>
          )}
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

export function CardExpenseFields({
  card,
  value,
  onChange,
}: {
  card: Card | undefined
  value: { category: string; title: string; amount: Minor | null; date: string; installments: number; countsToStatement: boolean }
  onChange: (v: Partial<{ category: string; title: string; amount: Minor | null; date: string; installments: number; countsToStatement: boolean }>) => void
}) {
  const period = card && value.date ? periodForDate(card, value.date) : null
  return (
    <>
      <CategorySelect kind="out" value={value.category} onChange={(category) => onChange({ category })} />
      <div className="form-row">
        <AmountInput label="Toplam tutar" value={value.amount} onChange={(amount) => onChange({ amount })} required autoFocus />
        <Field label="Tarih">
          <input type="date" value={value.date} onChange={(e) => onChange({ date: e.target.value })} required />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Açıklama (opsiyonel)">
          <input value={value.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Öğle yemeği" />
        </Field>
        <Field
          label="Taksit"
          hint={
            value.installments > 1 && value.amount
              ? `${value.installments} × ${fmt(Math.round(value.amount / value.installments))}`
              : undefined
          }
        >
          <select value={value.installments} onChange={(e) => onChange({ installments: Number(e.target.value) })}>
            {INSTALLMENT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'Peşin' : `${n} taksit`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {period && (
        <p className="muted form-note">
          {value.installments > 1 ? 'İlk taksit' : 'Bu harcama'} {fmtMonth(period)} ekstresine düşer
          {value.installments > 1 ? `; son taksit ${fmtMonth(addMonthKey(period, value.installments - 1))}` : ''}.
        </p>
      )}
      <label className="check-inline">
        <input type="checkbox" checked={value.countsToStatement} onChange={(e) => onChange({ countsToStatement: e.target.checked })} />
        Ekstre borcuna ekle (işareti kaldırırsanız yalnızca raporlarda görünür)
      </label>
    </>
  )
}

function CardExpenseForm({ card, expense, onClose }: { card: Card; expense?: CardExpense; onClose: () => void }) {
  const { apply, today } = useStore()
  const [v, setV] = useState({
    category: expense?.category ?? 'Yemek',
    title: expense?.title ?? '',
    amount: (expense?.amount ?? null) as Minor | null,
    date: expense?.date ?? today,
    installments: expense?.installments ?? 1,
    countsToStatement: expense?.countsToStatement ?? true,
  })
  const dirty = useDirty(v)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!amountOk(v.amount, { required: true }) || v.amount === null) return
    apply((s) => saveCardExpense(s, { id: expense?.id, cardId: card.id, category: v.category, title: v.title.trim(), amount: v.amount!, date: v.date, installments: v.installments, countsToStatement: v.countsToStatement }), expense ? 'Harcama güncellendi' : undefined)
    onClose()
  }
  return (
    <Modal title={`${card.name} — ${expense ? 'Harcamayı Düzenle' : 'Harcama Ekle'}`} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        <CardExpenseFields card={card} value={v} onChange={(p) => setV((x) => ({ ...x, ...p }))} />
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

function CardForm({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const { apply, state, today } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(card?.companyId)
  const [name, setName] = useState(card?.name ?? '')
  const [bank, setBank] = useState(card?.bank ?? '')
  const [limit, setLimit] = useState<Minor | null>(card?.limit ?? null)
  const [statementDay, setStatementDay] = useState(String(card?.statementDay ?? 1))
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? 10))
  const [openingDebt, setOpeningDebt] = useState<Minor | null>(card?.openingDebt ?? 0)
  const sd = Number(statementDay)
  const dd = Number(dueDay)
  const daysOk = Number.isInteger(sd) && sd >= 1 && sd <= 28 && Number.isInteger(dd) && dd >= 1 && dd <= 28
  const draft: Card = { id: 'x', companyId: '', name, bank, limit: 0, statementDay: sd || 1, dueDay: dd || 10, openingDebt: 0, openingPeriod: '', statementOverrides: {} }
  const nextPeriod = daysOk ? periodForDate(draft, today) : monthKey(today)
  // Kesilmiş ama ödenmemiş ekstre varsa açılış borcu o döneme yazılır
  const closedPeriod = addMonthKey(nextPeriod, -1)
  const [openingPeriod, setOpeningPeriod] = useState(card?.openingPeriod ?? closedPeriod)
  const [submitted, setSubmitted] = useState(false)
  const dirty = useDirty({ name, bank, limit, statementDay, dueDay, openingDebt, openingPeriod })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !daysOk || !amountOk(openingDebt, { allowZero: true }) || (askCompany && !company)) return
    apply(
      (s) =>
        saveCard(
          s,
          {
            ...(card ?? { statementOverrides: {} }),
            id: card?.id,
            companyId: company || undefined,
            name: name.trim(),
            bank: bank.trim(),
            limit: limit ?? 0,
            statementDay: sd,
            dueDay: dd,
            openingDebt: openingDebt ?? 0,
            openingPeriod,
            statementOverrides: card?.statementOverrides ?? {},
          },
          company || state.companies[0]!.id,
        ),
      card ? `"${name}" güncellendi` : undefined,
    )
    onClose()
  }
  const periodOptions = [addMonthKey(closedPeriod, -1), closedPeriod, nextPeriod, addMonthKey(nextPeriod, 1)]
  if (!periodOptions.includes(openingPeriod)) periodOptions.unshift(openingPeriod)
  return (
    <Modal title={card ? 'Kartı Düzenle' : 'Yeni Kart'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <div className="form-row">
          <Field label="Kart Adı" error={submitted && !name.trim() ? 'Kart adı gerekli.' : null}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bonus Kart" autoFocus />
          </Field>
          <Field label="Banka">
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Garanti BBVA" />
          </Field>
        </div>
        <AmountInput label="Limit" value={limit} onChange={setLimit} />
        <div className="form-row">
          <Field label="Hesap kesim günü (1-28)" error={!daysOk ? 'Gün 1 ile 28 arasında olmalı.' : null}>
            <input value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Son ödeme günü (1-28)">
            <input value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <fieldset className="fieldset">
          <legend>Mevcut borç</legend>
          <div className="form-row">
            <AmountInput label="Kalem kalem girmeyeceğiniz borç" value={openingDebt} onChange={setOpeningDebt} allowZero />
            <Field label="Hangi ekstreye ait?">
              <select value={openingPeriod} onChange={(e) => setOpeningPeriod(e.target.value)}>
                {periodOptions.map((p) => (
                  <option key={p} value={p}>
                    {fmtMonth(p)} ekstresi
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="muted form-note">Ekstresi kesilmiş ama ödenmemiş tutarı girin. Bundan sonraki harcamaları "Harcama Ekle" ile kaydedin.</p>
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

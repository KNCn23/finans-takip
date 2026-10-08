import { useMemo, useState } from 'react'
import type { Budget, BudgetPeriod, Minor } from '../domain/types'
import { useStore } from '../store/StoreProvider'
import { deleteBudget, saveBudget } from '../store/actions'
import { budgetStatus } from '../domain/analytics'
import { addMonthKey, fmtMonth, fmtMonthShort, monthKey } from '../domain/dates'
import { fmt } from '../domain/money'
import { normCategory } from '../domain/defaults'
import { Modal } from '../ui/Modal'
import { PageHead, Segmented, Tip } from '../ui/Common'
import { AmountInput, CategorySelect, CompanyField, Field, amountOk, useDirty, useInitialCompany } from '../ui/Form'
import { useDialogs } from '../ui/Dialogs'
import { ChevronLeft, ChevronRight, EditIcon, PlusIcon, TrashIcon } from '../ui/Icons'

export function Budgets() {
  const { scoped, today, apply } = useStore()
  const { confirm } = useDialogs()
  const [month, setMonth] = useState(monthKey(today))
  const [view, setView] = useState<'month' | 'year'>('month')
  const [editing, setEditing] = useState<Budget | 'new' | null>(null)

  const rows = useMemo(
    () =>
      scoped.budgets
        .map((b) => ({ b, st: budgetStatus(scoped, b, month, today) }))
        .sort((a, b) => b.st.pct - a.st.pct),
    [scoped, month, today],
  )
  const year = month.slice(0, 4)
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const yearly = useMemo(
    () =>
      view === 'year'
        ? scoped.budgets
            .filter((b) => b.period === 'monthly')
            .map((b) => ({ b, cells: months.map((m) => budgetStatus(scoped, b, m, today)) }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, view, year, today],
  )

  const remove = async (b: Budget) => {
    if (await confirm({ title: 'Bütçe silinsin mi?', message: `"${b.category}" bütçesi silinecek. Harcama kayıtları etkilenmez.`, confirmLabel: 'Sil', danger: true }))
      apply((s) => deleteBudget(s, b.id), `"${b.category}" bütçesi silindi`)
  }

  return (
    <div className="page">
      <PageHead title="Bütçe">
        <Segmented
          label="Görünüm"
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'Aylık' },
            { value: 'year', label: 'Yıllık tablo' },
          ]}
        />
        <div className="month-nav">
          <button type="button" className="btn" aria-label={view === 'month' ? 'Önceki ay' : 'Önceki yıl'} onClick={() => setMonth(addMonthKey(month, view === 'month' ? -1 : -12))}>
            <ChevronLeft size={16} />
          </button>
          <strong>{view === 'month' ? fmtMonth(month) : year}</strong>
          <button type="button" className="btn" aria-label={view === 'month' ? 'Sonraki ay' : 'Sonraki yıl'} onClick={() => setMonth(addMonthKey(month, view === 'month' ? 1 : 12))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Bütçe Ekle
        </button>
      </PageHead>
      <Tip id="budgets">
        Kategoriye aylık veya yıllık limit koyun. Koyu çubuk gerçekleşen, açık çubuk planlanan (henüz ödenmemiş) harcamadır.
        "Devreden bütçe" açıksa bir ayda kullanılmayan tutar sonraki aya eklenir. Oklarla geçmiş ayları inceleyebilirsiniz.
      </Tip>
      {view === 'month' ? (
        rows.length === 0 ? (
          <div className="card empty-line">Henüz bütçe tanımlanmamış. "Bütçe Ekle" ile ilk limitinizi koyun.</div>
        ) : (
          <div className="card">
            <div className="budget-list">
              {rows.map(({ b, st }) => {
                const realizedPct = st.available > 0 ? (st.realized / st.available) * 100 : 0
                const plannedPct = st.available > 0 ? (st.planned / st.available) * 100 : 0
                return (
                  <div key={b.id} className="budget-row">
                    <div className="budget-info">
                      <strong>
                        {b.category}
                        {b.period === 'yearly' && <em className="tag">yıllık</em>}
                        {b.rollover && <em className="tag">devreden</em>}
                      </strong>
                      <span className="muted">
                        {st.level === 'over' ? `Limit ${fmt(st.total - st.available)} aşıldı!` : `${fmt(st.available - st.total)} kaldı`}
                        {st.carry > 0 && ` · ${fmt(st.carry)} devir`}
                      </span>
                    </div>
                    <div className="budget-track">
                      <div className="cat-bar-track big stacked" title={`Gerçekleşen ${fmt(st.realized)} · Planlanan ${fmt(st.planned)}`}>
                        <div className={`cat-bar-fill ${st.level === 'ok' ? '' : st.level}`} style={{ width: `${Math.min(100, realizedPct)}%` }} />
                        <div className="cat-bar-fill planned" style={{ width: `${Math.max(0, Math.min(100 - realizedPct, plannedPct))}%` }} />
                      </div>
                      <span className={`budget-pct ${st.level}`}>%{st.pct.toFixed(0)}</span>
                    </div>
                    <div className="budget-nums">
                      <span className={st.level === 'over' ? 'neg' : ''}>{fmt(st.total)}</span>
                      <span className="muted"> / {fmt(st.available)}</span>
                      {st.planned > 0 && <span className="muted small-note">{fmt(st.planned)} planlanan</span>}
                    </div>
                    <div className="row-actions">
                      <button type="button" className="icon-btn" aria-label={`${b.category} bütçesini düzenle`} title="Düzenle" onClick={() => setEditing(b)}>
                        <EditIcon size={15} />
                      </button>
                      <button type="button" className="icon-btn danger" aria-label={`${b.category} bütçesini sil`} title="Sil" onClick={() => void remove(b)}>
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      ) : (
        <div className="card">
          {yearly.length === 0 ? (
            <div className="empty-line">Yıllık tablo aylık bütçeler için gösterilir.</div>
          ) : (
            <div className="table-scroll">
              <table className="table year-table">
                <thead>
                  <tr>
                    <th>Kategori</th>
                    {months.map((m) => (
                      <th key={m} className="right">
                        {fmtMonthShort(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {yearly.map(({ b, cells }) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.category}</strong>
                        <span className="muted small-note">{fmt(b.limit)}/ay</span>
                      </td>
                      {cells.map((c, i) => (
                        <td key={i} className={`right cell-${c.level}`} title={`${fmt(c.total)} / ${fmt(c.available)}`}>
                          {c.total ? `%${c.pct.toFixed(0)}` : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {editing && <BudgetForm budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function BudgetForm({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { apply, state, scoped, today } = useStore()
  const [company, setCompany, askCompany] = useInitialCompany(budget?.companyId)
  const [category, setCategory] = useState(budget?.category ?? '')
  const [limit, setLimit] = useState<Minor | null>(budget?.limit ?? null)
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? 'monthly')
  const [rollover, setRollover] = useState(budget?.rollover ?? false)
  const [startMonth, setStartMonth] = useState(budget?.startMonth ?? monthKey(today))
  const dirty = useDirty({ category, limit, period, rollover, startMonth })
  const duplicate = scoped.budgets.some((b) => b.id !== budget?.id && b.period === period && normCategory(b.category) === normCategory(category) && (!company || b.companyId === company))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!category || !amountOk(limit, { required: true }) || limit === null || duplicate || (askCompany && !company)) return
    apply(
      (s) =>
        saveBudget(
          s,
          { id: budget?.id, companyId: company || undefined, category, limit, period, rollover: period === 'monthly' && rollover, startMonth },
          company || state.companies[0]!.id,
        ),
      budget ? 'Bütçe güncellendi' : undefined,
    )
    onClose()
  }
  return (
    <Modal title={budget ? 'Bütçeyi Düzenle' : 'Yeni Bütçe'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        {askCompany && <CompanyField value={company} onChange={setCompany} />}
        <CategorySelect kind="out" value={category} onChange={setCategory} />
        {duplicate && <p className="field-error">Bu kategori için zaten {period === 'monthly' ? 'aylık' : 'yıllık'} bir bütçe var.</p>}
        <Segmented
          full
          label="Dönem"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'monthly', label: 'Aylık' },
            { value: 'yearly', label: 'Yıllık' },
          ]}
        />
        <AmountInput label={period === 'monthly' ? 'Aylık limit' : 'Yıllık limit'} value={limit} onChange={setLimit} required autoFocus />
        {period === 'monthly' && (
          <>
            <label className="check-inline">
              <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
              Devreden bütçe: kullanılmayan tutar sonraki aya eklensin
            </label>
            {rollover && (
              <Field label="Devir başlangıç ayı">
                <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              </Field>
            )}
          </>
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

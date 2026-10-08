import { useMemo, useState } from 'react'
import { useStore } from '../store/StoreProvider'
import { monthSeries, periodReport, type CategoryAmount } from '../domain/analytics'
import { addMonthKey, fmtDate, fmtDayShort, fmtMonth, fmtMonthShort, monthKey, monthRange } from '../domain/dates'
import { fmt, toMajor } from '../domain/money'
import { PageHead, Segmented, StatCard, Tip } from '../ui/Common'
import { ChevronLeft, ChevronRight, DownloadIcon, PrintIcon } from '../ui/Icons'
import { fileStamp, saveAsPdf, saveTableAsExcel } from '../ui/exporting'

export function Reports() {
  const { scoped, today, state } = useStore()
  const [mode, setMode] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(monthKey(today))
  const year = month.slice(0, 4)
  const range = mode === 'month' ? monthRange(month) : { from: `${year}-01-01`, to: `${year}-12-31` }
  const title = mode === 'month' ? fmtMonth(month) : `${year} yılı`
  const r = useMemo(() => periodReport(scoped, range.from, range.to, today), [scoped, range.from, range.to, today])
  const series = useMemo(
    () => (mode === 'month' ? monthSeries(scoped, month, 6, today) : monthSeries(scoped, `${year}-12`, 12, today)),
    [scoped, mode, month, year, today],
  )
  const income = r.incomeRealized + r.incomePlanned
  const expense = r.expenseRealized + r.expensePlanned
  const maxSeries = Math.max(1, ...series.map((s) => Math.max(s.income, s.expense)))
  const company = state.activeCompanyId === 'all' ? 'Holding geneli' : state.companies.find((c) => c.id === state.activeCompanyId)?.name

  const exportExcel = () =>
    saveTableAsExcel(`rapor-${mode === 'month' ? month : year}-${fileStamp()}.xlsx`, 'Rapor', [
      ['Finans Takip raporu', title, company ?? ''],
      [],
      ['Özet', 'Gerçekleşen (TL)', 'Planlanan (TL)', 'Toplam (TL)'],
      ['Gelir', toMajor(r.incomeRealized), toMajor(r.incomePlanned), toMajor(income)],
      ['Gider', toMajor(r.expenseRealized), toMajor(r.expensePlanned), toMajor(expense)],
      ['Net', toMajor(r.incomeRealized - r.expenseRealized), toMajor(r.incomePlanned - r.expensePlanned), toMajor(income - expense)],
      [],
      ['Gider kategorisi', 'Gerçekleşen (TL)', 'Planlanan (TL)', 'Toplam (TL)'],
      ...r.expenseCategories.map((c) => [c.name, toMajor(c.realized), toMajor(c.planned), toMajor(c.realized + c.planned)]),
      [],
      ['Gelir kategorisi', 'Gerçekleşen (TL)', 'Planlanan (TL)', 'Toplam (TL)'],
      ...r.incomeCategories.map((c) => [c.name, toMajor(c.realized), toMajor(c.planned), toMajor(c.realized + c.planned)]),
      [],
      ['Ay', 'Gelir (TL)', 'Gider (TL)', 'Net (TL)'],
      ...series.map((s) => [fmtMonth(s.month), toMajor(s.income), toMajor(s.expense), toMajor(s.income - s.expense)]),
    ])

  return (
    <div className="page report-page">
      <PageHead title="Raporlar">
        <Segmented
          label="Dönem"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Aylık' },
            { value: 'year', label: 'Yıllık' },
          ]}
        />
        <div className="month-nav">
          <button type="button" className="btn" aria-label="Önceki dönem" onClick={() => setMonth(addMonthKey(month, mode === 'month' ? -1 : -12))}>
            <ChevronLeft size={16} />
          </button>
          <strong>{title}</strong>
          <button type="button" className="btn" aria-label="Sonraki dönem" onClick={() => setMonth(addMonthKey(month, mode === 'month' ? 1 : 12))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <button type="button" className="btn no-print" onClick={() => void exportExcel()}>
          <DownloadIcon size={15} /> Excel
        </button>
        <button type="button" className="btn no-print" onClick={() => void saveAsPdf(`rapor-${mode === 'month' ? month : year}.pdf`)}>
          <PrintIcon size={15} /> PDF / Yazdır
        </button>
      </PageHead>
      <div className="print-only print-title">
        <h2>Finans Takip — {title}</h2>
        <p>
          {company} · {fmtDate(today)} tarihinde oluşturuldu
        </p>
      </div>
      <Tip id="reports">
        "Gerçekleşen" ödendi/tahsil edildi olarak işaretlenmiş kalemler ve yapılmış kart harcamalarıdır; "planlanan" henüz
        ödenmemiş vadelerdir. Kart ekstre ödemeleri çift sayım olmasın diye sayılmaz, harcamalar kalem kalem sayılır.
      </Tip>
      <div className="stat-grid">
        <StatCard icon="↓" tone="net-pos" label="Gelir" value={fmt(income)} valueClass="pos" sub={`Gerçekleşen ${fmt(r.incomeRealized)} · planlanan ${fmt(r.incomePlanned)}`} />
        <StatCard icon="↑" tone="net-neg" label="Gider" value={fmt(expense)} valueClass="neg" sub={`Gerçekleşen ${fmt(r.expenseRealized)} · planlanan ${fmt(r.expensePlanned)}`} />
        <StatCard
          icon="="
          tone={income - expense >= 0 ? 'net-pos' : 'net-neg'}
          label="Net"
          value={fmt(income - expense)}
          valueClass={income - expense >= 0 ? 'pos' : 'neg'}
          sub={`Gerçekleşen net ${fmt(r.incomeRealized - r.expenseRealized)}`}
        />
      </div>
      <div className="dash-cols">
        <CategoryCard title="Kategori Bazlı Giderler" rows={r.expenseCategories} empty="Bu dönemde gider yok." />
        <CategoryCard title="Kategori Bazlı Gelirler" rows={r.incomeCategories} empty="Bu dönemde gelir yok." tone="in" />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>En Büyük Giderler</h3>
        </div>
        {r.topExpenses.length === 0 ? (
          <div className="empty-line">Kayıt yok.</div>
        ) : (
          <ul className="occ-list">
            {r.topExpenses.map((e, i) => (
              <li key={i} className="occ-row">
                <span className="rank">{i + 1}</span>
                <div className="occ-text">
                  <span className="occ-title">{e.title}</span>
                  <span className="occ-sub">
                    {e.sub}
                    {!e.realized && ' · planlanan'}
                  </span>
                </div>
                <div className="occ-right">
                  <span className="occ-amount out">−{fmt(e.amount)}</span>
                  <span className="occ-date">{fmtDayShort(e.date)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <h3>{mode === 'month' ? '6 Aylık' : '12 Aylık'} Gelir / Gider</h3>
          <span className="muted">
            <span className="legend in" /> Gelir <span className="legend out" /> Gider
          </span>
        </div>
        <div className="flow-chart" role="img" aria-label="Aylık gelir ve gider grafiği">
          {series.map((s) => (
            <div key={s.month} className={`flow-col${s.month === month && mode === 'month' ? ' current' : ''}`} title={`Gelir ${fmt(s.income)} · Gider ${fmt(s.expense)}`}>
              <div className="flow-bars">
                <div className="flow-bar in" style={{ height: `${(s.income / maxSeries) * 100}%` }} />
                <div className="flow-bar out" style={{ height: `${(s.expense / maxSeries) * 100}%` }} />
              </div>
              <span className="flow-label">{fmtMonthShort(s.month)}</span>
              <span className={`flow-proj ${s.income - s.expense < 0 ? 'neg' : 'pos'}`}>{fmt(s.income - s.expense)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CategoryCard({ title, rows, empty, tone }: { title: string; rows: CategoryAmount[]; empty: string; tone?: 'in' }) {
  const max = Math.max(1, ...rows.map((r) => r.realized + r.planned))
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="empty-line">{empty}</div>
      ) : (
        <div className="cat-bars">
          {rows.map((r) => (
            <div key={r.name} className="cat-bar-row" title={`Gerçekleşen ${fmt(r.realized)} · Planlanan ${fmt(r.planned)}`}>
              <span className="cat-bar-label">{r.name}</span>
              <div className="cat-bar-track stacked">
                <div className={`cat-bar-fill${tone === 'in' ? ' income' : ''}`} style={{ width: `${(r.realized / max) * 100}%` }} />
                <div className="cat-bar-fill planned" style={{ width: `${(r.planned / max) * 100}%` }} />
              </div>
              <span className="cat-bar-value">{fmt(r.realized + r.planned)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

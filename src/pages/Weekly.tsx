import { useMemo, useState } from 'react'
import { useStore } from '../store/StoreProvider'
import { weeklyForecast } from '../domain/analytics'
import { fmtWeekRange } from '../domain/dates'
import { fmt, toTRY } from '../domain/money'
import { OccurrenceList } from '../ui/Occurrences'
import { PageHead, Segmented, Tip } from '../ui/Common'
import { AlertIcon } from '../ui/Icons'

const HORIZONS = ['4', '8', '12', '26'] as const

export function Weekly() {
  const { scoped, today } = useStore()
  const [weeks, setWeeks] = useState<(typeof HORIZONS)[number]>('8')
  const f = useMemo(() => weeklyForecast(scoped, Number(weeks), today), [scoped, weeks, today])
  const before = f.overdue.filter((o) => o.date < f.weeks[0]!.weekStart)

  return (
    <div className="page">
      <PageHead title="Haftalık Takvim">
        <Segmented
          label="Kaç hafta gösterilsin"
          value={weeks}
          onChange={setWeeks}
          options={HORIZONS.map((h) => ({ value: h, label: `${h} Hafta` }))}
        />
      </PageHead>
      <Tip id="weekly">
        Önümüzdeki haftalarda hangi paranın gireceğini ve hangi ödemenin çıkacağını burada hafta hafta görürsünüz. Her
        haftanın altındaki "tahmini bakiye", vadeli mevduat hariç hesaplarınızda o hafta sonunda kalacak tutardır.
        {scoped.settings.shiftToBusinessDay && ' Kredi, kart ve çek vadeleri hafta sonu/resmi tatile denk gelirse sonraki iş gününde gösterilir.'}
      </Tip>
      {before.length > 0 && (
        <div className="card overdue-card">
          <div className="card-head">
            <h3>
              <AlertIcon size={16} /> Gecikmiş ({before.length})
            </h3>
            <span className="muted">Başlangıç bakiyesine etkisi: {fmt(before.reduce((t, o) => t + (o.direction === 'in' ? 1 : -1) * toTRY(o.amount, o.currency, scoped.settings.rates), 0))}</span>
          </div>
          <OccurrenceList items={before} showCompany />
        </div>
      )}
      {f.weeks.map((w, i) => (
        <section key={w.weekStart} className="card week-card" aria-label={`${fmtWeekRange(w.weekStart)} haftası`}>
          <div className="card-head">
            <h3>
              {i === 0 ? 'Bu Hafta' : i === 1 ? 'Gelecek Hafta' : `${i + 1}. Hafta`}
              <span className="week-range"> {fmtWeekRange(w.weekStart)}</span>
            </h3>
            <div className="week-totals">
              <span className="pos">+{fmt(w.income)}</span>
              <span className="neg">−{fmt(w.expense)}</span>
              <span className={`net ${w.income - w.expense >= 0 ? 'pos' : 'neg'}`}>Net {fmt(w.income - w.expense)}</span>
            </div>
          </div>
          <OccurrenceList items={w.items} emptyText="Bu hafta hareket yok." showCompany />
          <div className="week-foot">
            Hafta sonu tahmini bakiye: <strong className={w.projected >= 0 ? 'pos' : 'neg'}>{fmt(w.projected)}</strong>
          </div>
        </section>
      ))}
    </div>
  )
}

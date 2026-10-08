import { useMemo } from 'react'
import { useStore } from '../store/StoreProvider'
import { accountTotals, budgetStatus, debtTotals, weeklyForecast } from '../domain/analytics'
import { addDays, fmtWeekRange, monthKey, startOfWeek } from '../domain/dates'
import { fmt, toTRY } from '../domain/money'
import { generateOccurrences } from '../domain/occurrences'
import { OccurrenceList } from '../ui/Occurrences'
import { PageHead, StatCard, Tip } from '../ui/Common'
import { AlertIcon, BankIcon, CardIcon, PlusIcon, WalletIcon } from '../ui/Icons'
import type { Page } from '../App'

interface Props {
  onNavigate: (p: Page) => void
  onLoadDemo: () => void
  onAddAccount: () => void
}

export function Dashboard({ onNavigate, onLoadDemo, onAddAccount }: Props) {
  const { scoped, today, state } = useStore()
  const rates = scoped.settings.rates
  const ws = startOfWeek(today)
  const we = addDays(ws, 6)

  const data = useMemo(() => {
    const forecast = weeklyForecast(scoped, 8, today)
    const thisWeek = forecast.weeks[0]!
    const pending = generateOccurrences(scoped, ws, addDays(ws, 55)).filter((o) => !o.paid)
    const signedSum = (dir: 'in' | 'out') =>
      [...forecast.overdue.filter((o) => o.date < ws), ...pending]
        .filter((o) => o.direction === dir)
        .reduce((t, o) => t + toTRY(o.amount, o.currency, rates), 0)
    const month = monthKey(today)
    const budgetAlerts = scoped.budgets
      .map((b) => ({ b, st: budgetStatus(scoped, b, month, today) }))
      .filter((x) => x.st.level !== 'ok')
      .sort((a, b) => b.st.pct - a.st.pct)
    return {
      forecast,
      thisWeek,
      totals: accountTotals(scoped),
      debts: debtTotals(scoped, today),
      pendingIn: signedSum('in'),
      pendingOut: signedSum('out'),
      budgetAlerts,
    }
  }, [scoped, today, ws, rates])

  const steps = [
    { done: scoped.accounts.length > 0, label: 'Hesaplarınızı ve bakiyelerinizi ekleyin', action: onAddAccount, btn: 'Hesap Ekle' },
    { done: scoped.cards.length > 0, label: 'Kredi kartlarınızı tanıtın (varsa)', action: () => onNavigate('cards'), btn: 'Kartlara Git' },
    { done: scoped.loans.length > 0, label: 'Kredilerinizi ekleyin (varsa)', action: () => onNavigate('loans'), btn: 'Kredilere Git' },
    { done: scoped.payments.length > 0, label: 'Maaş, kira gibi düzenli gelir/giderleri girin', action: () => onNavigate('payments'), btn: 'Gelir/Gidere Git' },
  ]
  const setupOpen = steps.some((s) => !s.done)
  const empty = steps.every((s) => !s.done) && scoped.cheques.length === 0
  const net = data.thisWeek.income - data.thisWeek.expense
  const maxBar = Math.max(1, ...data.forecast.weeks.map((w) => Math.max(w.income, w.expense)))
  const overdue = data.forecast.overdue

  return (
    <div className="page">
      <PageHead title="Özet" />
      {setupOpen && (
        <div className="card welcome">
          <h3>{empty ? 'Hoş geldiniz 👋' : 'Kurulumu tamamlayın'}</h3>
          <p>
            {empty
              ? 'Birkaç adımda kendi finans panelinizi kurun ya da önce örnek verilerle uygulamayı keşfedin.'
              : 'Kalan adımları tamamladığınızda tablonuz tam doğruluğa ulaşır.'}
          </p>
          <ul className="checklist">
            {steps.map((s, i) => (
              <li key={s.label} className={s.done ? 'done' : ''}>
                <span className="check-mark" aria-hidden="true">
                  {s.done ? '✓' : i + 1}
                </span>
                <span className="check-text">{s.label}</span>
                {!s.done && (
                  <button type="button" className="btn small" onClick={s.action}>
                    {s.btn}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {empty && state.companies.length <= 1 && (
            <button type="button" className="btn primary" onClick={onLoadDemo}>
              Örnek Verilerle Dene
            </button>
          )}
        </div>
      )}

      <div className="stat-grid">
        <StatCard
          icon={<WalletIcon size={20} />}
          tone="wallet"
          label="Harcanabilir Bakiye"
          value={fmt(data.totals.liquid)}
          valueClass={data.totals.liquid < 0 ? 'neg' : ''}
          sub={data.totals.deposits ? `Vadeli dahil toplam ${fmt(data.totals.total)}` : undefined}
        />
        <StatCard
          icon={<BankIcon size={20} />}
          tone="loan"
          label="Kalan Kredi Taksitleri"
          value={fmt(data.debts.loanInstallmentsLeft)}
          sub={data.debts.loanPrincipalLeft !== undefined ? `Kalan anapara ≈ ${fmt(data.debts.loanPrincipalLeft)}` : 'Faiz dahil taksit toplamı'}
        />
        <StatCard
          icon={<CardIcon size={20} />}
          tone="card-debt"
          label="Kart Borcu (ödenmemiş)"
          value={fmt(data.debts.cardUnpaid)}
          sub={data.debts.cardFutureInstallments ? `+ ${fmt(data.debts.cardFutureInstallments)} gelecek taksit` : undefined}
        />
        <StatCard
          icon={<AlertIcon size={20} />}
          tone={net >= 0 ? 'net-pos' : 'net-neg'}
          label="Bu Hafta Net"
          value={fmt(net)}
          valueClass={net >= 0 ? 'pos' : 'neg'}
        />
        <StatCard icon="↓" tone="net-pos" label="Bekleyen Tahsilat" value={fmt(data.pendingIn)} valueClass="pos" sub="Gecikmiş + önümüzdeki 8 hafta" />
        <StatCard icon="↑" tone="net-neg" label="Bekleyen Ödeme" value={fmt(data.pendingOut)} valueClass="neg" sub="Gecikmiş + önümüzdeki 8 hafta" />
      </div>

      {data.budgetAlerts.length > 0 && (
        <div className="card overdue-card">
          <div className="card-head">
            <h3>
              <AlertIcon size={16} /> Bütçe Uyarıları
            </h3>
            <button type="button" className="link-btn" onClick={() => onNavigate('budgets')}>
              Bütçeye git →
            </button>
          </div>
          <div className="cat-bars">
            {data.budgetAlerts.map(({ b, st }) => (
              <div key={b.id} className="cat-bar-row">
                <span className="cat-bar-label">
                  {b.category}
                  {b.period === 'yearly' ? ' (yıllık)' : ''}
                </span>
                <div className="cat-bar-track">
                  <div className={`cat-bar-fill ${st.level}`} style={{ width: `${Math.min(100, st.pct)}%` }} />
                </div>
                <span className="cat-bar-value">
                  {fmt(st.total)} / {fmt(st.available)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dash-cols">
        <div className="card">
          <div className="card-head">
            <h3>Hesaplarım</h3>
            <div className="row-actions">
              <button type="button" className="btn small" onClick={onAddAccount}>
                <PlusIcon size={14} /> Hesap Ekle
              </button>
              <button type="button" className="btn small" onClick={() => onNavigate('accounts')}>
                Tümü →
              </button>
            </div>
          </div>
          <Tip id="accounts">
            Bir ödemeyi "ödendi" işaretlerken hangi hesaptan yapıldığını seçerseniz bakiye kendiliğinden güncellenir.
            Bakiyeyi elle değiştirmeniz gerekirse Hesaplar sayfasını kullanın — her değişiklik hareket olarak kaydedilir.
          </Tip>
          {scoped.accounts.length === 0 ? (
            <div className="empty-line">Henüz hesap eklenmemiş.</div>
          ) : (
            <ul className="account-list">
              {scoped.accounts.map((a) => (
                <li key={a.id}>
                  <span className="occ-icon payment" aria-hidden="true">
                    <WalletIcon size={16} />
                  </span>
                  <span className="account-name">
                    {a.name}
                    {state.activeCompanyId === 'all' && state.companies.length > 1 && (
                      <span className="muted small-note">{state.companies.find((c) => c.id === a.companyId)?.name}</span>
                    )}
                  </span>
                  <span className="account-amount">
                    <strong className={a.balance < 0 ? 'neg' : ''}>{fmt(a.balance, a.currency)}</strong>
                    {a.currency !== 'TRY' && <span className="muted small-note">≈ {fmt(toTRY(a.balance, a.currency, rates))}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Gecikmiş Ödemeler</h3>
            {overdue.length > 0 && <span className="badge danger">{overdue.length}</span>}
          </div>
          <OccurrenceList items={overdue} emptyText="Gecikmiş ödeme yok. 🎉" showCompany />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Bu Hafta ({fmtWeekRange(ws)})</h3>
          <span className="muted">
            Gelen {fmt(data.thisWeek.income)} · Giden {fmt(data.thisWeek.expense)}
          </span>
        </div>
        <Tip id="thisweek">
          Bir ödemeyi yaptığınızda satırın başındaki kutucuğu işaretleyin; hangi hesaptan ödediğinizi seçtiğinizde bakiye
          güncellenir. Tekrarlayan bir kaydın yalnızca bu ayki tutarını kalem simgesiyle değiştirebilirsiniz.
        </Tip>
        <OccurrenceList items={data.thisWeek.items.filter((o) => o.date >= ws && o.date <= we)} emptyText="Bu hafta planlanmış hareket yok." showCompany />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>8 Haftalık Nakit Akışı</h3>
          <span className="muted">
            <span className="legend in" /> Gelen <span className="legend out" /> Giden
          </span>
        </div>
        <div className="flow-chart" role="img" aria-label="8 haftalık gelen ve giden para grafiği">
          {data.forecast.weeks.map((w) => (
            <div key={w.weekStart} className="flow-col" title={`Gelen ${fmt(w.income)} · Giden ${fmt(w.expense)} · Hafta sonu tahmini ${fmt(w.projected)}`}>
              <div className="flow-bars">
                <div className="flow-bar in" style={{ height: `${(w.income / maxBar) * 100}%` }} />
                <div className="flow-bar out" style={{ height: `${(w.expense / maxBar) * 100}%` }} />
              </div>
              <span className="flow-label">{fmtWeekRange(w.weekStart).split('–')[0]}</span>
              <span className={`flow-proj ${w.projected < 0 ? 'neg' : ''}`}>{fmt(w.projected)}</span>
            </div>
          ))}
        </div>
        <p className="muted chart-note">Alttaki tutarlar: o haftanın sonunda beklenen harcanabilir bakiye.</p>
      </div>
    </div>
  )
}

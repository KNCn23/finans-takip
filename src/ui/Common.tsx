import { Component, useSyncExternalStore, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

// ---------------------------------------------------------------- İpuçları

// İlk sürümle aynı anahtar: kapatılan ipuçları güncellemeden sonra geri gelmez.
const TIPS_KEY = 'finans-tips-dismissed'
let listeners: (() => void)[] = []
let cache: string[] | null = null

function readTips(): string[] {
  if (cache === null) {
    try {
      cache = JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]')
    } catch {
      cache = []
    }
  }
  return cache!
}
function writeTips(v: string[]) {
  cache = v
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(v))
  } catch {
    /* depo kapalıysa yalnızca bu oturumda */
  }
  listeners.forEach((l) => l())
}
function subscribe(l: () => void) {
  listeners.push(l)
  return () => {
    listeners = listeners.filter((x) => x !== l)
  }
}
export function resetTips() {
  writeTips([])
}

export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const dismissed = useSyncExternalStore(subscribe, readTips)
  if (dismissed.includes(id)) return null
  return (
    <div className="tip">
      <span className="tip-icon" aria-hidden="true">
        💡
      </span>
      <div className="tip-text">{children}</div>
      <button
        type="button"
        className="icon-btn"
        aria-label="İpucunu kapat"
        title="Anladım, bir daha gösterme"
        onClick={() => writeTips([...readTips(), id])}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- Özet kartı

export function StatCard({
  icon,
  tone,
  label,
  value,
  valueClass,
  sub,
}: {
  icon: ReactNode
  tone: string
  label: string
  value: ReactNode
  valueClass?: string
  sub?: ReactNode
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`} aria-hidden="true">
        {icon}
      </div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <span className={`stat-value ${valueClass ?? ''}`}>{value}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  )
}

export function Progress({ pct, tone }: { pct: number; tone?: 'danger' | 'warn' }) {
  const v = Math.max(0, Math.min(100, pct))
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill${tone ? ' ' + tone : ''}`} style={{ width: `${v}%` }} />
    </div>
  )
}

// ---------------------------------------------------------------- Hata sınırı

interface EBState {
  error: Error | null
}

/** Bir ekranda hata olursa beyaz sayfa yerine kurtarma ekranı gösterir. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void; resetKey?: string }, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Arayüz hatası:', error, info.componentStack)
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card error-card" role="alert">
        <h3>Bu ekran açılırken bir hata oluştu</h3>
        <p className="muted">
          Verileriniz güvende — hata yalnızca görüntülemeyle ilgili. Başka bir sayfaya geçebilir veya aşağıdan tekrar
          deneyebilirsiniz.
        </p>
        <pre className="error-detail">{this.state.error.message}</pre>
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
          >
            Tekrar dene
          </button>
        </div>
      </div>
    )
  }
}

/** Sayfa başlığı satırı */
export function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h2>{title}</h2>
      {children && <div className="page-head-right">{children}</div>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  full,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; tone?: 'in' | 'out' }[]
  label: string
  full?: boolean
}) {
  return (
    <div className={`segmented${full ? ' full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? `active${o.tone ? ' ' + o.tone : ''}` : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

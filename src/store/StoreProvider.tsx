import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ID, ISODate, State } from '../domain/types'
import { scopeState } from '../domain/occurrences'
import { today } from '../domain/dates'
import { platform } from './platform'

const HISTORY_LIMIT = 50
const SAVE_DELAY = 400

export interface Store {
  state: State
  /** Seçili şirkete göre filtrelenmiş veri */
  scoped: State
  today: ISODate
  /** Yeni kayıtların gideceği şirket; "Holding Geneli"nde null (formda sorulur) */
  targetCompanyId: ID | null
  /**
   * Durumu değiştirir. label verilirse "Geri al" bildirimi gösterilir.
   * Hata fırlatan işlemler durumu değiştirmez; hata çağırana iletilir.
   */
  apply: (fn: (s: State) => State, label?: string) => void
  undo: () => void
  canUndo: boolean
  undoLabel: string | null
  /** Son etiketli (geri alınabilir) işlem — arayüz "Geri al" bildirimi gösterir */
  notice: { id: number; label: string } | null
  saveError: string | null
  lastSavedAt: Date | null
  /** Bekleyen kaydı hemen diske yazar */
  flush: () => Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore, StoreProvider içinde kullanılmalı')
  return s
}

interface Props {
  initial: State
  children: ReactNode
}

export function StoreProvider({ initial, children }: Props) {
  const [state, setState] = useState<State>(initial)
  const history = useRef<{ state: State; label: string }[]>([])
  const [, setHistoryVersion] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [day, setDay] = useState(today())
  const [notice, setNotice] = useState<{ id: number; label: string } | null>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)
  const stateRef = useRef(state)
  stateRef.current = state

  // Gün değişince (uygulama gece açık kaldıysa) "bugün" güncellenir
  useEffect(() => {
    const id = setInterval(() => setDay(today()), 60_000)
    return () => clearInterval(id)
  }, [])

  const writeNow = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const text = pending.current
    if (text === null) return
    pending.current = null
    try {
      await platform.save(text)
      setSaveError(null)
      setLastSavedAt(new Date())
    } catch (err) {
      pending.current = pending.current ?? text
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    pending.current = JSON.stringify(state)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void writeNow(), SAVE_DELAY)
  }, [state, writeNow])

  // Pencere kapanırken bekleyen kayıt eşzamanlı yazılır
  useEffect(() => {
    const onUnload = () => {
      if (pending.current !== null) platform.saveSync(pending.current)
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const apply = useCallback(
    (fn: (s: State) => State, label?: string) => {
      const prev = stateRef.current
      const next = fn(prev) // hata fırlatırsa durum değişmez
      if (next === prev) return
      stateRef.current = next
      setState(next)
      history.current = [...history.current.slice(-(HISTORY_LIMIT - 1)), { state: prev, label: label ?? 'Değişiklik' }]
      setHistoryVersion((v) => v + 1)
      if (label) setNotice((n) => ({ id: (n?.id ?? 0) + 1, label }))
    },
    [],
  )

  const undo = useCallback(() => {
    const last = history.current[history.current.length - 1]
    if (!last) return
    history.current = history.current.slice(0, -1)
    stateRef.current = last.state
    setState(last.state)
    setHistoryVersion((v) => v + 1)
  }, [])

  const scoped = useMemo(() => scopeState(state, state.activeCompanyId), [state])
  const targetCompanyId = state.activeCompanyId === 'all' ? (state.companies.length === 1 ? state.companies[0]!.id : null) : state.activeCompanyId

  const value: Store = {
    state,
    scoped,
    today: day,
    targetCompanyId,
    apply,
    undo,
    canUndo: history.current.length > 0,
    undoLabel: history.current[history.current.length - 1]?.label ?? null,
    notice,
    saveError,
    lastSavedAt,
    flush: writeNow,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

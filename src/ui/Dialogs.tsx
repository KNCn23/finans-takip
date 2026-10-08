// Tarayıcının confirm()/alert() pencereleri yerine uygulama içi onay
// pencereleri ve "Geri al" düğmeli bildirimler.

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ToastOptions {
  kind?: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface Toast extends ToastOptions {
  id: number
  message: string
}

interface DialogApi {
  confirm(opts: ConfirmOptions): Promise<boolean>
  alert(title: string, message: ReactNode): Promise<void>
  toast(message: string, opts?: ToastOptions): void
}

const Ctx = createContext<DialogApi | null>(null)

export function useDialogs(): DialogApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDialogs, DialogProvider içinde kullanılmalı')
  return c
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { alertOnly?: boolean; resolve: (v: boolean) => void }) | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })),
    [],
  )
  const alert = useCallback(
    (title: string, message: ReactNode) =>
      new Promise<void>((resolve) => setDialog({ title, message, alertOnly: true, confirmLabel: 'Tamam', resolve: () => resolve() })),
    [],
  )
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current
      setToasts((t) => [...t.slice(-3), { id, message, ...opts }])
      setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 8000 : 4000))
    },
    [dismiss],
  )

  const close = (v: boolean) => {
    dialog?.resolve(v)
    setDialog(null)
  }

  return (
    <Ctx.Provider value={{ confirm, alert, toast }}>
      {children}
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)}>
          <div className="form">
            <div className="dialog-message">{dialog.message}</div>
            <div className="form-actions">
              {!dialog.alertOnly && (
                <button type="button" className="btn" onClick={() => close(false)}>
                  {dialog.cancelLabel ?? 'Vazgeç'}
                </button>
              )}
              <button
                type="button"
                className={`btn ${dialog.danger ? 'danger-solid' : 'primary'}`}
                onClick={() => close(true)}
                autoFocus
              >
                {dialog.confirmLabel ?? 'Tamam'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? 'info'}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Bildirimi kapat" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

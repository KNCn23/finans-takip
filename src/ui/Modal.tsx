import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /** Formda kaydedilmemiş değişiklik varsa dışarı tıklamak/Esc onay ister */
  dirty?: boolean
  wide?: boolean
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, dirty = false, wide = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [askDiscard, setAskDiscard] = useState(false)
  const askRef = useRef(false)
  askRef.current = askDiscard

  const requestClose = () => {
    // Doluysa önce uyarı gösterilir; ikinci Esc/kapat isteği onay sayılır
    if (dirtyRef.current && !askRef.current) {
      setAskDiscard(true)
      return
    }
    closeRef.current()
  }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const node = ref.current
    // autoFocus'lu alan yoksa ilk odaklanabilir öğeye geç
    if (node && !node.contains(document.activeElement)) {
      const first = node.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE)
      first?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!node) return
      // Yalnızca en üstteki modal tuşlara tepki verir
      const modals = document.querySelectorAll('.modal')
      if (modals[modals.length - 1] !== node) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      } else if (e.key === 'Tab') {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (items.length === 0) return
        const first = items[0]!
        const last = items[items.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // Dışarı tıklamak yalnızca form boşsa kapatır; doluysa onay ister
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-btn" onClick={requestClose} aria-label="Kapat" title="Kapat (Esc)">
            <CloseIcon size={16} />
          </button>
        </div>
        {askDiscard && (
          <div className="discard-bar" role="alert">
            <span>Kaydedilmemiş değişiklikler kaybolacak.</span>
            <button type="button" className="btn small" onClick={() => setAskDiscard(false)}>
              Düzenlemeye dön
            </button>
            <button type="button" className="btn small danger-solid" onClick={() => closeRef.current()}>
              Kaydetmeden kapat
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

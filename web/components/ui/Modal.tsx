'use client'
import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, footer, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10" onClick={onClose}>
      <div
        className={`w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Close">✕</button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer != null && <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export default Modal

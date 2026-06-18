import type { JSX } from 'react'
import { Ic } from './Icon'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Eliminar',
  onConfirm,
  onCancel
}: Props): JSX.Element {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="dialog-header">
          <span className="dialog-icon"><Ic.Trash size={20} /></span>
          <h3>{title}</h3>
        </div>
        <p className="dialog-msg">{message}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel} autoFocus>
            Cancelar
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

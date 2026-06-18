/**
 * Logo de CYE para el sidebar.
 */
import type { JSX } from 'react'
import logoSrc from '../assets/logo-cye.png'

export function CyeLogo(): JSX.Element {
  return (
    <img
      src={logoSrc}
      alt="CYE — Control y Estudios"
      style={{ width: 120, display: 'block' }}
      draggable={false}
    />
  )
}

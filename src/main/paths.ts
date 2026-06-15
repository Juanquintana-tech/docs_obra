import { app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Resuelve rutas dentro de resources/ tanto en desarrollo como empaquetado.
 * Dev: <raíz del proyecto>/resources.  Empaquetado: process.resourcesPath.
 */
export function resourcePath(...segments: string[]): string {
  const base = is.dev ? join(app.getAppPath(), 'resources') : process.resourcesPath
  return join(base, ...segments)
}

export const knowledgePath = (file: string): string => resourcePath('knowledge', file)
export const templatePath = (file: string): string => resourcePath('templates', file)

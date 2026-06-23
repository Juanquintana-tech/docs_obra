import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
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

/**
 * Ruta de un fichero de knowledge que el usuario puede editar (p.ej. test_rules.json).
 *
 * En desarrollo: igual que knowledgePath (escribe directamente en resources/).
 * En producción: usa userData/knowledge/ — fuera del bundle, con permisos de escritura.
 * Si el fichero no existe aún en userData, lo copia desde el bundle como valor inicial.
 */
export function writableKnowledgePath(file: string): string {
  if (is.dev) return knowledgePath(file)
  const userDir = join(app.getPath('userData'), 'knowledge')
  if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true })
  const dest = join(userDir, file)
  if (!existsSync(dest)) {
    const src = knowledgePath(file)
    if (existsSync(src)) copyFileSync(src, dest)
  }
  return dest
}

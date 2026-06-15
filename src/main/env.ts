import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Carga variables de un fichero .env (KEY=VALUE) sin pisar las ya definidas.
 * Busca en dos sitios:
 *   - dev: <raíz del proyecto>/.env
 *   - empaquetado: <userData>/.env  (donde el usuario puede dejar su API key
 *     tras instalar la app, sin recompilar)
 */
export function loadDotenv(): void {
  const candidates = is.dev
    ? [join(app.getAppPath(), '.env')]
    : [join(app.getPath('userData'), '.env')]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const [k, ...rest] = t.split('=')
      const key = k.trim()
      const val = rest
        .join('=')
        .trim()
        .replace(/^['"]|['"]$/g, '')
      if (key && val && !(key in process.env)) process.env[key] = val
    }
    console.log(`[env] cargado ${path}`)
  }
}

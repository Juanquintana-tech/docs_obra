/**
 * Normaliza un error (de una llamada IPC o de cualquier promesa) a un mensaje
 * legible para el usuario. Reconoce casos frecuentes (falta de API key) y limpia
 * el prefijo que Electron añade a los errores de `ipcRenderer.invoke`.
 */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/MINIMAX_API_KEY/i.test(msg)) {
    return 'Falta la API key de MiniMax. Añádela como MINIMAX_API_KEY en el fichero .env del proyecto.'
  }
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '')
}

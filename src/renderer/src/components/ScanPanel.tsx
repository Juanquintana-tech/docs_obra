/**
 * Panel de escaneo de formularios de ensayo.
 * Acepta imágenes (JPG, PNG) y PDFs, llama a Gemini Vision vía IPC
 * y devuelve los datos extraídos al componente padre.
 *
 * Tipos con soporte: densidad_in_situ, albaran_ensayos, placa_carga.
 */
import { useRef, useState, useCallback, type JSX, type ChangeEvent, type DragEvent } from 'react'
import { api } from '../lib/api'
import { Ic } from './Icon'

const SUPPORTED = new Set(['densidad_in_situ', 'albaran_ensayos', 'placa_carga', 'granulometria'])

interface Props {
  tipo: string
  onResult: (ocr: Record<string, unknown>) => void
}

interface Capture {
  base64: string
  mimeType: string
  isPdf: boolean
  previewUrl: string | null // null para PDFs
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      const header = dataUrl.slice(0, comma)
      const data = dataUrl.slice(comma + 1)
      const mimeType = header.replace('data:', '').replace(';base64', '')
      resolve({ base64: data, mimeType })
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}

/** Redimensiona imágenes grandes a ≤2048px para reducir tráfico. PDFs se pasan tal cual. */
async function processFile(file: File): Promise<Capture> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    const { base64, mimeType } = await fileToBase64(file)
    return { base64, mimeType: mimeType || 'application/pdf', isPdf: true, previewUrl: null }
  }

  // Leer como data URL primero (evita blob URLs que fallan en Electron con contextIsolation)
  const { base64, mimeType } = await fileToBase64(file)
  const dataUrl = `data:${mimeType};base64,${base64}`

  const MAX_PX = 2048
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (w <= MAX_PX && h <= MAX_PX) {
        resolve({ base64, mimeType, isPdf: false, previewUrl: dataUrl })
        return
      }
      // Resize necesario
      const scale = MAX_PX / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const resized = canvas.toDataURL('image/jpeg', 0.88)
      const comma = resized.indexOf(',')
      const resizedMime = resized.slice(5, comma).replace(';base64', '')
      const resizedB64 = resized.slice(comma + 1)
      resolve({ base64: resizedB64, mimeType: resizedMime, isPdf: false, previewUrl: resized })
    }
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
    img.src = dataUrl
  })
}

// ── Componente ────────────────────────────────────────────────────────────────

export function ScanPanel({ tipo, onResult }: Props): JSX.Element | null {
  // ⚠ Todos los hooks ANTES de cualquier return condicional (Rules of Hooks)
  const [open, setOpen] = useState(false)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [camActive, setCamActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Ahora sí: si el tipo no está soportado, no renderizar nada
  if (!SUPPORTED.has(tipo)) return null

  const loadFile = useCallback(async (file: File) => {
    setScanError(null)
    try {
      const result = await processFile(file)
      setCapture(result)
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Error al cargar el archivo')
    }
  }, [])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  function handleDragOver(e: DragEvent): void { e.preventDefault(); setDrag(true) }
  function handleDragLeave(): void { setDrag(false) }
  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  async function startCamera(): Promise<void> {
    setScanError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment' }
      })
      streamRef.current = stream
      setCamActive(true)
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      }, 50)
    } catch {
      setScanError('No se pudo acceder a la cámara. Comprueba los permisos.')
    }
  }

  function stopCamera(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamActive(false)
  }

  function captureCamera(): void {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
    const comma = dataUrl.indexOf(',')
    const mimeType = dataUrl.slice(5, comma).replace(';base64', '')
    const base64 = dataUrl.slice(comma + 1)
    setCapture({ base64, mimeType, isPdf: false, previewUrl: dataUrl })
    stopCamera()
  }

  async function runScan(): Promise<void> {
    if (!capture) return
    setScanning(true)
    setScanError(null)
    try {
      const result = await api.scanEnsayoFromImage(tipo, capture.base64, capture.mimeType)
      onResult(result.ocr)
      // Cerrar y limpiar panel tras éxito
      setOpen(false)
      setCapture(null)
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : 'Error al escanear el formulario')
    } finally {
      setScanning(false)
    }
  }

  function reset(): void {
    setCapture(null)
    setScanError(null)
    stopCamera()
  }

  function toggleOpen(): void {
    if (open) { reset(); setOpen(false) }
    else setOpen(true)
  }

  return (
    <div className="scan-panel" style={{ marginBottom: 14 }}>
      {/* Cabecera colapsable */}
      <button className={`scan-toggle${open ? ' open' : ''}`} onClick={toggleOpen}>
        <Ic.Upload size={15} />
        <span>Escanear formulario</span>
        <span className="scan-toggle-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="scan-body">

          {/* Zona de selección (sin captura aún) */}
          {!capture && !camActive && (
            <div
              className={`scan-drop-zone${drag ? ' drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <Ic.Upload size={32} />
              <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>
                Arrastra una foto o PDF del formulario aquí
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-soft)' }}>
                JPG · PNG · PDF — se redimensiona automáticamente si es muy grande
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                  Seleccionar archivo
                </button>
                <button className="btn" onClick={startCamera}>
                  Usar cámara
                </button>
              </div>
            </div>
          )}

          {/* Preview de cámara en vivo */}
          {camActive && (
            <div className="scan-camera">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} autoPlay playsInline style={{ width: '100%', borderRadius: 8 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary" onClick={captureCamera}>Capturar</button>
                <button className="btn" onClick={stopCamera}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Preview de archivo capturado */}
          {capture && !camActive && (
            <div className="scan-preview-area">
              {capture.isPdf ? (
                <div className="scan-pdf-badge">
                  <span style={{ fontSize: 36 }}>📄</span>
                  <span style={{ fontWeight: 600 }}>PDF cargado</span>
                  <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                    Gemini procesará todas sus páginas
                  </span>
                </div>
              ) : (
                <img
                  src={capture.previewUrl!}
                  alt="Formulario a escanear"
                  className="scan-preview-img"
                />
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={runScan} disabled={scanning}>
                  {scanning
                    ? <><span className="spin" />Extrayendo datos…</>
                    : 'Extraer datos con IA'
                  }
                </button>
                <button className="btn" onClick={reset} disabled={scanning}>
                  Cambiar archivo
                </button>
              </div>
            </div>
          )}

          {scanError && (
            <div className="banner banner-error" style={{ marginTop: 10 }}>⚠ {scanError}</div>
          )}

          <p className="scan-disclaimer">
            Los datos extraídos se pre-rellenan para revisión. Comprueba y corrige antes de guardar.
          </p>
        </div>
      )}
    </div>
  )
}

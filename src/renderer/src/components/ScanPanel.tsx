/**
 * Panel de escaneo de formularios de ensayo.
 * Acepta imágenes (JPG, PNG) y PDFs, llama a Gemini Vision vía IPC
 * y devuelve los datos extraídos al componente padre.
 */
import { useRef, useState, useCallback, type JSX, type ChangeEvent, type DragEvent } from 'react'
import { api } from '../lib/api'
import { Ic } from './Icon'

const SUPPORTED = new Set(['densidad_in_situ', 'albaran_ensayos', 'placa_carga', 'granulometria', 'toma_hormigon', 'informe_hormigon', 'albaran_planta'])

interface Props {
  tipo: string
  onResult: (ocr: Record<string, unknown>, conf: Record<string, string>) => void
}

interface Capture {
  base64: string
  mimeType: string
  isPdf: boolean
  fileName: string
  previewUrl: string | null
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

async function processFile(file: File): Promise<Capture> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    const { base64, mimeType } = await fileToBase64(file)
    return { base64, mimeType: mimeType || 'application/pdf', isPdf: true, fileName: file.name, previewUrl: null }
  }

  const { base64, mimeType } = await fileToBase64(file)
  const dataUrl = `data:${mimeType};base64,${base64}`

  const MAX_PX = 2048
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (w <= MAX_PX && h <= MAX_PX) {
        resolve({ base64, mimeType, isPdf: false, fileName: file.name, previewUrl: dataUrl })
        return
      }
      const scale = MAX_PX / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const resized = canvas.toDataURL('image/jpeg', 0.88)
      const comma = resized.indexOf(',')
      const resizedMime = resized.slice(5, comma).replace(';base64', '')
      const resizedB64 = resized.slice(comma + 1)
      resolve({ base64: resizedB64, mimeType: resizedMime, isPdf: false, fileName: file.name, previewUrl: resized })
    }
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
    img.src = dataUrl
  })
}

// ── Componente ────────────────────────────────────────────────────────────────

export function ScanPanel({ tipo, onResult }: Props): JSX.Element | null {
  const [open, setOpen]       = useState(false)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [drag, setDrag]       = useState(false)
  const [camActive, setCamActive] = useState(false)
  const [scanConf, setScanConf] = useState<Record<string, string> | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef     = useRef<HTMLVideoElement>(null)
  const streamRef    = useRef<MediaStream | null>(null)

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

  function handleDragOver(e: DragEvent): void  { e.preventDefault(); setDrag(true) }
  function handleDragLeave(): void             { setDrag(false) }
  function handleDrop(e: DragEvent): void {
    e.preventDefault(); setDrag(false)
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
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 50)
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
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const dataUrl  = canvas.toDataURL('image/jpeg', 0.88)
    const comma    = dataUrl.indexOf(',')
    const mimeType = dataUrl.slice(5, comma).replace(';base64', '')
    const base64   = dataUrl.slice(comma + 1)
    setCapture({ base64, mimeType, isPdf: false, fileName: 'captura.jpg', previewUrl: dataUrl })
    stopCamera()
  }

  async function runScan(): Promise<void> {
    if (!capture) return
    setScanning(true)
    setScanError(null)
    try {
      const result = await api.scanEnsayoFromImage(tipo, capture.base64, capture.mimeType)
      onResult(result.ocr, result.conf ?? {})
      setScanConf(result.conf ?? {})
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
    setScanConf(null)
    stopCamera()
  }

  function toggleOpen(): void {
    if (open) { reset(); setOpen(false) }
    else setOpen(true)
  }

  return (
    <div className="scan-panel">

      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <button className={`scan-header${open ? ' open' : ''}`} onClick={toggleOpen}>
        <div className="scan-header-icon">
          <Ic.Upload size={20} />
        </div>
        <div className="scan-header-text">
          <span className="scan-header-title">Importar desde formulario escaneado</span>
          <span className="scan-header-sub">
            Sube una foto o PDF — la IA extrae los valores automáticamente
          </span>
        </div>
        <span className="scan-header-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {/* ── Cuerpo expandido ─────────────────────────────────────────────── */}
      {open && (
        <div className="scan-body">

          {/* — Zona de selección — */}
          {!capture && !camActive && !scanConf && (
            <div className="scan-main-layout">

              {/* Drop zone */}
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
                <div className="scan-drop-icon">
                  <Ic.Upload size={36} />
                </div>
                <p className="scan-drop-title">Arrastra el formulario aquí</p>
                <p className="scan-drop-hint">o selecciona un archivo desde tu dispositivo</p>
                <div className="scan-fmt-badges">
                  <span className="scan-fmt-badge">JPG</span>
                  <span className="scan-fmt-badge">PNG</span>
                  <span className="scan-fmt-badge">PDF</span>
                </div>
                <div className="scan-drop-actions">
                  <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                    Seleccionar archivo
                  </button>
                  <button className="btn" onClick={startCamera}>
                    Usar cámara
                  </button>
                </div>
              </div>

              {/* Panel de instrucciones */}
              <div className="scan-info-panel">
                <p className="scan-info-title">¿Cómo funciona?</p>
                <ol className="scan-steps">
                  <li>Fotografía el formulario de campo o adjunta el PDF</li>
                  <li>Gemini Vision analiza los valores manuscritos</li>
                  <li>Los datos se pre-rellenan en el formulario</li>
                  <li>Revisa y corrige antes de guardar</li>
                </ol>
                <div className="scan-tip-box">
                  <strong>Consejo:</strong> usa buena iluminación y evita sombras sobre los números.
                </div>
                <p className="scan-powered">Análisis con Gemini Vision · Google AI</p>
              </div>
            </div>
          )}

          {/* — Resultado de confianza OCR — */}
          {scanConf && !camActive && (() => {
            const counts = { high: 0, mid: 0, low: 0 }
            for (const v of Object.values(scanConf)) {
              if (v === 'high') counts.high++
              else if (v === 'mid') counts.mid++
              else if (v === 'low') counts.low++
            }
            const total = counts.high + counts.mid + counts.low
            return (
              <div className="scan-conf-result">
                <div className="scan-conf-title">✓ Datos extraídos del formulario</div>
                {total > 0 && (
                  <div className="scan-conf-chips">
                    {counts.high > 0 && (
                      <span className="scan-conf-chip scan-conf-high">
                        <span className="scan-conf-dot" />
                        {counts.high} {counts.high === 1 ? 'campo' : 'campos'} seguros
                      </span>
                    )}
                    {counts.mid > 0 && (
                      <span className="scan-conf-chip scan-conf-mid">
                        <span className="scan-conf-dot" />
                        {counts.mid} {counts.mid === 1 ? 'campo dudoso' : 'campos dudosos'}
                      </span>
                    )}
                    {counts.low > 0 && (
                      <span className="scan-conf-chip scan-conf-low">
                        <span className="scan-conf-dot" />
                        {counts.low} {counts.low === 1 ? 'campo incierto' : 'campos inciertos'}
                      </span>
                    )}
                  </div>
                )}
                <p className="scan-conf-hint">
                  Los campos con fondo coloreado indican la confianza de Gemini.
                  Revisa especialmente los marcados en <strong>amarillo</strong> y <strong>rojo</strong>.
                </p>
                <div className="scan-conf-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => { setScanConf(null); setOpen(false) }}
                  >
                    Aceptar y revisar
                  </button>
                  <button className="btn" onClick={() => setScanConf(null)}>
                    Escanear otro
                  </button>
                </div>
              </div>
            )
          })()}

          {/* — Vista de cámara — */}
          {!scanConf && camActive && (
            <div className="scan-camera-area">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} autoPlay playsInline className="scan-camera-video" />
              <div className="scan-camera-actions">
                <button className="btn btn-primary" onClick={captureCamera}>
                  Capturar foto
                </button>
                <button className="btn" onClick={stopCamera}>Cancelar</button>
              </div>
            </div>
          )}

          {/* — Vista previa del archivo seleccionado — */}
          {capture && !camActive && !scanConf && (
            <div className="scan-preview-area">
              {capture.isPdf ? (
                <div className="scan-pdf-badge">
                  <span className="scan-pdf-icon">📄</span>
                  <div className="scan-pdf-info">
                    <span className="scan-pdf-name">{capture.fileName}</span>
                    <span className="scan-pdf-sub">PDF · listo para analizar</span>
                  </div>
                </div>
              ) : (
                <div className="scan-img-wrap">
                  <img
                    src={capture.previewUrl!}
                    alt="Formulario a escanear"
                    className="scan-preview-img"
                  />
                  <div className="scan-img-name">
                    <span>🖼</span>
                    <span>{capture.fileName}</span>
                  </div>
                </div>
              )}
              <div className="scan-preview-actions">
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
              {scanning && (
                <p className="scan-scanning-hint">
                  Gemini está analizando el formulario, puede tardar hasta 2 minutos…
                </p>
              )}
            </div>
          )}

          {scanError && (
            <div className="banner banner-error" style={{ marginTop: 12 }}>⚠ {scanError}</div>
          )}
        </div>
      )}
    </div>
  )
}

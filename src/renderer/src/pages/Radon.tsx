import { useState, useEffect } from 'react'
import type { JSX } from 'react'
import { api } from '../lib/api'
import type { Ensayo, EnsayoInput } from '../../../../../main/db'
import { Ic } from '../components/Icon'
import {
  EnsayoCard,
  EnsayoEditor,
  defaultRadonDatos,
  WORD_TIPOS,
  verdictClass
} from './Ensayos'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function Radon(): JSX.Element {
  const [ensayos, setEnsayos] = useState<Ensayo[]>([])
  const [editing, setEditing] = useState<Ensayo | null>(null)
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [lastPath, setLastPath] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  useEffect(() => { load() }, [])

  async function load(): Promise<void> {
    try {
      const list = await api.getEnsayos(null, 'radon_trazas')
      setEnsayos(list)
    } catch (e) {
      setMsg(`Error al cargar campañas: ${errorMessage(e)}`)
    }
  }

  // ── Vista: editor ─────────────────────────────────────────────────────────

  if (editing !== null || creating) {
    const tipo = 'radon_trazas'
    const datosInit = editing ? (editing.datos as Record<string, unknown>) : defaultRadonDatos()
    return (
      <EnsayoEditor
        tipo={tipo}
        datosInit={datosInit}
        tituloInit={editing?.titulo ?? ''}
        responsableInit={editing?.responsable ?? ''}
        estadoInit={editing?.estado ?? 'borrador'}
        planRowIdInit={null}
        nExpedienteInit={editing?.n_expediente ?? ''}
        planRows={[]}
        onSave={async (input: EnsayoInput) => {
          try {
            if (editing) {
              await api.updateEnsayo(editing.id, input)
            } else {
              await api.saveEnsayo(null, input)
            }
            setEditing(null)
            setCreating(false)
            await load()
            setMsg(editing ? 'Campaña actualizada.' : 'Campaña guardada.')
          } catch (e) {
            setMsg(`Error al guardar: ${errorMessage(e)}`)
          }
        }}
        onCancel={() => {
          setEditing(null)
          setCreating(false)
        }}
      />
    )
  }

  // ── Vista: lista ──────────────────────────────────────────────────────────

  const nCumple = ensayos.filter((e) => e.veredicto === 'CUMPLE').length
  const nNoCumple = ensayos.filter((e) => e.veredicto === 'NO CUMPLE').length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Radón — Trazas CR-39</h1>
          <p>
            Campañas de medición de concentración de radón · ISO 11665-4 · IS-47 CSN · PE-CYE-39
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Nueva campaña
        </button>
      </div>

      {msg && (
        <div
          className={`banner ${msg.startsWith('Error') ? 'banner-error' : 'banner-ok'}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <span>{msg}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {lastPath && (
              <button className="btn btn-sm" onClick={() => api.showInFolder(lastPath)}>
                <Ic.Folder /> Abrir carpeta
              </button>
            )}
            <button className="btn btn-sm" onClick={() => { setMsg(null); setLastPath(null) }}>✕</button>
          </div>
        </div>
      )}

      {ensayos.length > 0 && (
        <div className="ensayo-summary-bar" style={{ marginBottom: 20 }}>
          <div className="esb-total">
            <span className="esb-num">{ensayos.length}</span>
            <span className="esb-lbl">campañas</span>
          </div>
          <div className="esb-sep" />
          <div className="esb-completion">
            <div className="esb-cmp-header">
              <span className="esb-lbl">Completadas</span>
              <span className="esb-fraction">
                {ensayos.filter((e) => e.estado === 'completado').length} / {ensayos.length}
              </span>
            </div>
            <div className="esb-bar-track">
              <div
                className="esb-bar-fill"
                style={{
                  width: `${ensayos.length ? Math.round((ensayos.filter((e) => e.estado === 'completado').length / ensayos.length) * 100) : 0}%`
                }}
              />
            </div>
          </div>
          <div className="esb-sep" />
          <div className="esb-verdict esb-verdict-ok">
            <span className="esb-num">{nCumple}</span>
            <span className="esb-lbl">Cumplen</span>
          </div>
          <div className="esb-verdict esb-verdict-fail">
            <span className="esb-num">{nNoCumple}</span>
            <span className="esb-lbl">No cumplen</span>
          </div>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div className="banner banner-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>¿Eliminar esta campaña? Esta acción no se puede deshacer.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await api.deleteEnsayo(confirmDeleteId)
                  setConfirmDeleteId(null)
                  await load()
                  setMsg('Campaña eliminada.')
                } catch (e) {
                  setMsg(`Error al eliminar: ${errorMessage(e)}`)
                  setConfirmDeleteId(null)
                }
              }}
            >
              Confirmar
            </button>
            <button className="btn" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {ensayos.length === 0 ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <p>No hay campañas registradas.</p>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 8 }}>
            Crea una nueva campaña o importa los datos desde el bot de Telegram.
          </p>
        </div>
      ) : (
        <div>
          {ensayos.map((e) => (
            <EnsayoCard
              key={e.id}
              ensayo={e}
              onEdit={() => setEditing(e)}
              onDelete={() => setConfirmDeleteId(e.id)}
              onExportWord={
                WORD_TIPOS.has(e.tipo)
                  ? async () => {
                      try {
                        const path = await api.exportEnsayoWord(e.id)
                        if (path) {
                          setLastPath(path)
                          setMsg('Informe Word generado.')
                        }
                      } catch (err) {
                        setMsg(`Error al exportar: ${errorMessage(err)}`)
                      }
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

import { GeminiProvider } from '../pipeline/llm/gemini'
import * as db from '../db'

export interface AgentIntent {
  type: 'INGEST' | 'ADD_ENSAYO' | 'EXPORT' | 'NAVIGATE' | 'QUERY' | 'MUTATE' | 'AMBIGUOUS' | 'UNKNOWN'
  obraId?: number | null
  projectRef?: string | null
  tipoEnsayo?: string | null
  format?: 'excel' | 'word' | null
  destination?: 'detalle' | 'ensayos' | 'presupuestos' | 'proyectos' | 'radon' | null
  action?: 'archivar' | 'restaurar' | null
  answer?: string | null
  candidates?: Array<{ id: number; nombre: string; n_ensayos: number }> | null
  originalQuery?: string | null
  suggestion?: string | null
  hints?: string | null
  confidence?: number
}

const gemini = new GeminiProvider()

const SYSTEM = `Eres el asistente de CYE, software de control de calidad en obras de construcción (España).
Clasifica la instrucción del usuario en un intent JSON. Responde SOLO con JSON válido, sin markdown ni texto adicional.

INTENTS:
• INGEST — crear nuevo proyecto desde documento(s). Señales: "crea", "nuevo proyecto", "genera plan", "analiza", "presupuesto de". También cuando hay archivos adjuntos y NO se menciona un proyecto existente.
• ADD_ENSAYO — añadir informe de campo a proyecto existente. Señales: "escanea", "añade", "sube", "registra", densidad/placa/hormigón/albarán/granulometría junto a un proyecto.
• EXPORT — exportar Word o Excel. Señales: "exporta", "dame el Excel/Word", "descarga", "genera el informe de".
• NAVIGATE — navegar a una sección o proyecto. Señales: "abre", "ve a", "muéstrame", "ir a".
• QUERY — pregunta sobre datos. Responde con el dato exacto en "answer" usando los proyectos de la lista. Señales: "¿cuántos?", "¿cuál?", "¿qué proyectos?", "lista".
• MUTATE — cambiar estado de proyecto. Señales: "archiva", "restaura", "activa".
• AMBIGUOUS — nombre de proyecto mencionado pero coincide con varios de la lista. Pon todos los candidatos en "candidates".
• UNKNOWN — no interpretable. Pon en "suggestion" una reformulación breve en español.

TIPOS DE ENSAYO (escribe exactamente uno de estos):
densidad_in_situ, placa_carga, toma_hormigon, albaran_ensayos, granulometria, informe_hormigon, albaran_planta, radon_trazas

DESTINOS (campo "destination"):
detalle (página del proyecto), ensayos (informes de campo), presupuestos, proyectos (lista), radon

ESQUEMA (incluye solo los campos aplicables, omite los nulos):
{
  "type": "...",
  "obraId": 3,
  "projectRef": "nombre mencionado por el usuario",
  "tipoEnsayo": "densidad_in_situ",
  "format": "excel",
  "destination": "ensayos",
  "action": "archivar",
  "answer": "Hay 4 proyectos activos",
  "candidates": [{"id":1,"nombre":"Obra A","n_ensayos":3}],
  "originalQuery": "texto original del usuario",
  "suggestion": "Prueba: Crea un proyecto con este PDF",
  "hints": "contexto adicional para el pipeline",
  "confidence": 0.95
}`

export async function interpretCommand(
  userText: string,
  fileNames: string[]
): Promise<AgentIntent> {
  const obras = db.getObras()
  const obraList = obras.length > 0
    ? obras
        .map(o => `  id=${o.id} nombre="${o.obra}" cliente="${o.cliente}" status=${o.status} n_ensayos=${o.n_ensayos}`)
        .join('\n')
    : '  (sin proyectos)'

  const parts: string[] = [`PROYECTOS EN BASE DE DATOS:\n${obraList}`]
  if (fileNames.length > 0) parts.push(`Archivos adjuntos: ${fileNames.join(', ')}`)
  parts.push(`Instrucción: ${userText || '(sin texto — procesa los archivos adjuntos)'}`)

  const raw = await gemini.chat(SYSTEM, parts.join('\n\n'), {
    maxTokens: 512,
    timeoutMs: 15_000,
    tag: 'agent-intent'
  })

  try {
    return JSON.parse(raw) as AgentIntent
  } catch {
    return {
      type: 'UNKNOWN',
      suggestion:
        'No entendí la instrucción. Prueba: "Crea un proyecto con este PDF" o "Exporta el Excel de la obra X".'
    }
  }
}

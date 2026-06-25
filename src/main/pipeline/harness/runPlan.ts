/**
 * Genera plan de ensayos en Excel para un fichero dado.
 * Procesa documentos grandes en chunks para superar el límite de 50k chars
 * del classifier. Uso: tsx src/main/pipeline/harness/runPlan.ts <entrada> <salida.xlsx>
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { extractDocument } from '../extractor'
import { classifyMaterials, extractObraInfo } from '../classifier'
import type { Material } from '../types'
import { generatePlan } from '../planner'
import { generateExcel, type ObraInfo } from '../formatter'
import { loadRules, buildPlanPricer } from './loadKnowledge'
import { GeminiProvider } from '../llm/gemini'
import type { ChatOptions, LlmProvider } from '../llm/types'

const CHUNK_SIZE = 20000

function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const [k, ...rest] = t.split('=')
    const key = k.trim()
    const val = rest.join('=').trim().replace(/^['"]|['"]$/g, '')
    if (key && val && !(key in process.env)) process.env[key] = val
  }
}

/** Divide el texto en chunks cortando por línea completa. */
function chunkByLines(text: string, maxChars: number): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current)
      current = ''
    }
    current += (current ? '\n' : '') + line
  }
  if (current) chunks.push(current)
  return chunks
}

// Palabras clave de líneas que el LLM ignoraría de todos modos —
// filtrarlas aquí reduce el texto antes de enviarlo.
const IGNORAR_RE = /demolici|fresad|levantamiento|desbroce|excav|derribo|desescombro|desmontaje|gestión.*residu|transpor.*tierr|limpieza.*viaria|encofrado|andamio|apuntalamiento|barrera.*hormig.*prefabri|señaliz.*vertic|jardinería|mobiliario urbano|farola|luminari|alumbrado.*vial|cable|telecomunicaci|antena|obra.*civil.*aux|gestión.*obra|gestión.*calidad.*doc/i

/**
 * Compacta el texto de un presupuesto tabular (formato Presto/Fiebdc) a
 * solo las columnas relevantes (ud, descripción, cantidad) y elimina líneas
 * que con seguridad son IGNORAR. Reduce el texto típicamente a ~25%.
 */
function compactBudgetText(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length >= 5) {
      const nat = cols[1]?.trim()
      if (nat === 'Capítulo') continue
      const ud = cols[2]?.trim()
      const desc = cols[3]?.trim()
      const qty = cols[4]?.trim()
      if (!desc || !qty || isNaN(Number(qty))) continue
      if (IGNORAR_RE.test(desc)) continue
      result.push(`${qty} ${ud} ${desc}`)
    } else {
      const t = line.trim()
      if (t && !t.match(/^\d+(\.\d+)?$/) && t.length > 5 && !IGNORAR_RE.test(t)) result.push(t)
    }
  }
  return result.join('\n')
}

/**
 * Fusiona materiales de múltiples chunks:
 * - SERVICIO: deduplica por description, suma quantities idénticas.
 * - TIPO A: agrupa por category+material y suma quantities.
 */
function mergeMaterials(all: Material[][]): Material[] {
  const map = new Map<string, Material>()
  for (const chunk of all) {
    for (const m of chunk) {
      const key = `${m.category}||${m.material?.toLowerCase().trim()}`
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...m })
      } else if (m.quantity != null && existing.quantity != null) {
        existing.quantity += m.quantity
      } else if (m.quantity != null) {
        existing.quantity = m.quantity
      }
    }
  }
  return Array.from(map.values())
}

async function main(): Promise<void> {
  const input = process.argv[2]
  const output = process.argv[3]
  if (!input || !output) {
    console.error('Uso: tsx src/main/pipeline/harness/runPlan.ts <entrada> <salida.xlsx>')
    process.exit(1)
  }
  loadEnv()

  console.log('1) Extrayendo texto…')
  const { text, format } = await extractDocument(resolve(process.cwd(), input))
  console.log(`   formato=${format}, ${text.length} chars`)

  // Usa gemini-2.5-flash con timeout largo — evita el timeout de 120s
  // que dispara gemini-3-flash-preview (modelo lento en preview) para chunks grandes.
  const geminiBase = new GeminiProvider({ model: 'gemini-2.5-flash', apiKey: process.env.GEMINI_API_KEY })
  const provider: LlmProvider = {
    id: 'gemini-2.5-flash',
    chat: (system: string, user: string, opts: ChatOptions = {}) =>
      geminiBase.chat(system, user, { ...opts, timeoutMs: 300_000 })
  }
  const compact = compactBudgetText(text)
  const ratio = Math.round((compact.length / text.length) * 100)
  console.log(`   texto compactado: ${compact.length} chars (${ratio}% del original)`)
  const chunks = chunkByLines(compact, CHUNK_SIZE)
  console.log(`2) Clasificando con LLM (${chunks.length} chunks de ~${CHUNK_SIZE} chars)…`)

  const obra = await extractObraInfo(text)
  const chunkMaterials: Material[][] = []
  for (let i = 0; i < chunks.length; i++) {
    console.log(`   chunk ${i + 1}/${chunks.length}: ${chunks[i].length} chars`)
    chunkMaterials.push(await classifyMaterials(chunks[i], provider))
  }

  const materials = mergeMaterials(chunkMaterials)
  console.log(`   Obra: ${obra.obra}  ·  ${materials.length} materiales tras merge`)
  for (const m of materials) {
    console.log(`     [${m.category}] ${m.material} — ${m.quantity} ${m.unit}`)
  }

  console.log('3) Generando plan…')
  const rules = loadRules()
  const pricer = await buildPlanPricer()
  const plan = await generatePlan(materials, rules, (items) => pricer.priceMany(items))
  const total = plan.reduce((s, r) => s + (r.total ?? 0), 0)
  console.log(
    `   ${plan.filter((r) => r.type === 'test').length} líneas · ` +
      `total s/IVA = €${total.toFixed(2)} · c/IVA = €${(total * 1.21).toFixed(2)}`
  )

  const obraInfo: ObraInfo = {
    obra: obra.obra ?? input,
    cliente: obra.cliente ?? '',
    ref_lab: obra.ref_doc ?? '',
    fecha: new Date().toLocaleDateString('es-ES'),
    responsable: 'J. Quintana'
  }

  const xlsx = await generateExcel(plan, obraInfo)
  writeFileSync(resolve(process.cwd(), output), xlsx)
  console.log(`   Excel → ${output}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

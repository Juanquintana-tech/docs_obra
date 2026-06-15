/**
 * Demo del pipeline de ingesta completo: PDF → extractor → classifier (MiniMax)
 * → planner (con valoración RAG). Imprime los datos de obra, los materiales
 * detectados y el plan valorado.
 *
 * Requiere MINIMAX_API_KEY (en .env del proyecto o variable de entorno).
 *
 *   npm run ingest:demo -- ruta/al/proyecto.pdf
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { extractText } from '../extractor'
import { classifyMaterials, extractObraInfo } from '../classifier'
import { generatePlan } from '../planner'
import { loadRules, buildPricer } from './loadKnowledge'

/** Carga simple de .env (KEY=VALUE) si existe, sin pisar variables ya definidas. */
function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
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
}

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Uso: npm run ingest:demo -- ruta/al/archivo.pdf')
    process.exit(1)
  }
  loadEnv()
  const path = resolve(process.cwd(), arg)

  console.log('1) Extrayendo texto…')
  const { text, totalPages, needsOcr } = await extractText(path)
  console.log(
    `   ${totalPages} págs, ${text.length} caracteres${needsOcr ? ' (¡parece escaneado!)' : ''}`
  )

  console.log('2) Clasificando con el LLM (obra + materiales)…')
  const [obra, materials] = await Promise.all([extractObraInfo(text), classifyMaterials(text)])
  console.log(`   Obra: ${obra.obra ?? '(?)'}  ·  Cliente: ${obra.cliente ?? '(?)'}`)
  console.log(`   ${materials.length} materiales detectados:`)
  for (const m of materials) {
    console.log(`     · [${m.category}] ${m.material} — ${m.quantity ?? '?'} ${m.unit ?? ''}`)
  }

  console.log('3) Generando plan valorado…')
  const rules = loadRules()
  const pricer = await buildPricer()
  const plan = generatePlan(materials, rules, pricer)
  const total = plan.reduce((s, r) => s + (r.total ?? 0), 0)
  console.log(
    `   ${plan.length} líneas de ensayo · total sin IVA = €${total.toFixed(2)} · ` +
      `con IVA = €${(total * 1.21).toFixed(2)}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

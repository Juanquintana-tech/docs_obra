/**
 * Genera plan de ensayos en Excel para un fichero dado.
 * Procesa documentos grandes automáticamente en chunks.
 * Uso: tsx src/main/pipeline/harness/runPlan.ts <entrada> <salida.xlsx>
 */
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { extractDocument } from '../extractor'
import { classifyLargeDocument, extractObraInfo } from '../classifier'
import { generatePlan } from '../planner'
import { generateExcel, type ObraInfo } from '../formatter'
import { loadRules, buildPlanPricer } from './loadKnowledge'

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

  console.log('2) Clasificando con LLM…')
  const [obra, materials] = await Promise.all([
    extractObraInfo(text),
    classifyLargeDocument(text, format, undefined, (done, total) => {
      console.log(`   chunk ${done}/${total}`)
    })
  ])
  console.log(`   Obra: ${obra.obra}  ·  ${materials.length} materiales`)
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

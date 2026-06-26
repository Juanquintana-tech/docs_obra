/**
 * Validación end-to-end sobre los 8 ejemplos (Etapa de cierre).
 *   npm run kb:eval-all
 *
 * Para cada proyecto: Totalizados → extractor LLM → motor por lote → total,
 * comparado con el total real de CYE (eval_projects.json). Secuencial (evita
 * rate-limit de Gemini). Saca tabla + desviación media para cazar errores residuales.
 */
import 'dotenv/config'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { loadKb } from '../../kb/kb'
import { loadNormativeRules } from '../../kb/normative'
import { generatePlan } from '../../kb/engine'
import { extractSections, inferCapa } from '../../kb/kbExtractor'
import type { EvalProject } from '../../kb/types'

const BASE = '/Users/usuario/Desktop/Nigal/Proyects/CYE/DOCS/Presupuestos_completo'

function totalizadosPath(id: string): string | null {
  const dir = join(BASE, `Ejemplo ${id.slice(1)}`)
  try {
    const f = readdirSync(dir).find(
      (x) => x.toLowerCase().includes('totalizado') && /\.xlsx?$/i.test(x)
    )
    return f ? join(dir, f) : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const kb = loadKb()
  const norm = loadNormativeRules()
  const projects = (
    JSON.parse(readFileSync(resolve(process.cwd(), 'resources/knowledge/curated/eval_projects.json'), 'utf-8')) as { projects: EvalProject[] }
  ).projects

  console.log('Validación end-to-end (Totalizados → extractor → motor) vs total real CYE\n')
  const devs: number[] = []
  for (const p of projects) {
    const path = totalizadosPath(p.id)
    if (!path) { console.log(`  ${p.id}  — sin Totalizados`); continue }
    // Referencia = suma de importes de líneas reales (el totalBase guardado puede ser
    // espurio o estar con descuento). Si hay pocas líneas, la referencia es incompleta.
    const realLines = p.sections.reduce((a, s) => a + s.lines.length, 0)
    const real = p.sections.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.importe, 0), 0)
    if (realLines < 10) { console.log(`  ${p.id}  — referencia incompleta (${realLines} líneas), excluido`); continue }
    process.stdout.write(`  ${p.id}  extrayendo… `)
    try {
      const { sections } = await extractSections(path)
      // Inferir capa bituminosa desde el nombre (el extractor ya lo hace, refuerzo).
      for (const s of sections) if (s.categoryCode === 'MEZCLA_BITUMINOSA' && !s.capa) s.capa = inferCapa(s.material ?? '')
      const res = generatePlan(sections, kb, norm)
      const dev = real > 0 ? ((res.totalBase - real) / real) * 100 : 0
      devs.push(Math.abs(dev))
      const review = res.lines.filter((l) => l.needsReview).length
      const sign = dev >= 0 ? '+' : ''
      console.log(
        `motor ${Math.round(res.totalBase).toLocaleString('es-ES').padStart(11)}€  real ${Math.round(real).toLocaleString('es-ES').padStart(11)}€` +
        `  Δ ${sign}${dev.toFixed(0).padStart(4)}%  · ${sections.length} secc · ${res.lines.length} líneas (${review}⚠)` +
        (res.warnings.length ? ` · ${res.warnings.length} avisos` : '')
      )
    } catch (e) {
      console.log(`✗ ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (devs.length) {
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length
    const within10 = devs.filter((d) => d <= 10).length
    console.log(`\nDesviación absoluta media: ${mean.toFixed(1)}%  ·  dentro de ±10%: ${within10}/${devs.length}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

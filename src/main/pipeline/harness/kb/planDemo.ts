/**
 * Validación del motor determinista integrado (modelo por lote + gap-fill).
 *   npm run kb:plan
 *
 * (a) Determinismo.
 * (b) Plan completo de cada proyecto eval vs total real de CYE (con cobertura/flags).
 *
 * Nota: las secciones eval no traen superficie/altura/capa; el motor las estima
 * (superficie) o asume (altura ≥5 m, capa). La paridad fina llega con el extractor (Etapa 3).
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadKb } from '../../kb/kb'
import { loadNormativeRules } from '../../kb/normative'
import { generatePlan, type SectionInput } from '../../kb/engine'
import type { EvalProject } from '../../kb/types'

const kb = loadKb()
const norm = loadNormativeRules()

// ── (a) Determinismo ─────────────────────────────────────────────────────────
const secT: SectionInput[] = [{ tramo: 'T', categoryCode: 'TERRAPLEN_RELLENOS', quantity: 4_400_000, unit: 'm3', heightGe5m: true }]
const r1 = JSON.stringify(generatePlan(secT, kb, norm))
const r2 = JSON.stringify(generatePlan(secT, kb, norm))
console.log(`(a) Determinismo: ${r1 === r2 ? '✓ idéntico' : '✗ FALLO'}`)
if (r1 !== r2) process.exit(1)

// Inferencia simple de capa bituminosa desde el nombre de sección/material.
function inferCapa(name: string): 'rodadura' | 'intermedia' | 'base' | null {
  const t = name.toLowerCase()
  if (/rodadura|surf|bbtm|sma|\bd\b|ac.?\d+.?surf/.test(t)) return 'rodadura'
  if (/intermedia|bin|ac.?\d+.?bin/.test(t)) return 'intermedia'
  if (/base|ac.?\d+.?base|grava\s*cemento/.test(t)) return 'base'
  return null
}

// ── (b) Plan completo por proyecto ──────────────────────────────────────────
const evalProjects = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'resources/knowledge/curated/eval_projects.json'), 'utf-8')) as { projects: EvalProject[] }
).projects

console.log('\n(b) Motor (modelo por lote + gap-fill) vs total real de CYE:\n')
for (const p of evalProjects) {
  const sections: SectionInput[] = p.sections
    .filter((s) => s.category && s.quantity != null)
    .map((s) => ({
      tramo: s.sectionName, categoryCode: s.category!, quantity: s.quantity, unit: s.unit,
      capa: s.category === 'MEZCLA_BITUMINOSA' ? inferCapa(s.sectionName) : null,
    }))
  const covered = sections.length
  if (covered === 0) { console.log(`  ${p.id}  — sin secciones con cantidad (extractor pendiente)`); continue }
  const res = generatePlan(sections, kb, norm)
  const dev = p.totalBase > 0 ? ((res.totalBase - p.totalBase) / p.totalBase) * 100 : 0
  const review = res.lines.filter((l) => l.needsReview).length
  const sign = dev >= 0 ? '+' : ''
  console.log(
    `  ${p.id}  motor ${Math.round(res.totalBase).toLocaleString('es-ES').padStart(11)}€  vs real ${Math.round(p.totalBase).toLocaleString('es-ES').padStart(11)}€` +
    `  Δ ${sign}${dev.toFixed(0).padStart(4)}%  · secc ${covered}/${p.sections.length} · ${res.lines.length} líneas (${review}⚠)`
  )
}
console.log('\n  Δ aún ruidoso: faltan secciones sin cantidad, superficie/altura reales y la capa exacta;')
console.log('  esos datos los aporta el extractor (Etapa 3). Aquí se valida que el motor integrado corre y precia.')

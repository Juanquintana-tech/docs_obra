/**
 * Demostración y validación del motor determinista (Etapa 2).
 *
 *   npm run kb:plan
 *
 * (a) Caso controlado: TERRAPLEN_RELLENOS de 4.400.000 m3 → plan generado.
 * (b) Determinismo: dos ejecuciones → salida idéntica (sale != 0 si falla).
 * (c) Run sobre los proyectos eval: total motor vs total real (con salvedades).
 *
 * Nota: la paridad fina vs CYE real es Etapa 4 (requiere el extractor que
 * provea áreas/volúmenes por tramo). Aquí se valida la LÓGICA del motor.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadKb } from '../../kb/kb'
import { generatePlan, type SectionInput } from '../../kb/engine'
import type { EvalProject } from '../../kb/types'

const kb = loadKb()

// ── (a) Caso controlado ─────────────────────────────────────────────────────
console.log('═══ (a) Caso controlado: TERRAPLEN_RELLENOS · 4.400.000 m3 ═══\n')
const demo = generatePlan(
  [{ tramo: 'Terraplén', categoryCode: 'TERRAPLEN_RELLENOS', quantity: 4_400_000, unit: 'm3' }],
  kb
)
for (const l of demo.lines.slice(0, 12)) {
  const flag = l.needsReview ? ' ⚠' : '  '
  const tot = l.total != null ? `${Math.round(l.total).toLocaleString('es-ES')}€` : '— (sin precio)'
  console.log(
    `${flag} ${String(l.nTests).padStart(4)} × ${String(l.unitPrice ?? '—').padStart(4)}€ = ${tot.padStart(9)}` +
    ` [${l.provenance.priceSource}] · ${l.provenance.freq?.padEnd(14)} · ${l.description.slice(0, 40)}`
  )
}
console.log(`\n  Líneas: ${demo.lines.length} · a revisar: ${demo.lines.filter((l) => l.needsReview).length} · TOTAL: ${Math.round(demo.totalBase).toLocaleString('es-ES')}€`)

// ── (b) Determinismo ─────────────────────────────────────────────────────────
console.log('\n═══ (b) Determinismo ═══')
const r1 = JSON.stringify(generatePlan([{ categoryCode: 'TERRAPLEN_RELLENOS', quantity: 4_400_000, unit: 'm3' }], kb))
const r2 = JSON.stringify(generatePlan([{ categoryCode: 'TERRAPLEN_RELLENOS', quantity: 4_400_000, unit: 'm3' }], kb))
if (r1 !== r2) { console.error('  ✗ FALLO: salidas distintas con mismo input'); process.exit(1) }
console.log('  ✓ mismo input → salida idéntica (byte a byte)')

// ── (c) Run sobre proyectos eval ─────────────────────────────────────────────
console.log('\n═══ (c) Motor vs total real (secciones con categoría+cantidad) ═══')
const evalProjects = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'resources/knowledge/curated/eval_projects.json'), 'utf-8')) as { projects: EvalProject[] }
).projects

for (const p of evalProjects) {
  const sections: SectionInput[] = p.sections
    .filter((s) => s.category && s.quantity != null)
    .map((s) => ({ tramo: s.sectionName, categoryCode: s.category!, quantity: s.quantity, unit: s.unit }))
  const covered = sections.length
  const totalSecs = p.sections.length
  if (covered === 0) {
    console.log(`  ${p.id}  — sin secciones con cantidad conocida (extractor pendiente, Etapa 3)`)
    continue
  }
  const res = generatePlan(sections, kb)
  const dev = p.totalBase > 0 ? ((res.totalBase - p.totalBase) / p.totalBase) * 100 : 0
  const review = res.lines.filter((l) => l.needsReview).length
  console.log(
    `  ${p.id}  motor ${Math.round(res.totalBase).toLocaleString('es-ES').padStart(11)}€  vs real ${Math.round(p.totalBase).toLocaleString('es-ES').padStart(11)}€` +
    `  Δ ${dev >= 0 ? '+' : ''}${dev.toFixed(0)}%  · secciones ${covered}/${totalSecs} · ${res.lines.length} líneas (${review}⚠)`
  )
}
console.log('\n  (Δ grande es esperado aún: muchas secciones sin cantidad y ensayos por área/tongada')
console.log('   que el extractor de Etapa 3 deberá aportar. Aquí lo clave: el motor corre y es determinista.)')

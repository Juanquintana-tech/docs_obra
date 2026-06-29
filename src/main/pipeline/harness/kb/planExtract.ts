/**
 * Validación end-to-end (Etapa 3 + motor): documento de obra → extractor LLM →
 * motor por lote → presupuesto, comparado con el total real de CYE.
 *
 *   npm run kb:extract -- "/ruta/al/Totalizados.xlsx" [totalReal€]
 *
 * Sin argumentos usa el Totalizados de E8 y su total real (1.314.272 €).
 */
import 'dotenv/config'
import { loadKb } from '../../kb/kb'
import { loadNormativeRules } from '../../kb/normative'
import { generatePlan } from '../../kb/engine'
import { extractSections } from '../../kb/kbExtractor'

const DEFAULTS = {
  path: '/Users/usuario/Desktop/Nigal/Proyects/CYE/DOCS/Presupuestos_completo/Ejemplo 8/TOTALIZADOS MELIDE ARZUA.xlsx',
  total: 1_314_272,
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? DEFAULTS.path
  const realTotal = process.argv[3] ? Number(process.argv[3]) : process.argv[2] ? null : DEFAULTS.total

  console.log(`Documento: ${path.split('/').slice(-2).join('/')}`)
  console.log('Extrayendo y clasificando (Gemini→MiniMax)…\n')
  const { sections, skipped } = await extractSections(path)

  console.log(`Secciones extraídas: ${sections.length} (${skipped} descartadas como OTRO/sin categoría)`)
  for (const s of sections) {
    const q = s.quantity != null ? `${s.quantity.toLocaleString('es-ES')} ${s.unit ?? ''}` : '(sin cantidad)'
    const extra = [s.capa ? `capa=${s.capa}` : '', s.heightGe5m != null ? `≥5m=${s.heightGe5m}` : ''].filter(Boolean).join(' ')
    console.log(`  ${s.categoryCode.padEnd(20)} ${q.padStart(16)}  ${(s.material ?? '').slice(0, 34)} ${extra}`)
  }

  const kb = loadKb()
  const norm = loadNormativeRules()
  const res = generatePlan(sections, kb, norm)
  const review = res.lines.filter((l) => l.needsReview).length

  console.log(`\nPlan generado: ${res.lines.length} líneas (${review}⚠) · TOTAL ${Math.round(res.totalBase).toLocaleString('es-ES')} €`)
  if (realTotal) {
    const dev = ((res.totalBase - realTotal) / realTotal) * 100
    console.log(`Total real CYE: ${realTotal.toLocaleString('es-ES')} €  →  Δ ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%`)
  }
  if (res.warnings.length) console.log(`\nAvisos:\n  ${res.warnings.slice(0, 8).join('\n  ')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

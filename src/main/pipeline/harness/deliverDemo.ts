/**
 * Demo de entregables: genera el plan de la lista de materiales de ejemplo y
 * produce el Excel y el Word valorados en /tmp.
 *
 *   npm run deliver:demo
 */
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { generatePlan, type Material } from '../planner'
import { generateExcel, generateWord, type ObraInfo } from '../formatter'
import { loadRules, buildPricer } from './loadKnowledge'

const SAMPLE_MATERIALS: Material[] = [
  { material: 'Terraplén núcleo', category: 'TERRAPLEN_RELLENOS', quantity: 25000, unit: 'm3' },
  {
    material: 'Zahorra artificial ZA-25',
    category: 'ZAHORRA_ARTIFICIAL',
    quantity: 8000,
    unit: 'm3'
  },
  { material: 'Hormigón HA-30 cimentación', category: 'HORMIGON', quantity: 1200, unit: 'm3' }
]

const OBRA: ObraInfo = {
  obra: 'Variante de la N-340',
  cliente: 'MITMA',
  ref_lab: 'LAB-2026-001',
  fecha: '15/06/2026',
  responsable: 'J. Quintana'
}

async function main(): Promise<void> {
  const rules = loadRules()
  const pricer = await buildPricer()
  const plan = await generatePlan(SAMPLE_MATERIALS, rules, pricer)

  const xlsx = await generateExcel(plan, OBRA)
  const docx = generateWord(plan, OBRA)

  const xlsxPath = resolve(tmpdir(), 'cye_plan_demo.xlsx')
  const docxPath = resolve(tmpdir(), 'cye_plan_demo.docx')
  writeFileSync(xlsxPath, xlsx)
  writeFileSync(docxPath, docx)

  console.log(`Plan: ${plan.filter((r) => r.type === 'test').length} líneas de ensayo`)
  console.log(`Excel generado: ${xlsxPath} (${xlsx.length} bytes)`)
  console.log(`Word generado:  ${docxPath} (${docx.length} bytes)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

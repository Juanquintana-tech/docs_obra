import { loadKb } from '../../kb/kb'
import { loadNormativeRules } from '../../kb/normative'
import { generatePlan } from '../../kb/engine'
async function main() {
  const kb = loadKb()
  const norm = loadNormativeRules()
  const plan = await generatePlan([{ categoryCode: 'RIEGO_BITUMINOSO', quantity: 10000, unit: 'm2', tramo: null, material: null, description: null, capa: null, heightGe5m: null }], kb, norm)
  for (const l of plan.lines) {
    if (!l.testId) console.log('NULL testId:', JSON.stringify(l))
    else console.log(l.testId)
  }
}
main().catch(console.error)

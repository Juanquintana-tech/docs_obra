import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadKb } from '../../kb/kb'
import { loadNormativeRules } from '../../kb/normative'
import { generatePlan } from '../../kb/engine'
import type { EvalProject } from '../../kb/types'

async function main() {
  const kb = loadKb()
  const norm = loadNormativeRules()
  const { projects } = JSON.parse(readFileSync(resolve(process.cwd(), 'resources/knowledge/curated/eval_projects.json'), 'utf-8')) as { projects: EvalProject[] }

  for (const p of projects) {
    const line = `═`.repeat(70)
    console.log(`\n${line}\n${p.id}  ${p.name ?? ''}\n${line}`)
    
    const cyeCategories = new Map<string, Set<string>>()
    for (const s of p.sections) {
      const cat = s.categoryCode ?? (s as any).category
      if (!cat) continue
      if (!cyeCategories.has(cat)) cyeCategories.set(cat, new Set())
      for (const l of s.lines) cyeCategories.get(cat)!.add(l.testId)
    }

    for (const [cat, cyeTestIds] of cyeCategories) {
      const input = [{ categoryCode: cat, quantity: 10000, unit: 'm2', tramo: null, material: null, description: null, capa: null, heightGe5m: null }]
      let plan: Awaited<ReturnType<typeof generatePlan>>
      try {
        plan = await generatePlan(input, kb, norm)
      } catch (e) {
        console.log(`  [${cat}]  ERROR: ${(e as Error).message}`)
        continue
      }
      const appTestIds = new Set(plan.lines.map((l: any) => l.testId))
      const missing = [...cyeTestIds].filter(id => !appTestIds.has(id))
      const extra = [...appTestIds].filter(id => !cyeTestIds.has(id))
      const common = [...cyeTestIds].filter(id => appTestIds.has(id))
      
      if (missing.length === 0 && extra.length === 0) {
        console.log(`  [${cat}]  App:${appTestIds.size} | CYE:${cyeTestIds.size} | ✅ perfecto`)
        continue
      }
      console.log(`  [${cat}]  App:${appTestIds.size} | CYE:${cyeTestIds.size} | Coinciden:${common.length}`)
      if (missing.length > 0) {
        console.log(`    ⛔ CYE propone, App no genera (${missing.length}):`)
        for (const id of missing) {
          const t = kb.tests.get(id)
          console.log(`      ${id}  ${t?.name?.slice(0, 60) ?? '?'}`)
        }
      }
      if (extra.length > 0) {
        console.log(`    ➕ App genera, CYE no propone (${extra.length}):`)
        for (const id of extra) {
          const t = kb.tests.get(id)
          console.log(`      ${id}  ${t?.name?.slice(0, 60) ?? '?'}`)
        }
      }
    }
  }
}

main().catch(console.error)

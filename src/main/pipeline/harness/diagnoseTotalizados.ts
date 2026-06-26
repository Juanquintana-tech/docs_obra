import 'dotenv/config'
import { classifyLargeDocument } from '../classifier'
import { extractDocument } from '../extractor'

async function main() {
  const path = '/Users/usuario/Desktop/Nigal/Proyects/CYE/DOCS/Presupuestos_completo/Ejemplo 8/TOTALIZADOS MELIDE ARZUA.xlsx'
  const { text } = await extractDocument(path)
  console.log('=== TEXTO EXTRAÍDO (primeros 1500 chars) ===')
  console.log(text.slice(0, 1500))
  console.log('\n=== MATERIALES CLASIFICADOS ===')
  const mats = await classifyLargeDocument(text, 'xlsx')
  for (const m of mats) {
    const qty = m.quantity != null ? m.quantity.toLocaleString('es-ES') : 'null'
    console.log(`  [${m.category ?? 'SIN_CAT'}]  ${m.material ?? m.description}  qty=${qty} ${m.unit ?? ''}`)
  }
  console.log(`\nTotal: ${mats.length} materiales`)
}
main().catch(e => { console.error(e); process.exit(1) })

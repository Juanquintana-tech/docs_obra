/**
 * Demo del extractor: extrae el texto de un PDF y muestra estadísticas.
 *
 *   npm run extract:demo -- ruta/al/proyecto.pdf
 */
import { resolve } from 'path'
import { extractText } from '../extractor'

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Uso: npm run extract:demo -- ruta/al/archivo.pdf')
    process.exit(1)
  }
  const path = resolve(process.cwd(), arg)
  const r = await extractText(path)
  console.log(`\x1b[1mPDF:\x1b[0m ${path}`)
  console.log(`  páginas: ${r.totalPages}`)
  console.log(`  método: ${r.method}`)
  console.log(`  caracteres extraídos: ${r.text.length}`)
  if (r.needsOcr) {
    console.log(
      '  \x1b[33m⚠ Parece escaneado (poco texto): haría falta OCR (diferido en el prototipo).\x1b[0m'
    )
  }
  console.log('\n\x1b[1m── Primeros 800 caracteres ──\x1b[0m\n' + r.text.slice(0, 800))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

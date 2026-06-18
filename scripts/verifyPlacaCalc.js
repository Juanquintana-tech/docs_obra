/**
 * Verifica el cálculo de Ev y genera la gráfica PNG.
 * Uso: node scripts/verifyPlacaCalc.js
 */
const path = require('path')
const { writeFileSync } = require('fs')

async function main() {
  const { computePlaca } = await import('../src/main/pipeline/ensayos.js').catch(() => ({}))
  const { placaChartPng } = await import('../src/main/pipeline/formatter/placaChart.js').catch(() => ({}))

  if (!computePlaca) {
    // Usar tsx inline
    const { execSync } = require('child_process')
    const result = execSync(`npx tsx --eval "
import { computePlaca } from './src/main/pipeline/ensayos.ts'
const input = {
  radio_mm: 300,
  ciclo1: [
    { presion: 0.000, l1: 0.00, l2: 0.00, l3: 0.00 },
    { presion: 0.036, l1: 0.15, l2: 0.20, l3: 0.30 },
    { presion: 0.075, l1: 0.48, l2: 0.67, l3: 1.10 },
    { presion: 0.107, l1: 0.62, l2: 0.93, l3: 1.62 },
    { presion: 0.143, l1: 0.79, l2: 1.20, l3: 2.09 },
    { presion: 0.175, l1: 0.94, l2: 1.40, l3: 2.48 },
    { presion: 0.214, l1: 1.15, l2: 1.72, l3: 2.96 },
    { presion: 0.250, l1: 1.36, l2: 2.04, l3: 3.32 },
  ],
  descarga: [
    { presion: 0.125,  l1: 1.25, l2: 1.91, l3: 3.18 },
    { presion: 0.0625, l1: 1.08, l2: 1.73, l3: 3.00 },
    { presion: 0.000,  l1: 0.79, l2: 1.43, l3: 2.65 },
  ],
  ciclo2: [
    { presion: 0.036, l1: 0.90, l2: 1.52, l3: 2.77 },
    { presion: 0.075, l1: 1.01, l2: 1.66, l3: 2.91 },
    { presion: 0.107, l1: 1.16, l2: 1.74, l3: 3.00 },
    { presion: 0.143, l1: 1.17, l2: 1.83, l3: 3.10 },
    { presion: 0.175, l1: 1.26, l2: 1.96, l3: 3.24 },
    { presion: 0.214, l1: 1.33, l2: 2.02, l3: 3.30 },
  ]
}
const r = computePlaca(input)
console.log('Ev1:', r.ev1, '(esperado: ~53)')
console.log('Ev2:', r.ev2, '(esperado: ~155)')
console.log('Ev2/Ev1:', r.ratio, '(esperado: ~2.9)')
console.log('Veredicto:', r.veredicto)
"`, { cwd: '/Users/usuario/Desktop/cye-electron', encoding: 'utf8' })
    console.log(result)
    return
  }
}

main().catch(console.error)

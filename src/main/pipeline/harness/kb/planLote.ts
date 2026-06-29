/**
 * Validación del modelo "por lote" (normative.ts + lotEngine.ts) contra valores reales.
 *   npm run kb:lote
 */
import { loadNormativeRules } from '../../kb/normative'
import { computeRule, type LotSection } from '../../kb/lotEngine'

const norm = loadNormativeRules()

function show(title: string, s: LotSection, controlTypes: string[]): void {
  console.log(`\n═══ ${title} ═══`)
  const rules = (norm.get(s.categoryCode) ?? []).filter((r) => controlTypes.includes(r.controlType))
  for (const rule of rules) {
    console.log(`  · ${rule.id} (${rule.controlType}) — ${rule.source}`)
    for (const l of computeRule(s, rule)) {
      const flag = l.review ? '⚠' : ' '
      console.log(`     ${flag} ${String(l.nTests).padStart(5)}  ${l.test.slice(0, 48).padEnd(48)} [${l.detail}]`)
    }
  }
}

// E8 TERRAPLÉN: 4.400.000 m³, terraplén alto (≥5 m). Real: densidad 7350, placa 1470.
show('E8 TERRAPLÉN recepción · 4.400.000 m³ · altura ≥5 m', {
  categoryCode: 'TERRAPLEN_RELLENOS', volume_m3: 4_400_000, heightGe5m: true,
}, ['recepcion'])
console.log('   (Real E8: densidad+humedad in situ 7350 · placa de carga 1470)')

// E8 ZAHORRA: 147.000 m³ → fabricación escalonada.
show('E8 ZAHORRA fabricación · 147.000 m³', {
  categoryCode: 'ZAHORRA_ARTIFICIAL', volume_m3: 147_000,
}, ['fabricacion'])
show('E8 ZAHORRA recepción · 147.000 m³', {
  categoryCode: 'ZAHORRA_ARTIFICIAL', volume_m3: 147_000,
}, ['recepcion'])

// MEZCLA BITUMINOSA fabricación por tonelaje, seleccionando capa (tabla 542.16).
show('MBC fabricación · 45.000 t · capa rodadura', {
  categoryCode: 'MEZCLA_BITUMINOSA', tonnage_t: 45_000, capa: 'rodadura',
}, ['fabricacion'])
show('MBC fabricación · 45.000 t · capa base', {
  categoryCode: 'MEZCLA_BITUMINOSA', tonnage_t: 45_000, capa: 'base',
}, ['fabricacion'])

// Terraplén pequeño (<5 m) para ver el cambio de superficie de lote.
show('Terraplén pequeño · 40.000 m³ · altura <5 m', {
  categoryCode: 'TERRAPLEN_RELLENOS', volume_m3: 40_000, heightGe5m: false,
}, ['recepcion'])

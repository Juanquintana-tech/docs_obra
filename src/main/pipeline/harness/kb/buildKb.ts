/**
 * Build de la BBDD curada: archivos JSON curados → kb.sqlite (artefacto derivado).
 *
 *   npm run kb:build
 *
 * Entrada: resources/knowledge/curated/*.json (fuente de verdad, versionada)
 *          resources/knowledge/test_rules.json (categorías internas)
 * Salida:  resources/knowledge/kb.sqlite (GITIGNORED — reconstruible)
 *
 * Tablas kb_*: categories, tests, prices, aliases, frequency_rules, eval_projects, eval_lines.
 * El motor determinista (Etapa 2) consulta esta BBDD; el LLM nunca la toca.
 */
// node:sqlite (no native ABI): better-sqlite3 está compilado para Electron, no para
// el node del harness. El fichero .sqlite es estándar y better-sqlite3 lo lee en runtime.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, rmSync } from 'fs'
import { resolve } from 'path'
import type { KbTest, KbPrice, KbAlias, KbFrequencyRule, EvalProject } from '../../kb/types'

const CURATED = resolve(process.cwd(), 'resources/knowledge/curated')
const DB_PATH = resolve(process.cwd(), 'resources/knowledge/kb.sqlite')
const TEST_RULES = resolve(process.cwd(), 'resources/knowledge/test_rules.json')

function load<T>(name: string, key: string): T[] {
  const p = resolve(CURATED, name)
  if (!existsSync(p)) throw new Error(`Falta ${name} — ejecuta los importadores primero (kb:import-alagal, kb:import-cye)`)
  return (JSON.parse(readFileSync(p, 'utf-8')) as Record<string, T[]>)[key]
}

interface AlagalCatalog {
  alagalSections: { code: string; name: string }[]
  tests: KbTest[]
  prices: KbPrice[]
}

function main(): void {
  const catalog = JSON.parse(readFileSync(resolve(CURATED, 'alagal_catalog.json'), 'utf-8')) as AlagalCatalog
  const cyeTests = load<KbTest>('cye_tests.json', 'tests')
  const cyePrices = load<KbPrice>('cye_prices.json', 'prices')
  const aliases = load<KbAlias>('aliases.json', 'aliases')
  const rules = load<KbFrequencyRule>('frequency_rules.json', 'rules')
  const evalProjects = load<EvalProject>('eval_projects.json', 'projects')
  const testRules = JSON.parse(readFileSync(TEST_RULES, 'utf-8')) as Record<string, { unit?: string; keywords?: string[] }>

  if (existsSync(DB_PATH)) rmSync(DB_PATH)
  for (const ext of ['-wal', '-shm']) if (existsSync(DB_PATH + ext)) rmSync(DB_PATH + ext)
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')

  db.exec(`
    CREATE TABLE kb_categories (
      code TEXT PRIMARY KEY, name TEXT, default_unit TEXT, keywords TEXT
    );
    CREATE TABLE kb_tests (
      id TEXT PRIMARY KEY, canonical_desc TEXT NOT NULL, norm_codes TEXT,
      alagal_section TEXT, alagal_code TEXT, origin TEXT NOT NULL
    );
    CREATE TABLE kb_prices (
      test_id TEXT NOT NULL, source TEXT NOT NULL, price REAL NOT NULL,
      min REAL, max REAL, n INTEGER,
      PRIMARY KEY (test_id, source)
    );
    CREATE TABLE kb_aliases (
      alias TEXT NOT NULL, test_id TEXT NOT NULL, source TEXT,
      PRIMARY KEY (alias, test_id)
    );
    CREATE TABLE kb_frequency_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category_code TEXT NOT NULL, test_id TEXT NOT NULL,
      muestreo REAL, freq_unit TEXT, freq_kind TEXT, freq_qty REAL, freq_mag_unit TEXT,
      sources INTEGER, raw_desc TEXT
    );
    CREATE TABLE kb_eval_projects (
      id TEXT PRIMARY KEY, nombre TEXT, archivo TEXT, formato TEXT, total_base REAL
    );
    CREATE TABLE kb_eval_lines (
      project_id TEXT, seccion TEXT, section_quantity REAL, section_unit TEXT,
      category_code TEXT, descripcion TEXT, test_id TEXT,
      muestreo REAL, freq_unit TEXT, n_tests INTEGER, precio_unitario REAL, importe REAL
    );
    CREATE INDEX idx_prices_test ON kb_prices(test_id);
    CREATE INDEX idx_rules_cat ON kb_frequency_rules(category_code);
    CREATE INDEX idx_aliases_test ON kb_aliases(test_id);
    CREATE INDEX idx_evallines_proj ON kb_eval_lines(project_id);
  `)

  db.exec('BEGIN')
  {
    // Categorías internas (desde test_rules.json)
    const insCat = db.prepare('INSERT INTO kb_categories VALUES (?,?,?,?)')
    for (const [code, v] of Object.entries(testRules)) {
      insCat.run(code, code.replace(/_/g, ' '), v.unit ?? null, JSON.stringify(v.keywords ?? []))
    }

    // Tests: ALAGAL + CYE-específicos
    const insTest = db.prepare('INSERT OR IGNORE INTO kb_tests VALUES (?,?,?,?,?,?)')
    for (const t of [...catalog.tests, ...cyeTests]) {
      insTest.run(t.id, t.canonicalDesc, JSON.stringify(t.normCodes), t.alagalSection, t.alagalCode, t.origin)
    }

    // Precios: ALAGAL + tarifa_cye
    const insPrice = db.prepare('INSERT OR REPLACE INTO kb_prices VALUES (?,?,?,?,?,?)')
    for (const p of [...catalog.prices, ...cyePrices]) {
      insPrice.run(p.testId, p.source, p.price, p.min ?? null, p.max ?? null, p.n ?? null)
    }

    const insAlias = db.prepare('INSERT OR IGNORE INTO kb_aliases VALUES (?,?,?)')
    for (const a of aliases) insAlias.run(a.alias, a.testId, a.source)

    const insRule = db.prepare('INSERT INTO kb_frequency_rules (category_code,test_id,muestreo,freq_unit,freq_kind,freq_qty,freq_mag_unit,sources,raw_desc) VALUES (?,?,?,?,?,?,?,?,?)')
    for (const r of rules) insRule.run(r.categoryCode, r.testId, r.muestreo, r.freqUnit, r.freqKind, r.freqQty, r.freqMagUnit, r.sources, r.rawDesc)

    const insProj = db.prepare('INSERT INTO kb_eval_projects VALUES (?,?,?,?,?)')
    const insLine = db.prepare('INSERT INTO kb_eval_lines (project_id,seccion,section_quantity,section_unit,category_code,descripcion,test_id,muestreo,freq_unit,n_tests,precio_unitario,importe) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    for (const p of evalProjects) {
      insProj.run(p.id, p.nombre, p.archivo, p.formato, p.totalBase)
      for (const s of p.sections) for (const l of s.lines) {
        insLine.run(p.id, s.sectionName, s.quantity, s.unit, l.categoryCode, l.descripcion, l.testId, l.muestreo, l.freqUnit, l.nTests, l.precioUnitario, l.importe)
      }
    }
  }
  db.exec('COMMIT')

  const count = (t: string): number => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c
  console.log(`BBDD curada construida → ${DB_PATH}\n`)
  for (const t of ['kb_categories', 'kb_tests', 'kb_prices', 'kb_aliases', 'kb_frequency_rules', 'kb_eval_projects', 'kb_eval_lines']) {
    console.log(`  ${t.padEnd(22)} ${count(t)}`)
  }

  // ── Distribución de tipos de frecuencia (calidad de curación) ─────────────
  console.log(`\nTipos de frecuencia (kb_frequency_rules):`)
  const kinds = db.prepare('SELECT freq_kind, COUNT(*) c FROM kb_frequency_rules GROUP BY freq_kind ORDER BY c DESC').all() as Array<{ freq_kind: string; c: number }>
  for (const k of kinds) console.log(`  ${String(k.c).padStart(3)}  ${k.freq_kind}`)

  // ── Consulta de demostración del motor determinista ───────────────────────
  // "Para TERRAPLEN_RELLENOS con 4.400.000 m3: ensayos, lotes calculados y precio."
  const SECTION_QTY = 4_400_000
  console.log(`\nDEMO motor — TERRAPLEN_RELLENOS, sección de ${SECTION_QTY.toLocaleString('es-ES')} m3:`)
  console.log(`  (lotes = ceil(qty / freq_qty) cuando freq es per_quantity; precio CYE > ALAGAL)`)
  const demo = db.prepare(`
    SELECT r.muestreo, r.freq_kind, r.freq_qty, r.freq_mag_unit, r.sources,
           COALESCE(pc.price, pa.price) AS price,
           CASE WHEN pc.price IS NOT NULL THEN 'cye' ELSE 'alagal' END AS price_src,
           t.canonical_desc
    FROM kb_frequency_rules r
    JOIN kb_tests t ON t.id = r.test_id
    LEFT JOIN kb_prices pc ON pc.test_id = r.test_id AND pc.source = 'tarifa_cye'
    LEFT JOIN kb_prices pa ON pa.test_id = r.test_id AND pa.source = 'alagal'
    WHERE r.category_code = 'TERRAPLEN_RELLENOS' AND r.freq_kind = 'per_quantity'
    ORDER BY r.sources DESC LIMIT 8
  `).all() as Array<{ muestreo: number; freq_qty: number; freq_mag_unit: string; sources: number; price: number; price_src: string; canonical_desc: string }>
  for (const d of demo) {
    const lots = d.freq_qty ? Math.ceil(SECTION_QTY / d.freq_qty) : 0
    const nTests = lots * (d.muestreo || 1)
    const importe = nTests * d.price
    console.log(`  ${String(nTests).padStart(4)} ens × ${String(d.price).padStart(4)}€ = ${String(Math.round(importe)).padStart(7)}€ [${d.price_src}] · 1/${d.freq_qty} ${d.freq_mag_unit} · ${d.canonical_desc.slice(0, 38)}`)
  }
  db.close()
}

main()

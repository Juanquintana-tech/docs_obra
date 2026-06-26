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
      muestreo REAL, freq_unit TEXT, sources INTEGER, raw_desc TEXT
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

    const insRule = db.prepare('INSERT INTO kb_frequency_rules (category_code,test_id,muestreo,freq_unit,sources,raw_desc) VALUES (?,?,?,?,?,?)')
    for (const r of rules) insRule.run(r.categoryCode, r.testId, r.muestreo, r.freqUnit, r.sources, r.rawDesc)

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

  // ── Consulta de demostración del motor determinista ───────────────────────
  // "Para TERRAPLEN_RELLENOS: ensayos con su frecuencia y precio (CYE > ALAGAL)"
  console.log(`\nDEMO — TERRAPLEN_RELLENOS (ensayo · muestreo/freq · precio efectivo):`)
  const demo = db.prepare(`
    SELECT r.test_id, r.muestreo, r.freq_unit, r.sources,
           COALESCE(pc.price, pa.price) AS price,
           CASE WHEN pc.price IS NOT NULL THEN 'cye' ELSE 'alagal' END AS price_src,
           t.canonical_desc
    FROM kb_frequency_rules r
    JOIN kb_tests t ON t.id = r.test_id
    LEFT JOIN kb_prices pc ON pc.test_id = r.test_id AND pc.source = 'tarifa_cye'
    LEFT JOIN kb_prices pa ON pa.test_id = r.test_id AND pa.source = 'alagal'
    WHERE r.category_code = 'TERRAPLEN_RELLENOS'
    ORDER BY r.sources DESC LIMIT 8
  `).all() as Array<{ muestreo: number; freq_unit: string; sources: number; price: number; price_src: string; canonical_desc: string }>
  for (const d of demo) {
    console.log(`  ${String(d.price).padStart(5)}€[${d.price_src}] · ${d.muestreo}/${d.freq_unit?.slice(0, 16).padEnd(16)} · (×${d.sources}) ${d.canonical_desc.slice(0, 46)}`)
  }
  db.close()
}

main()

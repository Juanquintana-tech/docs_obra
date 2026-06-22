import type { Database } from 'better-sqlite3'

/**
 * Migraciones secuenciales del esquema. El índice del array = versión destino - 1.
 * MIGRATIONS[0] lleva la DB de la versión 0 (vacía) a la 1, etc.
 *
 * Para evolucionar el esquema: AÑADIR una función nueva al final. Nunca editar
 * una migración ya publicada (rompería las DB de usuarios existentes).
 */
export const MIGRATIONS: Array<(db: Database) => void> = [
  // ── v1 — esquema base portado de cye-demo/db.py + campos nuevos ──────────
  (db) => {
    db.exec(`
      CREATE TABLE obras (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        obra          TEXT    NOT NULL,
        cliente       TEXT    DEFAULT '',
        ref_lab       TEXT    DEFAULT '',
        fecha         TEXT    DEFAULT '',
        coef_baja     REAL    DEFAULT 1.0,
        total_importe REAL    DEFAULT 0.0,
        n_ensayos     INTEGER DEFAULT 0,
        n_materiales  INTEGER DEFAULT 0,
        responsable   TEXT    DEFAULT '',          -- firma/responsable del plan (acreditación)
        created_at    TEXT    DEFAULT (datetime('now','localtime')),
        status        TEXT    DEFAULT 'activa'      -- 'activa' | 'archivada'
      );

      CREATE TABLE plan_rows (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        obra_id          INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
        row_type         TEXT,
        material         TEXT    DEFAULT '',
        subcategory      TEXT    DEFAULT '',
        description      TEXT    DEFAULT '',
        measurement      REAL,
        measurement_unit TEXT    DEFAULT '',
        freq_qty         REAL,
        freq_unit        TEXT    DEFAULT '',
        n_lots           INTEGER,
        tests_per_lot    INTEGER,
        n_tests          INTEGER DEFAULT 0,
        unit_price       REAL    DEFAULT 0.0,
        total            REAL    DEFAULT 0.0,
        -- Confianza explícita de la IA (feature diferenciadora #1):
        price_source     TEXT    DEFAULT 'fallback', -- 'alagal' | 'fallback'
        rag_score        REAL    DEFAULT 0.0,         -- similitud del match [0,1]
        rag_desc         TEXT    DEFAULT ''           -- descripción del catálogo casada
      );
      CREATE INDEX idx_plan_rows_obra ON plan_rows(obra_id);

      -- Informes de ensayo rellenados en obra (un registro por informe).
      -- La columna datos guarda el formulario + resultados como JSON.
      CREATE TABLE ensayos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        obra_id     INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
        tipo        TEXT    NOT NULL,
        titulo      TEXT    DEFAULT '',
        estado      TEXT    DEFAULT 'borrador',     -- 'borrador' | 'completado'
        veredicto   TEXT    DEFAULT '',             -- 'CUMPLE' | 'NO CUMPLE' | ''
        responsable TEXT    DEFAULT '',             -- técnico que firma el informe
        datos       TEXT    NOT NULL DEFAULT '{}',
        created_at  TEXT    DEFAULT (datetime('now','localtime')),
        updated_at  TEXT    DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_ensayos_obra ON ensayos(obra_id);

      -- Bucle de aprendizaje del precio (feature diferenciadora #2):
      -- cuando el usuario corrige un precio/match en la tabla editable, se registra
      -- aquí como ejemplo etiquetado. Sirve de auditoría y alimenta el harness del RAG.
      CREATE TABLE price_corrections (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        query           TEXT    NOT NULL,            -- descripción del ensayo consultada
        category        TEXT    DEFAULT '',
        suggested_code  TEXT    DEFAULT '',          -- código de catálogo que sugirió el RAG
        suggested_price REAL,
        corrected_code  TEXT    DEFAULT '',          -- entrada correcta elegida por el usuario
        corrected_price REAL    NOT NULL,
        obra_id         INTEGER REFERENCES obras(id) ON DELETE SET NULL,
        created_at      TEXT    DEFAULT (datetime('now','localtime'))
      );
    `)
  },

  // ── v2 — libro de precios: rango por fila + estrategia por obra ──────────
  (db) => {
    db.exec(`
      ALTER TABLE plan_rows ADD COLUMN price_min REAL;
      ALTER TABLE plan_rows ADD COLUMN price_max REAL;
      ALTER TABLE obras ADD COLUMN price_strategy TEXT DEFAULT 'reciente';
    `)
  },

  // ── v3 — IVA personalizable por obra ────────────────────────────────────
  (db) => {
    db.exec(`ALTER TABLE obras ADD COLUMN iva_rate REAL DEFAULT 0.21;`)
  },

  // ── v4 — descuento sobre precio de lista (no acumulable) ─────────────────
  // `unit_price_base` guarda el precio de lista (pre-descuento) de cada fila y
  // `discount_pct` el descuento vigente de la obra. Aplicar un descuento siempre
  // se recalcula desde la base, de modo que NUNCA se compone y 0% restaura el
  // precio original. Backfill: la base de las filas existentes = su precio actual.
  (db) => {
    db.exec(`
      ALTER TABLE plan_rows ADD COLUMN unit_price_base REAL;
      ALTER TABLE obras ADD COLUMN discount_pct REAL DEFAULT 0;
      UPDATE plan_rows SET unit_price_base = unit_price WHERE unit_price_base IS NULL;
    `)
  },

  // ── v5 — P2: ciclo plan ↔ ejecución + P3: numeración expediente ───────────
  // `plan_row_id` vincula cada informe de campo a su línea del plan de ensayos
  // (enlace débil: ON DELETE SET NULL para que borrar el plan no pierda informes).
  // `n_expediente` contiene la referencia correlativa del laboratorio (año/NNNN).
  (db) => {
    db.exec(`
      ALTER TABLE ensayos ADD COLUMN plan_row_id INTEGER REFERENCES plan_rows(id) ON DELETE SET NULL;
      ALTER TABLE ensayos ADD COLUMN n_expediente TEXT DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_ensayos_plan_row ON ensayos(plan_row_id);
    `)
  },

  // ── v6 — P3: trazabilidad de muestras (cadena de custodia) ──────────────
  // Tabla muestras enlazada a ensayos; permite registrar origen, localización
  // y estado de cada muestra analizada por el laboratorio.
  (db) => {
    db.exec(`
      CREATE TABLE muestras (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ensayo_id    INTEGER NOT NULL REFERENCES ensayos(id) ON DELETE CASCADE,
        obra_id      INTEGER NOT NULL REFERENCES obras(id)   ON DELETE CASCADE,
        codigo       TEXT    DEFAULT '',
        descripcion  TEXT    DEFAULT '',
        localizacion TEXT    DEFAULT '',
        fecha_toma   TEXT    DEFAULT '',
        estado       TEXT    DEFAULT 'pendiente', -- 'pendiente' | 'en_analisis' | 'analizada'
        created_at   TEXT    DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_muestras_ensayo ON muestras(ensayo_id);
      CREATE INDEX IF NOT EXISTS idx_muestras_obra   ON muestras(obra_id);
    `)
  },

  // ── v7 — trazabilidad del precio: nº de presupuestos históricos por fila ─
  (db) => {
    db.exec(`ALTER TABLE plan_rows ADD COLUMN price_n INTEGER;`)
  }
]

/** Aplica todas las migraciones pendientes dentro de transacciones. */
export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    const run = db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })
    run()
  }
}

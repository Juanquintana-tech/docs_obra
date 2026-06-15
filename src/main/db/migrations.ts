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

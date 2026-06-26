/**
 * Agente editor de presupuesto.
 * Interpreta una instrucción en lenguaje natural sobre el plan de ensayos de una
 * obra ("añade esta categoría con estos ensayos", "elimina este ensayo",
 * "aplica un descuento del 10%") y devuelve una lista de operaciones que la UI
 * previsualiza antes de aplicar. NUNCA muta la DB: solo propone el diff.
 *
 * Los ensayos nuevos sin precio explícito se valoran con el motor de precios
 * (price_book → ALAGAL → fallback) para que entren con €/ud reales.
 */
import { GeminiProvider } from '../pipeline/llm/gemini'
import { CATEGORY_CTX } from '../pipeline/rag/ragPricer'
import { priceTests } from './pipeline'
import * as db from '../db'

// ── Contrato de operaciones ────────────────────────────────────────────────

export interface BudgetNewTest {
  description: string
  n_tests?: number | null
  /** €/ud si el usuario lo indicó explícitamente; si no, lo rellena el motor de precios. */
  unit_price?: number | null
  // Campos resueltos por el motor de precios (los rellena el backend, no el LLM):
  price_source?: 'pricebook' | 'alagal' | 'fallback'
  rag_score?: number
  price_min?: number | null
  price_max?: number | null
  price_n?: number | null
}

export type BudgetOp =
  | { op: 'add_category'; material: string; category?: string | null; tests: BudgetNewTest[] }
  | ({ op: 'add_test'; material: string; category?: string | null } & BudgetNewTest)
  | { op: 'delete'; ids: number[] }
  | {
      op: 'update'
      id: number
      description?: string
      n_tests?: number | null
      unit_price?: number | null
    }
  | { op: 'discount'; pct: number }

export interface BudgetEditPlan {
  operations: BudgetOp[]
  summary: string
  warnings?: string[]
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const CATEGORIES = Object.keys(CATEGORY_CTX)

const SYSTEM = `Eres el editor de presupuestos de CYE, software de control de calidad en obras de construcción (España).
Recibes el PLAN DE ENSAYOS actual de una obra y una instrucción del usuario.
Devuelves SOLO un JSON válido (sin markdown ni texto adicional) con las operaciones a aplicar.

El plan es una tabla de filas; cada fila es un ensayo con: id, material (categoría/sección), descripción, nº de ensayos (n_tests) y precio unitario (unit_price).

OPERACIONES disponibles (incluye solo las necesarias):
• add_category — añade una categoría nueva con uno o más ensayos. Campos: "material" (nombre de la sección, en MAYÚSCULAS), "category" (una de la lista CATEGORIES o null), "tests": [{ "description", "n_tests" }].
• add_test — añade un ensayo a una categoría existente o nueva. Campos: "material", "category", "description", "n_tests".
• delete — elimina ensayos. Campo: "ids": [.. ids exactos de las filas del plan ..]. Resuelve la descripción que da el usuario contra el plan y devuelve los ids que coinciden.
• update — modifica un ensayo existente. Campos: "id" y los campos a cambiar ("description", "n_tests", "unit_price").
• discount — descuento porcentual sobre TODO el presupuesto. Campo: "pct" (0–100). Úsalo siempre que el usuario pida un descuento global; no toques precios fila a fila para esto.

REGLAS:
- NO inventes precios: omite "unit_price" en add_category/add_test salvo que el usuario indique un importe explícito ("a 45€", "45 euros/ud"). El sistema valora los ensayos nuevos automáticamente.
- Si "n_tests" no se indica, ponlo a 1.
- Para delete/update usa SIEMPRE ids reales del plan. Si la descripción del usuario no coincide con ninguna fila, NO inventes id: añádelo a "warnings".
- Si una instrucción coincide con varias filas y es ambiguo cuál borrar, inclúyelas todas en "ids" solo si el usuario claramente se refiere a todas; si no, pon una advertencia en "warnings".
- "summary": frase breve en español describiendo lo que se va a hacer.
- "warnings": lista de avisos (ambigüedades, cosas no encontradas). Omítela si no hay.

CATEGORIES válidas para el campo "category": ${CATEGORIES.join(', ')}

ESQUEMA:
{
  "operations": [
    { "op": "add_category", "material": "HORMIGÓN", "category": "HORMIGON", "tests": [{ "description": "Fabricación y rotura de probetas", "n_tests": 4 }] },
    { "op": "add_test", "material": "ACERO", "category": "ACERO", "description": "Ensayo de tracción", "n_tests": 2 },
    { "op": "delete", "ids": [12, 13] },
    { "op": "update", "id": 7, "n_tests": 6 },
    { "op": "discount", "pct": 10 }
  ],
  "summary": "Añadir categoría Hormigón con 1 ensayo y aplicar 10% de descuento.",
  "warnings": ["No encontré ningún ensayo llamado 'placa de carga' para eliminar."]
}`

// ── Helpers ────────────────────────────────────────────────────────────────

function isAddTest(op: BudgetOp): op is Extract<BudgetOp, { op: 'add_test' }> {
  return op.op === 'add_test'
}
function isAddCategory(op: BudgetOp): op is Extract<BudgetOp, { op: 'add_category' }> {
  return op.op === 'add_category'
}

const gemini = new GeminiProvider()

// ── Punto de entrada ─────────────────────────────────────────────────────────

export async function interpretBudgetEdit(
  obraId: number,
  userText: string
): Promise<BudgetEditPlan> {
  const rows = db.getPlanRows(obraId).filter((r) => r.row_type === 'test')
  const validIds = new Set(rows.map((r) => r.id))

  const planCtx =
    rows.length > 0
      ? rows
          .map(
            (r) =>
              `  id=${r.id} categoria="${r.material}" ensayo="${r.description}" n_tests=${r.n_tests} unit_price=${r.unit_price}`
          )
          .join('\n')
      : '  (presupuesto vacío)'

  const user = `PLAN DE ENSAYOS ACTUAL:\n${planCtx}\n\nInstrucción del usuario: ${userText}`

  const raw = await gemini.chat(SYSTEM, user, {
    maxTokens: 2048,
    timeoutMs: 20_000,
    tag: 'budget-agent'
  })

  let parsed: BudgetEditPlan
  try {
    parsed = JSON.parse(raw) as BudgetEditPlan
  } catch {
    return {
      operations: [],
      summary: 'No pude interpretar la instrucción.',
      warnings: [
        'Reformula, por ejemplo: "Añade la categoría Hormigón con fabricación y rotura de probetas" o "Elimina el ensayo de tracción".'
      ]
    }
  }

  const warnings = [...(parsed.warnings ?? [])]
  const operations: BudgetOp[] = []

  // Validar delete/update contra ids reales; recoger ensayos nuevos a valorar.
  const toPrice: { description: string; category?: string }[] = []
  const priceTargets: { test: BudgetNewTest }[] = []

  for (const op of parsed.operations ?? []) {
    if (op.op === 'delete') {
      const valid = (op.ids ?? []).filter((id) => validIds.has(id))
      const dropped = (op.ids ?? []).filter((id) => !validIds.has(id))
      if (dropped.length)
        warnings.push(`Ignoradas ${dropped.length} línea(s) inexistente(s) al eliminar.`)
      if (valid.length) operations.push({ op: 'delete', ids: valid })
      continue
    }
    if (op.op === 'update') {
      if (!validIds.has(op.id)) {
        warnings.push(`No encontré la línea id=${op.id} para modificar.`)
        continue
      }
      operations.push(op)
      continue
    }
    if (op.op === 'discount') {
      const pct = Math.max(0, Math.min(100, Number(op.pct) || 0))
      operations.push({ op: 'discount', pct })
      continue
    }
    if (isAddCategory(op)) {
      for (const t of op.tests ?? []) {
        if (t.unit_price == null) {
          toPrice.push({ description: t.description, category: op.category ?? undefined })
          priceTargets.push({ test: t })
        }
      }
      operations.push(op)
      continue
    }
    if (isAddTest(op)) {
      if (op.unit_price == null) {
        toPrice.push({ description: op.description, category: op.category ?? undefined })
        priceTargets.push({ test: op })
      }
      operations.push(op)
      continue
    }
  }

  // Valorar en bloque los ensayos nuevos sin precio explícito.
  if (toPrice.length > 0) {
    try {
      const quotes = await priceTests(toPrice)
      quotes.forEach((q, i) => {
        const t = priceTargets[i].test
        t.unit_price = q.precio ?? 0
        t.price_source = q.source
        t.rag_score = q.score
        t.price_min = q.min ?? null
        t.price_max = q.max ?? null
        t.price_n = q.n ?? null
      })
    } catch {
      // Si el motor de precios falla, los ensayos entran a 0 € para editar a mano.
      priceTargets.forEach(({ test }) => {
        if (test.unit_price == null) test.unit_price = 0
      })
      warnings.push(
        'No pude valorar automáticamente los ensayos nuevos; entran a 0 € para revisarlos.'
      )
    }
  }

  return {
    operations,
    summary: parsed.summary ?? 'Cambios propuestos sobre el presupuesto.',
    warnings: warnings.length ? warnings : undefined
  }
}

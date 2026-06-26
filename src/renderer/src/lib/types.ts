/** Re-exporta los tipos de dominio del backend para uso en componentes. */
export type {
  Obra,
  PlanRow,
  GlobalStats,
  ObraInput,
  Ensayo,
  EnsayoInput,
  PlanRowPatch,
  ProgressRow
} from '../../../main/db'
export type { PlanRowInput, Material } from '../../../main/pipeline/types'
export type { PriceStrategy } from '../../../main/pipeline/rag/priceBook'
export type {
  IngestResult,
  RagStatus,
  BudgetSheet,
  BudgetImportResult
} from '../../../main/services/pipeline'
export type { RagMatch } from '../../../main/pipeline/rag/types'
export type { PickedDocument } from '../../../preload/api'
export type { AgentIntent } from '../../../main/services/agent'
export type { BudgetEditPlan, BudgetOp, BudgetNewTest } from '../../../main/services/budgetAgent'

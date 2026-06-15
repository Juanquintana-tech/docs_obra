/** Re-exporta los tipos de dominio del backend para uso en componentes. */
export type { Obra, PlanRow, GlobalStats, ObraInput, Ensayo, EnsayoInput, PlanRowPatch } from '../../../main/db'
export type { PlanRowInput, Material } from '../../../main/pipeline/types'
export type { IngestResult, RagStatus } from '../../../main/services/pipeline'
export type { RagMatch } from '../../../main/pipeline/rag/types'
export type { PickedDocument } from '../../../preload/api'

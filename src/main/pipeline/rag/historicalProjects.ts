/**
 * Carga el corpus de proyectos históricos y calcula similitud con un nuevo proyecto.
 * Similitud basada en categorías de materiales compartidas (Jaccard).
 */
import { readFileSync, existsSync } from 'fs'
import type { Material } from '../types'

export type { HistoricalProject, HistoricalPlanLine, HistoricalSection } from '../harness/buildHistoricalProjects'
import type { HistoricalProject, HistoricalSection } from '../harness/buildHistoricalProjects'

const CLASSIFIER_TO_CATEGORY: Record<string, string> = {
  TERRAPLEN_RELLENOS: 'TERRAPLEN_RELLENOS',
  ZAHORRA_ARTIFICIAL: 'ZAHORRA_ARTIFICIAL',
  SUELO_ESTABILIZADO: 'SUELO_ESTABILIZADO',
  MEZCLA_BITUMINOSA: 'MEZCLA_BITUMINOSA',
  ESCOLLERA: 'ESCOLLERA',
  HORMIGON: 'HORMIGON',
  ACERO: 'ACERO',
  ACERO_LAMINADO: 'ACERO',
  RIEGO_BITUMINOSO: 'RIEGO_BITUMINOSO',
  MARCAS_VIALES: 'MARCAS_VIALES',
  PILOTES: 'PILOTES',
  SERVICIO: 'SERVICIO',
}

let _cache: HistoricalProject[] | null = null

export function loadHistoricalProjects(jsonPath: string): HistoricalProject[] {
  if (_cache) return _cache
  if (!existsSync(jsonPath)) return []
  const { projects } = JSON.parse(readFileSync(jsonPath, 'utf-8')) as {
    projects: HistoricalProject[]
  }
  _cache = projects
  return projects
}

export function invalidateHistoricalCache(): void {
  _cache = null
}

/**
 * Devuelve los k proyectos históricos más similares al nuevo proyecto.
 * Similitud = Jaccard sobre las categorías de materiales.
 */
export function findSimilarProjects(
  materials: Material[],
  projects: HistoricalProject[],
  k = 3
): HistoricalProject[] {
  if (projects.length === 0) return []

  const inputCats = new Set(
    materials
      .map((m) => CLASSIFIER_TO_CATEGORY[m.category ?? ''])
      .filter(Boolean)
  )

  if (inputCats.size === 0) {
    return [...projects].sort((a, b) => b.total_base - a.total_base).slice(0, k)
  }

  const scored = projects.map((p) => {
    const pCats = new Set(p.categories)
    const intersection = [...inputCats].filter((c) => pCats.has(c)).length
    const union = new Set([...inputCats, ...pCats]).size
    const jaccard = union > 0 ? intersection / union : 0
    return { project: p, score: jaccard }
  })

  return scored
    .sort((a, b) => b.score - a.score || b.project.total_base - a.project.total_base)
    .slice(0, k)
    .map((s) => s.project)
}

export interface SectionReference {
  projectId: string
  projectNombre: string
  section: HistoricalSection
}

/**
 * Devuelve todas las secciones históricas que coinciden con una categoría de material.
 * Ordenadas de mayor a menor cantidad (proyectos más grandes primero).
 */
export function getSectionsByCategory(
  projects: HistoricalProject[],
  category: string,
  excludeProjectId?: string
): SectionReference[] {
  const refs: SectionReference[] = []
  const normalizedCat = CLASSIFIER_TO_CATEGORY[category] ?? category

  for (const p of projects) {
    if (p.id === excludeProjectId) continue
    for (const s of p.sections ?? []) {
      if (s.category === normalizedCat) {
        refs.push({ projectId: p.id, projectNombre: p.nombre, section: s })
      }
    }
  }

  // Ordenar: secciones con cantidad conocida primero (más grandes primero)
  return refs.sort((a, b) => {
    const qa = a.section.quantity ?? 0
    const qb = b.section.quantity ?? 0
    return qb - qa
  })
}

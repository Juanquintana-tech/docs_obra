/** Helpers comunes para los scripts del harness (ejecutados con tsx bajo Node). */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { RagPricer } from '../rag/ragPricer'
import type { Rules } from '../planner'

export const KNOWLEDGE_DIR = resolve(process.cwd(), 'resources/knowledge')
export const RULES_PATH = resolve(KNOWLEDGE_DIR, 'test_rules.json')
export const TARIFAS_PATH = resolve(KNOWLEDGE_DIR, 'tarifas_alagal.xlsx')

export function loadRules(): Rules {
  return JSON.parse(readFileSync(RULES_PATH, 'utf-8')) as Rules
}

export async function buildPricer(): Promise<RagPricer> {
  return RagPricer.fromXlsx(TARIFAS_PATH)
}

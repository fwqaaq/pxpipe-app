export type ModelFamily = 'claude' | 'gpt'

export interface ModelCatalogEntry {
  id: string
  label: string
  family: ModelFamily
}

export const DEFAULT_MODEL_BASES = ['claude-fable-5', 'gpt-5.6'] as const

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  { id: 'claude-fable-5', label: 'Fable 5', family: 'claude' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'claude' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'claude' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'claude' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', family: 'claude' },
  { id: 'gpt-5.6', label: 'GPT 5.6', family: 'gpt' },
  { id: 'gpt-5.5', label: 'GPT 5.5', family: 'gpt' }
]

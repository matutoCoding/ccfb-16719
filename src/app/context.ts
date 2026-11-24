import type { Artifact, AssemblyStep, FragmentRecord, PairCandidate, Settings } from '../core/types.ts'

export interface AppState {
  artifacts: Artifact[]
  fragments: FragmentRecord[]
  steps: AssemblyStep[]
  settings: Settings | null
  currentArtifactId: string | null
  pairs: PairCandidate[]
  lastElapsedMs: number | null
  matching: boolean
  progress: { done: number; total: number } | null
}

export interface AppContext {
  state: AppState
  navigate: (hash: string) => void
  refresh: () => Promise<void>
  selectArtifact: (id: string) => Promise<void>
  runAutoMatch: () => Promise<void>
  undoStep: (stepId: string) => Promise<void>
  redoStep: (stepId: string) => Promise<void>
  commitManualMatrix: (id: string, before: number[], after: number[], extra?: Partial<AssemblyStep>) => Promise<void>
  toggleLock: (id: string) => Promise<void>
}

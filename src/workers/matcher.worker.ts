import { buildFeatures, evaluateAllPairs } from '../core/matcher.ts'
import { assembleKruskal } from '../core/assemble.ts'
import { finalizePoses } from '../core/finalize.ts'
import type { FragmentRecord, PairCandidate, Settings, VesselType } from '../core/types.ts'

export interface MatchRequest {
  type: 'match'
  jobId: string
  fragments: FragmentRecord[]
  settings: Settings
  vesselType?: VesselType
  useLathe?: boolean
}

export interface MatchProgress {
  type: 'progress'
  jobId: string
  done: number
  total: number
}

export interface MatchDone {
  type: 'done'
  jobId: string
  pairs: PairCandidate[]
  matrices: Record<string, number[]>
  steps: Array<{ fragmentId: string; pairId: string; score: number; basis: string[] }>
  elapsedMs: number
}

export interface MatchError {
  type: 'error'
  jobId: string
  message: string
}

export type MatchResponse = MatchProgress | MatchDone | MatchError

const ctx = self as unknown as Worker

ctx.onmessage = (event: MessageEvent<MatchRequest>) => {
  const req = event.data
  if (req.type !== 'match') return
  const started = performance.now()
  try {
    const features = req.fragments.map((f) => buildFeatures(f.id, f.mesh))
    const pairs = evaluateAllPairs(features, req.fragments[0]?.artifactId ?? 'artifact', req.settings, (done, total) => {
      const res: MatchResponse = { type: 'progress', jobId: req.jobId, done, total }
      ctx.postMessage(res)
    })

    const threshold = Math.max(35, Math.min(65, req.settings.autoThreshold))
    const assembly = assembleKruskal(req.fragments, pairs, threshold)
    const useAxisConstraint = req.useLathe !== false && req.settings.axisAligned !== false && Boolean(req.vesselType)
    const finalized = !useAxisConstraint || !req.vesselType
      ? assembly.matrices
      : finalizePoses(req.fragments, pairs, req.vesselType)

    const matrices: Record<string, number[]> = {}
    for (const [id, matrix] of finalized) matrices[id] = matrix
    const response: MatchResponse = {
      type: 'done',
      jobId: req.jobId,
      pairs,
      matrices,
      steps: assembly.steps.map((s) => ({
        fragmentId: s.fragmentId,
        pairId: s.pairId,
        score: s.score,
        basis: s.basis,
      })),
      elapsedMs: performance.now() - started,
    }
    ctx.postMessage(response)
  } catch (error) {
    const response: MatchResponse = {
      type: 'error',
      jobId: req.jobId,
      message: error instanceof Error ? error.message : String(error),
    }
    ctx.postMessage(response)
  }
}

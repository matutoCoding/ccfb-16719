import MatcherWorker from '../workers/matcher.worker?worker'
import type { MatchResponse } from '../workers/matcher.worker.ts'
import type { FragmentRecord, Settings, VesselType } from '../core/types.ts'
import { uid } from './ui.ts'

export function runMatching(
  fragments: FragmentRecord[],
  settings: Settings,
  vesselType: VesselType | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<Extract<MatchResponse, { type: 'done' }>> {
  return new Promise((resolve, reject) => {
    const worker = new MatcherWorker()
    const jobId = uid('job')
    worker.onmessage = (event: MessageEvent<MatchResponse>) => {
      const res = event.data
      if (res.jobId !== jobId) return
      if (res.type === 'progress' && res.done && res.total) onProgress?.(res.done, res.total)
      if (res.type === 'done') {
        worker.terminate()
        resolve(res as Extract<MatchResponse, { type: 'done' }>)
      }
      if (res.type === 'error') {
        worker.terminate()
        reject(new Error(res.message ?? '匹配 Worker 执行失败'))
      }
    }
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate()
      reject(event.error ?? new Error(event.message))
    }
    worker.postMessage({ type: 'match', jobId, fragments, settings, vesselType })
  })
}

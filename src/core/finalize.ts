import { fitLatheTranslation } from './lathe.ts'
import { matInvertRigid, matMultiply } from './math.ts'
import type { Mat4 } from './math.ts'
import type { FragmentRecord, PairCandidate, VesselType } from './types.ts'

// 先用旋转器型约束定位可靠碎片，再沿高分候选把拟合失败/退化小片传播到位。
export function finalizePoses(
  fragments: FragmentRecord[],
  pairs: PairCandidate[],
  type: VesselType,
  latheRmsThreshold = 0.8,
): Map<string, Mat4> {
  const matrices = new Map<string, Mat4>()
  const fixed = new Set<string>()

  for (const f of fragments) {
    if (f.locked) {
      matrices.set(f.id, f.matrix)
      fixed.add(f.id)
      continue
    }
    const fit = fitLatheTranslation(f.mesh, type)
    if (fit.rms < latheRmsThreshold) {
      matrices.set(f.id, fit.matrix)
      fixed.add(f.id)
    }
  }

  let changed = true
  while (changed && fixed.size < fragments.length) {
    changed = false
    let best: { id: string; matrix: Mat4; score: number } | null = null
    for (const p of pairs) {
      const aFixed = fixed.has(p.aId)
      const bFixed = fixed.has(p.bId)
      if (aFixed && !bFixed) {
        const ma = matrices.get(p.aId)!
        const matrix = matMultiply(ma, p.relative)
        if (!best || p.score > best.score) best = { id: p.bId, matrix, score: p.score }
      } else if (bFixed && !aFixed) {
        const mb = matrices.get(p.bId)!
        const matrix = matMultiply(mb, matInvertRigid(p.relative))
        if (!best || p.score > best.score) best = { id: p.aId, matrix, score: p.score }
      }
    }
    if (best) {
      matrices.set(best.id, best.matrix)
      fixed.add(best.id)
      changed = true
    }
  }

  for (const f of fragments) {
    if (!matrices.has(f.id)) matrices.set(f.id, f.matrix)
  }
  return matrices
}

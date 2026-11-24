import { matInvertRigid, matMultiply, matIdentity, matTranslation, matTranslationVec, matRotationAngle, transformPoint } from './math.ts'
import type { Mat4, Vec3 } from './math.ts'
import { kabsch } from './kabsch.ts'
import type { PairCandidate } from './types.ts'

export interface AssemblyLikeFragment {
  id: string
  locked?: boolean
  matrix: Mat4
}

export interface AssemblyResult {
  matrices: Map<string, Mat4>
  attached: string[]
  steps: Array<{ fragmentId: string; pairId: string; score: number; matrix: Mat4; basis: string[] }>
  unused: string[]
}

export function assembleGreedy(
  fragments: AssemblyLikeFragment[],
  candidates: PairCandidate[],
  threshold = 58,
): AssemblyResult {
  const matrices = new Map<string, Mat4>()
  const placed = new Set<string>()
  const attached: string[] = []
  const steps: AssemblyResult['steps'] = []

  // 已锁定/人工修正的碎片作为固定坐标系节点
  for (const f of fragments) {
    if (f.locked) {
      matrices.set(f.id, f.matrix)
      placed.add(f.id)
      attached.push(f.id)
    }
  }

  const pairMap = new Map<string, PairCandidate>()
  for (const p of candidates) pairMap.set(p.id, p)

  const attach = (fragmentId: string, matrix: Mat4, pair: PairCandidate) => {
    matrices.set(fragmentId, matrix)
    placed.add(fragmentId)
    attached.push(fragmentId)
    steps.push({ fragmentId, pairId: pair.id, score: pair.score, matrix, basis: pair.basis })
  }

  // 没有锁定基准时，从得分最高的一对开始
  if (placed.size === 0) {
    const first = candidates.find((p) => p.score >= threshold) ?? candidates[0]
    if (first) {
      matrices.set(first.aId, matIdentity())
      placed.add(first.aId)
      attached.push(first.aId)
      const mb = matMultiply(matIdentity(), first.relative)
      attach(first.bId, mb, first)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const pair of candidates) {
      if (pair.score < threshold) continue
      const aPlaced = placed.has(pair.aId)
      const bPlaced = placed.has(pair.bId)
      if (aPlaced && bPlaced) continue

      if (aPlaced && !bPlaced) {
        const ma = matrices.get(pair.aId)!
        attach(pair.bId, matMultiply(ma, pair.relative), pair)
        changed = true
        break
      }
      if (bPlaced && !aPlaced) {
        const mb = matrices.get(pair.bId)!
        // MA * X = MB * X^{-1}? 其中 X 把 B 局部坐标变到 A 局部坐标
        const ma = matMultiply(mb, matInvertRigid(pair.relative))
        attach(pair.aId, ma, pair)
        changed = true
        break
      }
    }
  }

  const unused = fragments.map((f) => f.id).filter((id) => !placed.has(id))
  return { matrices, attached, steps, unused }
}

function solveSymmetricSystem(matrix: number[][], rhs: number[][]): number[][] {
  const n = matrix.length
  const a = matrix.map((row, i) => [...row, ...rhs[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const pivotValue = a[col][col] || 1e-9
    for (let k = col; k <= n + 2; k++) a[col][k] /= pivotValue
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      for (let k = col; k <= n + 2; k++) a[row][k] -= factor * a[col][k]
    }
  }
  return Array.from({ length: 3 }, (_, axis) => a.map((row) => row[n + axis]))
}

// 轴归一化后只有平移：对所有候选约束做稳健最小二乘，利用网格环闭合平均误差并踢掉误配
export function assembleTranslationGraph(
  fragments: AssemblyLikeFragment[],
  candidates: PairCandidate[],
  threshold = 45,
): AssemblyResult {
  const ids = fragments.map((f) => f.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  type Edge = { p: PairCandidate; a: number; b: number; d: Vec3; active: boolean; residual: number }
  let edges: Edge[] = candidates
    .filter((p) => p.score >= threshold && index.has(p.aId) && index.has(p.bId))
    .map((p) => ({
      p,
      a: index.get(p.aId)!,
      b: index.get(p.bId)!,
      d: [p.relative[12], p.relative[13], p.relative[14]] as Vec3,
      active: true,
      residual: 0,
    }))

  let positions: Vec3[] = ids.map(() => [0, 0, 0])
  for (let round = 0; round < 5; round++) {
    const n = ids.length
    const lap = Array.from({ length: n }, () => new Array(n).fill(0))
    const rhs: number[][] = Array.from({ length: n }, () => [0, 0, 0])
    for (const e of edges) {
      if (!e.active) continue
      const w = Math.max(0.1, e.p.score / 100)
      lap[e.a][e.a] += w
      lap[e.b][e.b] += w
      lap[e.a][e.b] -= w
      lap[e.b][e.a] -= w
      for (let k = 0; k < 3; k++) {
        rhs[e.a][k] -= w * e.d[k]
        rhs[e.b][k] += w * e.d[k]
      }
    }
    // 固定整体平移基准，不影响真值对齐后的误差
    lap[0][0] += 1e6
    const solved = solveSymmetricSystem(lap, rhs)
    positions = ids.map((_, i) => [solved[0][i], solved[1][i], solved[2][i]])

    for (const e of edges) {
      if (!e.active) continue
      e.residual = Math.hypot(
        positions[e.b][0] - positions[e.a][0] - e.d[0],
        positions[e.b][1] - positions[e.a][1] - e.d[1],
        positions[e.b][2] - positions[e.a][2] - e.d[2],
      )
    }
    const residuals = edges.filter((e) => e.active).map((e) => e.residual).sort((a, b) => a - b)
    const median = residuals[Math.floor(residuals.length / 2)] ?? 0
    const cutoff = Math.max(1.4, median * 4)
    let removed = false
    for (const e of edges) {
      if (e.active && e.residual > cutoff && e.residual > 2.2) {
        e.active = false
        removed = true
      }
    }
    if (!removed) break
  }

  const matrices = new Map(ids.map((id, i) => [id, matTranslation(positions[i])]))
  const activePairs = edges.filter((e) => e.active).map((e) => e.p)
  const tree = assembleKruskal(fragments, activePairs, -Infinity)
  // 用全局求解结果覆盖生成树的链式累积位姿
  for (const [id, m] of matrices) tree.matrices.set(id, m)
  return { ...tree, matrices }
}

export function assembleKruskal(
  fragments: AssemblyLikeFragment[],
  candidates: PairCandidate[],
  threshold = 42,
): AssemblyResult {
  const ids = fragments.map((f) => f.id)
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = id
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }

  const selected: PairCandidate[] = []
  for (const p of candidates) {
    if (p.score < threshold) break
    const ra = find(p.aId)
    const rb = find(p.bId)
    if (ra === rb) continue
    parent.set(ra, rb)
    selected.push(p)
    if (selected.length >= ids.length - 1) break
  }

  const adjacency = new Map<string, Array<{ other: string; pair: PairCandidate; orientation: 'a' | 'b' }>>()
  for (const id of ids) adjacency.set(id, [])
  for (const pair of selected) {
    adjacency.get(pair.aId)!.push({ other: pair.bId, pair, orientation: 'a' })
    adjacency.get(pair.bId)!.push({ other: pair.aId, pair, orientation: 'b' })
  }

  const matrices = new Map<string, Mat4>()
  const visited = new Set<string>()
  const steps: AssemblyResult['steps'] = []
  const attached: string[] = []

  for (const root of ids) {
    if (visited.has(root)) continue
    visited.add(root)
    matrices.set(root, matIdentity())
    attached.push(root)
    const queue = [root]
    while (queue.length) {
      const id = queue.shift()!
      const current = matrices.get(id)!
      for (const edge of adjacency.get(id) ?? []) {
        if (visited.has(edge.other)) continue
        visited.add(edge.other)
        let world: Mat4
        if (edge.orientation === 'a') {
          // 当前 id 是 a，邻居是 b：Wb = Wa * X
          world = matMultiply(current, edge.pair.relative)
        } else {
          // 当前 id 是 b，邻居是 a：Wa = Wb * X^-1
          world = matMultiply(current, matInvertRigid(edge.pair.relative))
        }
        matrices.set(edge.other, world)
        attached.push(edge.other)
        steps.push({
          fragmentId: edge.other,
          pairId: edge.pair.id,
          score: edge.pair.score,
          matrix: world,
          basis: edge.pair.basis,
        })
        queue.push(edge.other)
      }
    }
  }

  return { matrices, attached, steps, unused: ids.filter((id) => !matrices.has(id)) }
}

export interface SnapResult {
  matrix: Mat4
  candidate: PairCandidate
  distance: number
}

// 依据另一片的当前矩阵，反推当前片的吸附位姿
export function findSnapPose(
  fragmentId: string,
  currentMatrix: Mat4,
  fragments: AssemblyLikeFragment[],
  candidates: PairCandidate[],
  maxDistance = 80,
): SnapResult | null {
  const byId = new Map(fragments.map((f) => [f.id, f]))
  const currentPos = matTranslationVec(currentMatrix)
  let best: SnapResult | null = null

  for (const pair of candidates) {
    let target: Mat4 | null = null
    if (pair.aId === fragmentId) {
      const b = byId.get(pair.bId)
      if (!b) continue
      target = matMultiply(b.matrix, matInvertRigid(pair.relative))
    } else if (pair.bId === fragmentId) {
      const a = byId.get(pair.aId)
      if (!a) continue
      target = matMultiply(a.matrix, pair.relative)
    }
    if (!target) continue
    const pos = matTranslationVec(target)
    const distance = Math.hypot(pos[0] - currentPos[0], pos[1] - currentPos[1], pos[2] - currentPos[2])
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { matrix: target, candidate: pair, distance }
    }
  }
  return best
}

export interface ErrorReport {
  globalAlignment: Mat4
  maxPositionErrorMm: number
  meanPositionErrorMm: number
  maxAngleErrorDeg: number
  meanAngleErrorDeg: number
  perFragment: Array<{ id: string; positionMm: number; angleDeg: number }>
}

// 拼对结果存在整体刚体坐标系自由度，评估前用所有质心做一次全局对齐
export function evaluateAgainstTruth(
  truth: Array<{ id: string; truthMatrix: Mat4 }>,
  output: Map<string, Mat4>,
  translationOnly = false,
): ErrorReport {
  const ids = truth.filter((t) => output.has(t.id)).map((t) => t.id)
  const source: Vec3[] = ids.map((id) => matTranslationVec(output.get(id)!))
  const target: Vec3[] = ids.map((id) => matTranslationVec(truth.find((t) => t.id === id)!.truthMatrix))
  let aligned: Mat4
  if (translationOnly) {
    const cs: Vec3 = [0, 0, 0]
    const ct: Vec3 = [0, 0, 0]
    for (let i = 0; i < ids.length; i++) {
      cs[0] += source[i][0]; cs[1] += source[i][1]; cs[2] += source[i][2]
      ct[0] += target[i][0]; ct[1] += target[i][1]; ct[2] += target[i][2]
    }
    const n = Math.max(1, ids.length)
    aligned = matTranslation([(ct[0] - cs[0]) / n, (ct[1] - cs[1]) / n, (ct[2] - cs[2]) / n])
  } else {
    aligned = kabsch(source, target).matrix
  }

  const perFragment = ids.map((id) => {
    const m = matMultiply(aligned, output.get(id)!)
    const t = truth.find((x) => x.id === id)!.truthMatrix
    const mp = matTranslationVec(m)
    const tp = matTranslationVec(t)
    const positionMm = Math.hypot(mp[0] - tp[0], mp[1] - tp[1], mp[2] - tp[2])
    const delta = matMultiply(m, matInvertRigid(t))
    const angleDeg = matRotationAngle(delta) * 180 / Math.PI
    return { id, positionMm, angleDeg }
  })

  const pos = perFragment.map((x) => x.positionMm)
  const ang = perFragment.map((x) => x.angleDeg)
  return {
    globalAlignment: aligned,
    maxPositionErrorMm: Math.max(...pos),
    meanPositionErrorMm: pos.reduce((a, b) => a + b, 0) / Math.max(1, pos.length),
    maxAngleErrorDeg: Math.max(...ang),
    meanAngleErrorDeg: ang.reduce((a, b) => a + b, 0) / Math.max(1, ang.length),
    perFragment,
  }
}

export function transformedCentroidError(
  meshCentroid: Vec3,
  truth: Mat4,
  alignedOutput: Mat4,
): number {
  const p = transformPoint(alignedOutput, meshCentroid)
  const q = transformPoint(truth, meshCentroid)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

import { extractContours } from './contours.ts'
import type { ContourSegment } from './contours.ts'
import { kabsch } from './kabsch.ts'
import { matMultiply, matRotationAngle, matTranslation, transformPoint, v3 } from './math.ts'
import type { Mat4, Vec3 } from './math.ts'
import type { PairCandidate, ScoreParts, Settings } from './types.ts'

export interface FragmentFeatures {
  id: string
  contours: ContourSegment[]
  fracturePoints: Vec3[]
}

export function buildFeatures(id: string, mesh: Parameters<typeof extractContours>[0]): FragmentFeatures {
  const used = new Set<number>()
  for (let f = 0; f < mesh.faceKinds.length; f++) {
    if (mesh.faceKinds[f] !== 3) continue
    used.add(mesh.indices[f * 3])
    used.add(mesh.indices[f * 3 + 1])
    used.add(mesh.indices[f * 3 + 2])
  }
  const fracturePoints = [...used].map((vi) => [
    mesh.positions[vi * 3],
    mesh.positions[vi * 3 + 1],
    mesh.positions[vi * 3 + 2],
  ] as Vec3)
  return { id, contours: extractContours(mesh), fracturePoints }
}

function rotateOnly(m: Mat4, n: Vec3): Vec3 {
  return v3.norm([
    m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
    m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
    m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
  ])
}

function curvatureSignature(points: Vec3[]): number[] {
  const out: number[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const t0 = v3.norm(v3.sub(points[i], points[i - 1]))
    const t1 = v3.norm(v3.sub(points[i + 1], points[i]))
    const dot = Math.max(-1, Math.min(1, v3.dot(t0, t1)))
    const ds = Math.max(0.5, (v3.dist(points[i - 1], points[i]) + v3.dist(points[i], points[i + 1])) * 0.5)
    out.push(Math.acos(dot) / ds)
  }
  return out
}

function scoreCurvature(a: Vec3[], b: Vec3[]): number {
  const ca = curvatureSignature(a)
  const cb = curvatureSignature(b)
  let sum = 0
  for (let i = 0; i < ca.length; i++) {
    const d = ca[i] - cb[i]
    sum += d * d
  }
  const rmse = Math.sqrt(sum / Math.max(1, ca.length))
  return 100 * Math.exp(-rmse * rmse / (2 * 0.018 * 0.018))
}

function scoreNormals(a: ContourSegment, b: ContourSegment, m: Mat4): number {
  let sum = 0
  for (let i = 0; i < a.normals.length; i++) {
    const nb = rotateOnly(m, b.normals[i])
    sum += Math.max(-1, Math.min(1, v3.dot(a.normals[i], nb)))
  }
  const avg = sum / a.normals.length
  const angle = Math.acos(Math.max(-1, Math.min(1, avg)))
  return 100 * Math.exp(-angle * angle / (2 * 0.22 * 0.22))
}

function scorePattern(a: ContourSegment, b: ContourSegment): number {
  let sum = 0
  for (let i = 0; i < a.colors.length; i++) {
    const ca = a.colors[i]
    const cb = b.colors[i]
    const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])
    sum += d * d
  }
  const rmse = Math.sqrt(sum / a.colors.length)
  return 100 * Math.exp(-rmse * rmse / (2 * 0.13 * 0.13))
}

function fractureSupport(
  sourcePoints: Vec3[],
  targetPoints: Vec3[],
  m: Mat4,
): { score: number; inliers: number; median: number } {
  if (!sourcePoints.length || !targetPoints.length) return { score: 0, inliers: 0, median: 99 }
  const sourceStep = Math.max(1, Math.ceil(sourcePoints.length / 90))
  const targetStep = Math.max(1, Math.ceil(targetPoints.length / 170))
  const target = targetPoints.filter((_, i) => i % targetStep === 0)
  const distances: number[] = []
  let inliers = 0
  let tested = 0
  for (let i = 0; i < sourcePoints.length; i += sourceStep) {
    const sp = transformPoint(m, sourcePoints[i])
    let best = Infinity
    for (const tp of target) {
      const d = v3.dist(sp, tp)
      if (d < best) best = d
    }
    distances.push(best)
    if (best < 0.85) inliers++
    tested++
  }
  distances.sort((a, b) => a - b)
  const quarterCount = Math.max(8, Math.floor(distances.length * 0.28))
  const quarterMean = distances.slice(0, quarterCount).reduce((s, x) => s + x, 0) / quarterCount
  const median = distances[Math.floor(distances.length / 2)] ?? 99
  const score = 100 * Math.exp(-quarterMean * quarterMean / (2 * 0.34 * 0.34))
  return { score, inliers: Math.round((inliers / Math.max(1, tested)) * 100), median }
}

function indexedRms(m: Mat4, source: Vec3[], target: Vec3[]): number {
  let sum = 0
  for (let i = 0; i < source.length; i++) {
    const p = transformPoint(m, source[i])
    const d = v3.dist(p, target[i])
    sum += d * d
  }
  return Math.sqrt(sum / source.length)
}

function icpRefine(source: Vec3[], target: Vec3[], initial: Mat4): { matrix: Mat4; rms: number } {
  let matrix = initial
  for (let iter = 0; iter < 7; iter++) {
    const srcCorr: Vec3[] = []
    const dstCorr: Vec3[] = []
    let maxDist = 0
    for (const p of source) {
      const sp = transformPoint(matrix, p)
      let best = Infinity
      let bp = target[0]
      for (const q of target) {
        const d = v3.dist(sp, q)
        if (d < best) {
          best = d
          bp = q
        }
      }
      maxDist = Math.max(maxDist, best)
      if (best < 10) {
        srcCorr.push(p)
        dstCorr.push(bp)
      }
    }
    if (srcCorr.length < 12) break
    const solved = kabsch(srcCorr, dstCorr)
    matrix = solved.matrix
    if (solved.rms < 0.03) break
  }
  return { matrix, rms: indexedRms(matrix, source, target) }
}

function icpTranslate(source: Vec3[], target: Vec3[], initial: Mat4): { matrix: Mat4; rms: number } {
  let tx = initial[12]
  let ty = initial[13]
  let tz = initial[14]
  for (let iter = 0; iter < 8; iter++) {
    let sx = 0
    let sy = 0
    let sz = 0
    let count = 0
    for (const p of source) {
      const sp: Vec3 = [p[0] + tx, p[1] + ty, p[2] + tz]
      let best = Infinity
      let bq: Vec3 | null = null
      for (const q of target) {
        const d = v3.dist(sp, q)
        if (d < best) {
          best = d
          bq = q
        }
      }
      if (bq && best < 12) {
        sx += bq[0] - p[0]
        sy += bq[1] - p[1]
        sz += bq[2] - p[2]
        count++
      }
    }
    if (count < 12) break
    tx = sx / count
    ty = sy / count
    tz = sz / count
  }
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]
  return { matrix, rms: indexedRms(matrix, source, target) }
}

interface RefinedWindow {
  matrix: Mat4
  rms: number
  aPoints: Vec3[]
  bPoints: Vec3[]
  aNormals: Vec3[]
  bNormals: Vec3[]
  aColors: Vec3[]
  bColors: Vec3[]
}

// 两个窗口的起点不一定对齐，枚举弧长方向的索引偏移，再做平移 ICP
function refineWindow(raw: RawMatch, a: ContourSegment, b: ContourSegment): RefinedWindow {
  const bp0 = raw.reverse ? [...b.points].reverse() : b.points
  const bn0 = raw.reverse ? [...b.normals].reverse() : b.normals
  const bc0 = raw.reverse ? [...b.colors].reverse() : b.colors
  const n = a.points.length
  let best: { shift: number; rms: number; tx: number; ty: number; tz: number } | null = null

  for (let shift = -11; shift <= 11; shift++) {
    const startA = Math.max(0, -shift)
    const endA = Math.min(n, n - shift)
    const count = endA - startA
    if (count < 18) continue
    let tx = 0
    let ty = 0
    let tz = 0
    for (let i = startA; i < endA; i++) {
      const j = i + shift
      tx += a.points[i][0] - bp0[j][0]
      ty += a.points[i][1] - bp0[j][1]
      tz += a.points[i][2] - bp0[j][2]
    }
    tx /= count; ty /= count; tz /= count
    let sum = 0
    for (let i = startA; i < endA; i++) {
      const j = i + shift
      const dx = bp0[j][0] + tx - a.points[i][0]
      const dy = bp0[j][1] + ty - a.points[i][1]
      const dz = bp0[j][2] + tz - a.points[i][2]
      sum += dx * dx + dy * dy + dz * dz
    }
    const rms = Math.sqrt(sum / count)
    if (!best || rms < best.rms) best = { shift, rms, tx, ty, tz }
  }

  const shift = best?.shift ?? 0
  const startA = Math.max(0, -shift)
  const endA = Math.min(n, n - shift)
  const aPoints = a.points.slice(startA, endA)
  const bPoints = bp0.slice(startA + shift, endA + shift)
  const aNormals = a.normals.slice(startA, endA)
  const bNormals = bn0.slice(startA + shift, endA + shift)
  const aColors = a.colors.slice(startA, endA)
  const bColors = bc0.slice(startA + shift, endA + shift)
  const initial = matTranslation([best?.tx ?? raw.matrix[12], best?.ty ?? raw.matrix[13], best?.tz ?? raw.matrix[14]])
  const icp = icpTranslate(bPoints, aPoints, initial)
  return {
    matrix: icp.matrix,
    rms: indexedRms(icp.matrix, bPoints, aPoints),
    aPoints,
    bPoints,
    aNormals,
    bNormals,
    aColors,
    bColors,
  }
}

interface RawMatch {
  aSegment: number
  bSegment: number
  reverse: boolean
  matrix: Mat4
  rms: number
  contour: number
  curvature: number
  surface: number
  pattern: number
  support?: number
  inliers?: number
  refined?: RefinedWindow
}

function evaluateOrientation(
  a: ContourSegment,
  b: ContourSegment,
  aIndex: number,
  bIndex: number,
  reverse: boolean,
  translationOnly: boolean,
): RawMatch | null {
  const bPoints = reverse ? [...b.points].reverse() : b.points
  const bNormals = reverse ? [...b.normals].reverse() : b.normals
  const bColors = reverse ? [...b.colors].reverse() : b.colors
  const bVariant: ContourSegment = { ...b, points: bPoints, normals: bNormals, colors: bColors }

  let matrix: Mat4
  if (translationOnly) {
    let tx = 0
    let ty = 0
    let tz = 0
    for (let i = 0; i < a.points.length; i++) {
      tx += a.points[i][0] - bVariant.points[i][0]
      ty += a.points[i][1] - bVariant.points[i][1]
      tz += a.points[i][2] - bVariant.points[i][2]
    }
    const n = a.points.length
    matrix = matTranslation([tx / n, ty / n, tz / n])
  } else {
    matrix = kabsch(bVariant.points, a.points).matrix
  }
  if (!Number.isFinite(matrix[12])) return null
  const rms = indexedRms(matrix, b.points, a.points)
  return {
    aSegment: aIndex,
    bSegment: bIndex,
    reverse,
    matrix,
    rms,
    contour: 100 * Math.exp(-rms * rms / (2 * 0.55 * 0.55)),
    curvature: scoreCurvature(a.points, bVariant.points),
    surface: scoreNormals(a, bVariant, matrix),
    pattern: scorePattern(a, bVariant),
  }
}

function localScore(raw: RawMatch): number {
  return raw.contour * 0.4 + raw.curvature * 0.2 + raw.surface * 0.22 + raw.pattern * 0.18
}

export function scoreFragmentPair(
  fa: FragmentFeatures,
  fb: FragmentFeatures,
  artifactId: string,
  settings?: Partial<Settings>,
): PairCandidate | null {
  const weights = {
    contour: settings?.contourWeight ?? 0.4,
    curvature: settings?.curvatureWeight ?? 0.2,
    surface: settings?.surfaceWeight ?? 0.22,
    pattern: settings?.patternWeight ?? 0.18,
  }
  const wSum = weights.contour + weights.curvature + weights.surface + weights.pattern
  const axisAligned = settings?.axisAligned ?? true

  const raws: RawMatch[] = []
  for (let ai = 0; ai < fa.contours.length; ai++) {
    const a = fa.contours[ai]
    for (let bi = 0; bi < fb.contours.length; bi++) {
      const b = fb.contours[bi]
      const lengthRatio = a.length / Math.max(1, b.length)
      if (lengthRatio < 0.76 || lengthRatio > 1.32) continue
      for (const reverse of [false, true]) {
        const raw = evaluateOrientation(a, b, ai, bi, reverse, axisAligned)
        if (raw) raws.push(raw)
      }
    }
  }
  if (!raws.length) return null

  const pool = axisAligned ? raws.filter((r) => matRotationAngle(r.matrix) < 1e-6) : raws

  pool.sort((x, y) => localScore(y) - localScore(x))
  const refinedAll = pool.slice(0, axisAligned ? 32 : 16)
  for (const raw of refinedAll) {
    const a = fa.contours[raw.aSegment]
    const b = fb.contours[raw.bSegment]
    if (axisAligned) {
      const refined = refineWindow(raw, a, b)
      raw.refined = refined
      raw.matrix = refined.matrix
      raw.rms = refined.rms
      raw.contour = 100 * Math.exp(-raw.rms * raw.rms / (2 * 0.32 * 0.32))
      raw.curvature = scoreCurvature(refined.aPoints, refined.bPoints)
      raw.surface = scoreNormals(
        { ...a, points: refined.aPoints, normals: refined.aNormals },
        { ...b, points: refined.bPoints, normals: refined.bNormals },
        raw.matrix,
      )
      raw.pattern = scorePattern(
        { colors: refined.aColors } as unknown as ContourSegment,
        { colors: refined.bColors } as unknown as ContourSegment,
      )
    } else {
      const refined = icpRefine(b.points, a.points, raw.matrix)
      raw.matrix = refined.matrix
      raw.rms = indexedRms(refined.matrix, b.points, a.points)
      raw.contour = 100 * Math.exp(-raw.rms * raw.rms / (2 * 0.55 * 0.55))
      const normals = raw.reverse ? [...b.normals].reverse() : b.normals
      raw.surface = scoreNormals(a, { ...b, normals }, raw.matrix)
    }
  }
  refinedAll.sort((x, y) => localScore(y) - localScore(x))
  const finalists = refinedAll.slice(0, 14)
  for (const raw of finalists) {
    const support = fractureSupport(fb.fracturePoints, fa.fracturePoints, raw.matrix)
    raw.support = support.score
    raw.inliers = support.inliers
  }
  finalists.sort((x, y) => localScore(y) + (y.support ?? 0) * 0.55 - (localScore(x) + (x.support ?? 0) * 0.55))
  const best = finalists[0]
  const gap = best.support ?? 0
  const parts: ScoreParts = {
    contour: best.contour,
    curvature: best.curvature,
    surface: best.surface,
    pattern: best.pattern,
    gap,
  }
  const local =
    (weights.contour * parts.contour +
      weights.curvature * parts.curvature +
      weights.surface * parts.surface +
      weights.pattern * parts.pattern) / wSum
  const score = local * 0.6 + gap * 0.4

  const basis = [
    `轮廓重投影 RMS ${best.rms.toFixed(3)} mm`,
    `曲率一致度 ${best.curvature.toFixed(1)}/100`,
    `器表法向连续 ${best.surface.toFixed(1)}/100`,
    `纹饰/色彩连续 ${best.pattern.toFixed(1)}/100`,
    `断面墙支撑点 ${best.inliers ?? 0}，支撑度 ${gap.toFixed(1)}/100`,
    `匹配方向：${best.reverse ? '反向闭合' : '同向闭合'}`,
  ]

  return {
    id: `${fa.id}__${fb.id}__${best.aSegment}-${best.bSegment}`,
    artifactId,
    aId: fa.id,
    bId: fb.id,
    aSegment: best.aSegment,
    bSegment: best.bSegment,
    relative: best.matrix,
    score: Math.round(score * 10) / 10,
    confidence: Math.round(score) / 100,
    parts,
    basis,
    rms: best.rms,
  }
}

export function evaluateAllPairs(
  features: FragmentFeatures[],
  artifactId: string,
  settings?: Partial<Settings>,
  onProgress?: (done: number, total: number) => void,
): PairCandidate[] {
  const out: PairCandidate[] = []
  const total = (features.length * (features.length - 1)) / 2
  let done = 0
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const candidate = scoreFragmentPair(features[i], features[j], artifactId, settings)
      if (candidate) out.push(candidate)
      done++
      if (done % 5 === 0 || done === total) onProgress?.(done, total)
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

export function composeRelative(parentWorld: Mat4, relativeBToA: Mat4): Mat4 {
  return matMultiply(parentWorld, relativeBToA)
}

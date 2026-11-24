import { matTranslation } from './math.ts'
import type { Mat4, Vec3 } from './math.ts'
import { outerRadius, DEFAULT_SPECS } from './vessel.ts'
import type { VesselSpec } from './vessel.ts'
import { FACE_KIND } from './types.ts'
import type { MeshData, VesselType } from './types.ts'

function solve3(m: number[][], b: number[]): Vec3 {
  const a = m[0][0], c = m[0][1], d = m[0][2]
  const e = m[1][0], f = m[1][1], g = m[1][2]
  const h = m[2][0], i = m[2][1], j = m[2][2]
  const det = a * (f * j - g * i) - c * (e * j - g * h) + d * (e * i - f * h) || 1e-9
  const dx = b[0] * (f * j - g * i) - c * (b[1] * j - g * b[2]) + d * (b[1] * i - f * b[2])
  const dy = a * (b[1] * j - g * b[2]) - b[0] * (e * j - g * h) + d * (e * b[2] - b[1] * h)
  const dz = a * (f * b[2] - b[1] * i) - c * (e * b[2] - b[1] * h) + b[0] * (e * i - f * h)
  return [dx / det, dy / det, dz / det]
}

export interface LatheFit {
  matrix: Mat4
  rms: number
  points: number
}

// 旋转器型约束：外表面点满足 r = profile(y)。
// 对纯平移归一化数据，固定 y 平移后这是一个线性圆/轴位拟合问题。
export function fitLatheTranslation(mesh: MeshData, type: VesselType, spec?: VesselSpec): LatheFit {
  const vessel = spec ?? DEFAULT_SPECS[type]
  const used = new Set<number>()
  for (let face = 0; face < mesh.faceKinds.length; face++) {
    if (mesh.faceKinds[face] !== FACE_KIND.OUTER) continue
    used.add(mesh.indices[face * 3])
    used.add(mesh.indices[face * 3 + 1])
    used.add(mesh.indices[face * 3 + 2])
  }
  let points = [...used].map((vi) => [
    mesh.positions[vi * 3],
    mesh.positions[vi * 3 + 1],
    mesh.positions[vi * 3 + 2],
  ] as Vec3)
  if (points.length < 24) {
    points = []
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      points.push([mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]])
    }
  }
  if (points.length > 500) {
    const step = Math.ceil(points.length / 500)
    points = points.filter((_, i) => i % step === 0)
  }

  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minY = Math.min(minY, p[1])
    maxY = Math.max(maxY, p[1])
  }
  const low = -minY - 2
  const high = vessel.height - maxY + 2

  const evaluate = (ty: number): { tx: number; tz: number; rms: number } => {
    const n = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    const rhs = [0, 0, 0]
    for (const p of points) {
      const y = p[1] + ty
      if (y < -2 || y > vessel.height + 2) continue
      const r = outerRadius(type, Math.max(0, Math.min(vessel.height, y)), vessel.height, vessel.radius)
      const row = [2 * p[0], 2 * p[2], 1]
      const value = r * r - p[0] * p[0] - p[2] * p[2]
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) n[i][j] += row[i] * row[j]
        rhs[i] += row[i] * value
      }
    }
    const sol = solve3(n, rhs)
    const tx = sol[0]
    const tz = sol[1]
    let sum = 0
    let count = 0
    for (const p of points) {
      const y = p[1] + ty
      if (y < 0 || y > vessel.height) continue
      const expected = outerRadius(type, y, vessel.height, vessel.radius)
      const actual = Math.hypot(p[0] + tx, p[2] + tz)
      const d = actual - expected
      sum += d * d
      count++
    }
    return { tx, tz, rms: Math.sqrt(sum / Math.max(1, count)) }
  }

  let best = { ty: low, tx: 0, tz: 0, rms: Infinity }
  for (let ty = low; ty <= high; ty += 4) {
    const r = evaluate(ty)
    if (Number.isFinite(r.rms) && r.rms < best.rms) best = { ty, ...r }
  }
  for (let ty = best.ty - 5; ty <= best.ty + 5; ty += 1) {
    const r = evaluate(ty)
    if (r.rms < best.rms) best = { ty, ...r }
  }

  // 代数初值后做 Gauss-Newton 非线性精修，消除窄弧偏心偏差
  let tx = best.tx
  let ty = best.ty
  let tz = best.tz
  for (let iter = 0; iter < 12; iter++) {
    const jtj = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    const jtr = [0, 0, 0]
    for (const p of points) {
      const y = Math.max(0, Math.min(vessel.height, p[1] + ty))
      const rr = outerRadius(type, y, vessel.height, vessel.radius)
      const rho = Math.max(1, Math.hypot(p[0] + tx, p[2] + tz))
      const derivative =
        (outerRadius(type, Math.min(vessel.height, y + 0.25), vessel.height, vessel.radius) -
          outerRadius(type, Math.max(0, y - 0.25), vessel.height, vessel.radius)) / 0.5
      const e = rho - rr
      const j = [(p[0] + tx) / rho, -derivative, (p[2] + tz) / rho]
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) jtj[i][k] += j[i] * j[k]
        jtr[i] += j[i] * e
      }
    }
    const delta = solve3(jtj, [-jtr[0], -jtr[1], -jtr[2]])
    if (!delta.every(Number.isFinite)) break
    tx += delta[0]
    ty += delta[1]
    tz += delta[2]
    if (Math.hypot(delta[0], delta[1], delta[2]) < 0.002) break
  }
  const finalFit = evaluate(ty)

  return {
    matrix: matTranslation([tx, ty, tz]),
    rms: finalFit.rms,
    points: points.length,
  }
}

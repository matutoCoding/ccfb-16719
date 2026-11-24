import { matIdentity } from './math.ts'
import type { Mat4, Vec3 } from './math.ts'

type EigenResult = { values: number[]; vectors: number[][] }

// 对称矩阵 Jacobi 特征分解，3x3 足够稳定且无第三方依赖
function jacobiEigen(input: number[][]): EigenResult {
  const n = 3
  const a = input.map((row) => row.slice())
  const v: number[][] = Array.from({ length: n }, (_, i) => [0, 0, 0].map((__, j) => (i === j ? 1 : 0)))

  for (let iter = 0; iter < 60; iter++) {
    let p: number = 0
    let q: number = 1
    let max = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(a[i][j]) > max) {
          max = Math.abs(a[i][j])
          p = i
          q = j
        }
      }
    }
    if (max < 1e-13) break

    const app = a[p][p]
    const aqq = a[q][q]
    const apq = a[p][q]
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app)
    const c = Math.cos(phi)
    const s = Math.sin(phi)

    for (let k = 0; k < n; k++) {
      const akp = a[k][p]
      const akq = a[k][q]
      a[k][p] = c * akp - s * akq
      a[k][q] = s * akp + c * akq
    }
    for (let k = 0; k < n; k++) {
      const apk = a[p][k]
      const aqk = a[q][k]
      a[p][k] = c * apk - s * aqk
      a[q][k] = s * apk + c * aqk
    }
    for (let k = 0; k < n; k++) {
      const vkp = v[k][p]
      const vkq = v[k][q]
      v[k][p] = c * vkp - s * vkq
      v[k][q] = s * vkp + c * vkq
    }
  }

  const values = [a[0][0], a[1][1], a[2][2]]
  return { values, vectors: v }
}

export interface KabschResult {
  matrix: Mat4
  rms: number
  maxError: number
}

// 求 source -> target 的最优刚体变换
export function kabsch(source: Vec3[], target: Vec3[]): KabschResult {
  const n = Math.min(source.length, target.length)
  const cs: Vec3 = [0, 0, 0]
  const ct: Vec3 = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    cs[0] += source[i][0]
    cs[1] += source[i][1]
    cs[2] += source[i][2]
    ct[0] += target[i][0]
    ct[1] += target[i][1]
    ct[2] += target[i][2]
  }
  cs[0] /= n; cs[1] /= n; cs[2] /= n
  ct[0] /= n; ct[1] /= n; ct[2] /= n

  const h = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let i = 0; i < n; i++) {
    const sx = source[i][0] - cs[0]
    const sy = source[i][1] - cs[1]
    const sz = source[i][2] - cs[2]
    const tx = target[i][0] - ct[0]
    const ty = target[i][1] - ct[1]
    const tz = target[i][2] - ct[2]
    h[0][0] += sx * tx; h[0][1] += sx * ty; h[0][2] += sx * tz
    h[1][0] += sy * tx; h[1][1] += sy * ty; h[1][2] += sy * tz
    h[2][0] += sz * tx; h[2][1] += sz * ty; h[2][2] += sz * tz
  }

  const hth = [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    h[0][i] * h[0][j] + h[1][i] * h[1][j] + h[2][i] * h[2][j],
  ))
  const eig = jacobiEigen(hth)
  const order = [0, 1, 2].sort((a, b) => eig.values[b] - eig.values[a])
  const v: Vec3[] = order.map((col) => [
    eig.vectors[0][col],
    eig.vectors[1][col],
    eig.vectors[2][col],
  ] as Vec3)

  const u: Vec3[] = []
  for (let k = 0; k < 3; k++) {
    const sigma = Math.sqrt(Math.max(1e-12, eig.values[order[k]]))
    u[k] = [
      (h[0][0] * v[k][0] + h[0][1] * v[k][1] + h[0][2] * v[k][2]) / sigma,
      (h[1][0] * v[k][0] + h[1][1] * v[k][1] + h[1][2] * v[k][2]) / sigma,
      (h[2][0] * v[k][0] + h[2][1] * v[k][1] + h[2][2] * v[k][2]) / sigma,
    ]
  }

  const detV = determinant3(v[0], v[1], v[2], true)
  const detU = determinant3(u[0], u[1], u[2], false)
  const d = detV * detU < 0 ? -1 : 1

  // R = V diag(1,1,d) U^T；v[k] 是第 k 列
  const r = Array.from({ length: 3 }, () => [0, 0, 0])
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      r[row][col] =
        v[0][row] * u[0][col] +
        v[1][row] * u[1][col] +
        d * v[2][row] * u[2][col]
    }
  }

  const tx = ct[0] - (r[0][0] * cs[0] + r[0][1] * cs[1] + r[0][2] * cs[2])
  const ty = ct[1] - (r[1][0] * cs[0] + r[1][1] * cs[1] + r[1][2] * cs[2])
  const tz = ct[2] - (r[2][0] * cs[0] + r[2][1] * cs[1] + r[2][2] * cs[2])

  const m = matIdentity()
  m[0] = r[0][0]; m[4] = r[0][1]; m[8] = r[0][2]
  m[1] = r[1][0]; m[5] = r[1][1]; m[9] = r[1][2]
  m[2] = r[2][0]; m[6] = r[2][1]; m[10] = r[2][2]
  m[12] = tx; m[13] = ty; m[14] = tz

  let sum = 0
  let maxError = 0
  for (let i = 0; i < n; i++) {
    const px = r[0][0] * source[i][0] + r[0][1] * source[i][1] + r[0][2] * source[i][2] + tx
    const py = r[1][0] * source[i][0] + r[1][1] * source[i][1] + r[1][2] * source[i][2] + ty
    const pz = r[2][0] * source[i][0] + r[2][1] * source[i][1] + r[2][2] * source[i][2] + tz
    const e = Math.hypot(px - target[i][0], py - target[i][1], pz - target[i][2])
    sum += e * e
    maxError = Math.max(maxError, e)
  }
  return { matrix: m, rms: Math.sqrt(sum / n), maxError }
}

function determinant3(a: Vec3, b: Vec3, c: Vec3, columns: boolean): number {
  if (columns) {
    // 参数分别为三列
    return (
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      b[0] * (a[1] * c[2] - a[2] * c[1]) +
      c[0] * (a[1] * b[2] - a[2] * b[1])
    )
  }
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  )
}

export type Vec3 = [number, number, number]

// 与 three.Matrix4 一致的列主序 4x4
export type Mat4 = number[]

export const v3 = {
  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  },
  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  },
  scale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s]
  },
  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
  },
  len(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2])
  },
  norm(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  },
  dist(a: Vec3, b: Vec3): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  },
}

export function matIdentity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function matTranslation(p: Vec3): Mat4 {
  const m = matIdentity()
  m[12] = p[0]
  m[13] = p[1]
  m[14] = p[2]
  return m
}

export function matCompose(pos: Vec3, quat: Vec4): Mat4 {
  const [x, y, z, w] = quat
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    pos[0], pos[1], pos[2], 1,
  ]
}

export type Vec4 = [number, number, number, number]

export function quatFromAxisAngle(axis: Vec3, angle: number): Vec4 {
  const n = v3.norm(axis)
  const h = angle * 0.5
  const s = Math.sin(h)
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)]
}

export function matMultiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

export function matInvertRigid(m: Mat4): Mat4 {
  // 列主序，左上 3x3 为纯旋转
  const r0 = m[0], r1 = m[1], r2 = m[2]
  const r4 = m[4], r5 = m[5], r6 = m[6]
  const r8 = m[8], r9 = m[9], r10 = m[10]
  const t0 = m[12], t1 = m[13], t2 = m[14]
  return [
    r0, r4, r8, 0,
    r1, r5, r9, 0,
    r2, r6, r10, 0,
    -(r0 * t0 + r1 * t1 + r2 * t2),
    -(r4 * t0 + r5 * t1 + r6 * t2),
    -(r8 * t0 + r9 * t1 + r10 * t2),
    1,
  ]
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

export function matRotationAngle(m: Mat4): number {
  const trace = m[0] + m[5] + m[10]
  const cos = Math.max(-1, Math.min(1, (trace - 1) * 0.5))
  return Math.acos(cos)
}

export function matTranslationVec(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]]
}

export function centroidOf(points: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  for (const p of points) {
    c[0] += p[0]
    c[1] += p[1]
    c[2] += p[2]
  }
  const n = Math.max(1, points.length)
  return [c[0] / n, c[1] / n, c[2] / n]
}

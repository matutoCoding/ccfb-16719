import type { Vec3 } from './math.ts'
import type { VesselType } from './types.ts'

export interface VesselSpec {
  type: VesselType
  height: number
  radius: number
  thickness: number
  rows: number
  cols: number
  drop: number
  seed: number
  noiseMm: number
}

export const DEFAULT_SPECS: Record<VesselType, VesselSpec> = {
  jar: {
    type: 'jar',
    height: 260,
    radius: 152,
    thickness: 7,
    rows: 4,
    cols: 6,
    drop: 3,
    seed: 16719,
    noiseMm: 1.15,
  },
  bowl: {
    type: 'bowl',
    height: 96,
    radius: 164,
    thickness: 5,
    rows: 3,
    cols: 9,
    drop: 4,
    seed: 16720,
    noiseMm: 0.85,
  },
}

const JAR_PROFILE: Array<[number, number]> = [
  [0, 76], [0.06, 88], [0.18, 112], [0.38, 145], [0.52, 152],
  [0.68, 137], [0.8, 108], [0.88, 76], [0.94, 64], [0.98, 67], [1, 78],
]

const BOWL_PROFILE: Array<[number, number]> = [
  [0, 52], [0.12, 66], [0.3, 88], [0.55, 119], [0.78, 145], [1, 164],
]

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

export function outerRadius(type: VesselType, y: number, height: number, radius: number): number {
  const table = type === 'jar' ? JAR_PROFILE : BOWL_PROFILE
  const t = Math.max(0, Math.min(1, y / height))
  const scale = radius / table[table.length - 1][1]
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, r0] = table[i]
    const [t1, r1] = table[i + 1]
    if (t <= t1) {
      const k = smooth((t - t0) / Math.max(1e-6, t1 - t0))
      return (r0 + (r1 - r0) * k) * scale
    }
  }
  return table[table.length - 1][1] * scale
}

export function vesselPoint(
  spec: VesselSpec,
  s: number,
  h: number,
  inner = false,
): Vec3 {
  const u = h / spec.rows
  const thetaEnvelope = Math.sin(Math.PI * Math.min(1, Math.max(0, u)))
  const theta =
    (Math.PI * 2 * s) / spec.cols +
    0.052 * Math.sin(1.7 * h + 0.85 * Math.sin((Math.PI * 2 * s) / spec.cols)) * thetaEnvelope

  const yWarp =
    (spec.type === 'jar' ? 7.5 : 5.5) *
    Math.sin((Math.PI * 4 * s) / spec.cols + h * 1.37) *
    Math.sin(Math.PI * u)
  const y = (spec.height * h) / spec.rows + yWarp
  const outerR = outerRadius(spec.type, y, spec.height, spec.radius)
  const r = inner ? Math.max(18, outerR - spec.thickness) : outerR
  return [r * Math.cos(theta), y, r * Math.sin(theta)]
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function band(y: number, center: number, width: number): number {
  const d = Math.abs(y - center)
  return d < width ? 1 - d / width : 0
}

// 线性纹饰：弦纹 + 连续卷草/莲瓣，匹配时提供额外约束
export function patternColor(spec: VesselSpec, p: Vec3): Vec3 {
  const theta = Math.atan2(p[2], p[0])
  const base: Vec3 = spec.type === 'jar' ? [0.72, 0.43, 0.27] : [0.78, 0.55, 0.36]
  let paint = 0
  if (spec.type === 'jar') {
    paint = Math.max(
      band(p[1], 72, 5),
      band(p[1], 88, 3.5),
      band(p[1], 184, 4),
      band(p[1], 202, 5),
    )
    const waveY = 132 + 13 * Math.sin(theta * 6)
    const wave = Math.max(0, 1 - Math.abs(p[1] - waveY) / 5)
    paint = Math.max(paint, wave * 0.95)
  } else {
    paint = Math.max(band(p[1], spec.height - 18, 5), band(p[1], spec.height - 31, 3))
    const petal = Math.pow(0.5 + 0.5 * Math.cos(theta * 12), 5)
    const petalBand = Math.max(0, 1 - Math.abs(p[1] - 48) / 25)
    paint = Math.max(paint, petal * petalBand)
  }
  const dark: Vec3 = [0.16, 0.09, 0.055]
  const k = Math.min(1, paint)
  return [base[0] * (1 - k) + dark[0] * k, base[1] * (1 - k) + dark[1] * k, base[2] * (1 - k) + dark[2] * k]
}

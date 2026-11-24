import { v3 } from './math.ts'
import type { Vec3 } from './math.ts'
import { buildEdges, faceNormal } from './classify.ts'
import { FACE_KIND } from './types.ts'
import type { MeshData } from './types.ts'

export interface ContourSegment {
  points: Vec3[]
  normals: Vec3[]
  colors: Vec3[]
  length: number
  centroid: Vec3
  closed: boolean
}

interface RawChain {
  keys: string[]
  closed: boolean
}

const SAMPLE_COUNT = 44

function isFracture(k: number): boolean {
  return k === FACE_KIND.FRACTURE || k === FACE_KIND.UNKNOWN
}

export function extractRawChains(mesh: MeshData): RawChain[] {
  const edges = [...buildEdges(mesh).values()]
  const contour = edges.filter((e) => {
    if (e.faces.length === 0) return false
    const kinds = e.faces.map((f) => mesh.faceKinds[f])
    if (kinds.length === 1) return !isFracture(kinds[0])
    const frac = kinds.some(isFracture)
    const smooth = kinds.some((k) => !isFracture(k))
    return frac && smooth
  })

  const edgeMap = new Map(contour.map((e) => [e.key, e]))
  const graph = new Map<string, string[]>()
  for (const e of contour) {
    graph.set(e.aKey, [...(graph.get(e.aKey) ?? []), e.key])
    graph.set(e.bKey, [...(graph.get(e.bKey) ?? []), e.key])
  }

  const used = new Set<string>()
  const chains: RawChain[] = []

  const walk = (startKey: string, blockedEdge: string): string[] => {
    const out: string[] = []
    let pointKey = startKey
    let incoming = blockedEdge
    for (let guard = 0; guard < 10000; guard++) {
      const choices = (graph.get(pointKey) ?? []).filter((ek) => ek !== incoming && !used.has(ek))
      if (choices.length === 0) break
      // 正常轮廓点度数为 2；若出现分叉，选最直的一条，避免在角点乱拐
      let edgeKey = choices[0]
      if (choices.length > 1) {
        const incomingEdge = edgeMap.get(incoming)
        let best = -Infinity
        const prevPoint = incomingEdge
          ? (incomingEdge.aKey === pointKey ? incomingEdge.bKey : incomingEdge.aKey)
          : pointKey
        for (const ck of choices) {
          const e = edgeMap.get(ck)!
          const next = e.aKey === pointKey ? e.bKey : e.aKey
          const ep = edgePoint(mesh, prevPoint)
          const cp = edgePoint(mesh, pointKey)
          const np = edgePoint(mesh, next)
          const d1 = v3.norm(v3.sub(cp, ep))
          const d2 = v3.norm(v3.sub(np, cp))
          const straight = v3.dot(d1, d2)
          if (straight > best) {
            best = straight
            edgeKey = ck
          }
        }
      }
      used.add(edgeKey)
      const e = edgeMap.get(edgeKey)!
      const nextKey = e.aKey === pointKey ? e.bKey : e.aKey
      out.push(nextKey)
      incoming = edgeKey
      pointKey = nextKey
    }
    return out
  }

  for (const e of contour) {
    if (used.has(e.key)) continue
    used.add(e.key)
    const left = walk(e.aKey, e.key)
    if (left[left.length - 1] === e.bKey) {
      chains.push({ keys: [e.aKey, ...left], closed: true })
      continue
    }
    const right = walk(e.bKey, e.key)
    const keys = [
      ...left.slice().reverse(),
      e.aKey,
      e.bKey,
      ...right,
    ]
    chains.push({ keys, closed: false })
  }
  return chains
}

const keyPointCache = new WeakMap<MeshData, Map<string, { p: Vec3; n: Vec3; color: Vec3 }>>()

function pointLookup(mesh: MeshData): Map<string, { p: Vec3; n: Vec3; color: Vec3 }> {
  let map = keyPointCache.get(mesh)
  if (map) return map
  map = new Map()
  const normals = new Float32Array(mesh.positions.length)
  const faceCount = mesh.indices.length / 3
  for (let f = 0; f < faceCount; f++) {
    const n = faceNormal(mesh, f)
    for (let k = 0; k < 3; k++) {
      const vi = mesh.indices[f * 3 + k] * 3
      normals[vi] += n[0]
      normals[vi + 1] += n[1]
      normals[vi + 2] += n[2]
    }
  }
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const p: Vec3 = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]
    const nl = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1
    const n: Vec3 = [normals[i * 3] / nl, normals[i * 3 + 1] / nl, normals[i * 3 + 2] / nl]
    const key = `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`
    if (!map.has(key)) {
      const color: Vec3 = mesh.colors
        ? [mesh.colors[i * 3], mesh.colors[i * 3 + 1], mesh.colors[i * 3 + 2]]
        : [0.6, 0.4, 0.25]
      map.set(key, { p, n, color })
    }
  }
  keyPointCache.set(mesh, map)
  return map
}

function edgePoint(mesh: MeshData, key: string): Vec3 {
  return pointLookup(mesh).get(key)!.p
}

function chainToPoints(mesh: MeshData, chain: RawChain) {
  const lookup = pointLookup(mesh)
  const points: Vec3[] = []
  const normals: Vec3[] = []
  const colors: Vec3[] = []
  for (const key of chain.keys) {
    const item = lookup.get(key)
    if (item) {
      points.push(item.p)
      normals.push(item.n)
      colors.push(item.color)
    }
  }
  return { points, normals, colors }
}

function cornerIndices(points: Vec3[], closed: boolean): number[] {
  const n = points.length
  if (n < 7) return []
  const arc = [0]
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + v3.dist(points[i - 1], points[i]))
  const total = arc[n - 1]
  const corners: Array<{ i: number; score: number }> = []
  const radius = Math.max(2, Math.floor(n / 7))

  for (let i = 1; i < n - 1; i++) {
    const a = points[Math.max(0, i - radius)]
    const b = points[i]
    const c = points[Math.min(n - 1, i + radius)]
    const t1 = v3.norm(v3.sub(b, a))
    const t2 = v3.norm(v3.sub(c, b))
    const angle = Math.acos(Math.max(-1, Math.min(1, v3.dot(t1, t2))))
    if (angle > 0.62) corners.push({ i, score: angle })
  }

  corners.sort((a, b) => b.score - a.score)
  const picked: number[] = []
  for (const c of corners) {
    const arcPos = arc[c.i]
    const tooClose = picked.some((pi) => {
      const d = Math.abs(arc[pi] - arcPos)
      return Math.min(d, total - d) < 22
    })
    if (!tooClose) picked.push(c.i)
  }
  picked.sort((a, b) => a - b)
  if (closed && picked.length > 2) {
    const first = picked[0]
    const last = picked[picked.length - 1]
    if (total - arc[last] + arc[first] < 22) picked.shift()
  }
  return picked
}

function sliceChain<T>(items: T[], start: number, end: number): T[] {
  return items.slice(start, end + 1)
}

function resample(
  points: Vec3[],
  normals: Vec3[],
  colors: Vec3[],
): { points: Vec3[]; normals: Vec3[]; colors: Vec3[]; length: number } {
  if (points.length < 2) return { points: [], normals: [], colors: [], length: 0 }
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + v3.dist(points[i - 1], points[i]))
  const length = cumulative[cumulative.length - 1]
  if (length < 18) return { points: [], normals: [], colors: [], length }

  const outP: Vec3[] = []
  const outN: Vec3[] = []
  const outC: Vec3[] = []
  let seg = 0
  for (let k = 0; k < SAMPLE_COUNT; k++) {
    const d = (length * k) / (SAMPLE_COUNT - 1)
    while (seg < cumulative.length - 2 && cumulative[seg + 1] < d) seg++
    const d0 = cumulative[seg]
    const d1 = cumulative[seg + 1]
    const t = (d - d0) / Math.max(1e-9, d1 - d0)
    const p0 = points[seg]
    const p1 = points[seg + 1]
    outP.push([
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t,
    ])
    const n0 = normals[seg] ?? [0, 1, 0]
    const n1 = normals[seg + 1] ?? n0
    outN.push(v3.norm([
      n0[0] + (n1[0] - n0[0]) * t,
      n0[1] + (n1[1] - n0[1]) * t,
      n0[2] + (n1[2] - n0[2]) * t,
    ]))
    const c0 = colors[seg] ?? [0.6, 0.4, 0.25]
    const c1 = colors[seg + 1] ?? c0
    outC.push([
      c0[0] + (c1[0] - c0[0]) * t,
      c0[1] + (c1[1] - c0[1]) * t,
      c0[2] + (c1[2] - c0[2]) * t,
    ])
  }
  return { points: outP, normals: outN, colors: outC, length }
}

function sampleArc(
  points: Vec3[],
  normals: Vec3[],
  colors: Vec3[],
  cumulative: number[],
  distance: number,
): { p: Vec3; n: Vec3; c: Vec3 } {
  const total = cumulative[cumulative.length - 1] || 1
  let d = distance
  if (d < 0 || d > total) d = ((d % total) + total) % total
  let seg = 0
  while (seg < cumulative.length - 2 && cumulative[seg + 1] < d) seg++
  const d0 = cumulative[seg]
  const d1 = cumulative[seg + 1]
  const t = (d - d0) / Math.max(1e-9, d1 - d0)
  const p0 = points[seg]
  const p1 = points[seg + 1] ?? p0
  const n0 = normals[seg] ?? [0, 1, 0]
  const n1 = normals[seg + 1] ?? n0
  const c0 = colors[seg] ?? [0.6, 0.4, 0.25]
  const c1 = colors[seg + 1] ?? c0
  return {
    p: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t],
    n: v3.norm([n0[0] + (n1[0] - n0[0]) * t, n0[1] + (n1[1] - n0[1]) * t, n0[2] + (n1[2] - n0[2]) * t]),
    c: [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t],
  }
}

const WINDOW_LENGTH = 66
const WINDOW_STRIDE = 38
const WINDOW_SAMPLES = 28

function windowsFromChain(mesh: MeshData, chain: RawChain): ContourSegment[] {
  const raw = chainToPoints(mesh, chain)
  if (raw.points.length < 4) return []
  let points = raw.points
  let normals = raw.normals
  let colors = raw.colors
  if (chain.closed) {
    points = [...points, points[0]]
    normals = [...normals, normals[0]]
    colors = [...colors, colors[0]]
  }
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + v3.dist(points[i - 1], points[i]))
  const total = cumulative[cumulative.length - 1]
  if (total < WINDOW_LENGTH * 0.8) return []

  const starts: number[] = []
  if (chain.closed) {
    for (let d = 0; d < total; d += WINDOW_STRIDE) starts.push(d)
  } else {
    for (let d = 0; d <= Math.max(0, total - WINDOW_LENGTH) + 0.1; d += WINDOW_STRIDE) starts.push(d)
  }

  return starts.map((start) => {
    const ps: Vec3[] = []
    const ns: Vec3[] = []
    const cs: Vec3[] = []
    for (let k = 0; k < WINDOW_SAMPLES; k++) {
      const d = start + (WINDOW_LENGTH * k) / (WINDOW_SAMPLES - 1)
      const s = sampleArc(points, normals, colors, cumulative, chain.closed ? d : Math.min(total, d))
      ps.push(s.p)
      ns.push(s.n)
      cs.push(s.c)
    }
    const centroid: Vec3 = [0, 0, 0]
    for (const p of ps) {
      centroid[0] += p[0]
      centroid[1] += p[1]
      centroid[2] += p[2]
    }
    centroid[0] /= ps.length
    centroid[1] /= ps.length
    centroid[2] /= ps.length
    return { points: ps, normals: ns, colors: cs, length: WINDOW_LENGTH, centroid, closed: false }
  })
}

export function extractContours(mesh: MeshData): ContourSegment[] {
  const result: ContourSegment[] = []
  for (const chain of extractRawChains(mesh)) result.push(...windowsFromChain(mesh, chain))
  return result
}


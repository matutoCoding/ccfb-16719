import type { Vec3 } from './math.ts'
import { FACE_KIND } from './types.ts'
import type { FaceKind, MeshData } from './types.ts'

export function faceNormal(mesh: MeshData, face: number): Vec3 {
  const ia = mesh.indices[face * 3] * 3
  const ib = mesh.indices[face * 3 + 1] * 3
  const ic = mesh.indices[face * 3 + 2] * 3
  const ax = mesh.positions[ia]
  const ay = mesh.positions[ia + 1]
  const az = mesh.positions[ia + 2]
  const abx = mesh.positions[ib] - ax
  const aby = mesh.positions[ib + 1] - ay
  const abz = mesh.positions[ib + 2] - az
  const acx = mesh.positions[ic] - ax
  const acy = mesh.positions[ic + 1] - ay
  const acz = mesh.positions[ic + 2] - az
  const n: Vec3 = [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ]
  const l = Math.hypot(n[0], n[1], n[2]) || 1
  return [n[0] / l, n[1] / l, n[2] / l]
}

export function faceCenter(mesh: MeshData, face: number): Vec3 {
  const ia = mesh.indices[face * 3] * 3
  const ib = mesh.indices[face * 3 + 1] * 3
  const ic = mesh.indices[face * 3 + 2] * 3
  return [
    (mesh.positions[ia] + mesh.positions[ib] + mesh.positions[ic]) / 3,
    (mesh.positions[ia + 1] + mesh.positions[ib + 1] + mesh.positions[ic + 1]) / 3,
    (mesh.positions[ia + 2] + mesh.positions[ib + 2] + mesh.positions[ic + 2]) / 3,
  ]
}

export function pointKey(p: Vec3): string {
  return `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`
}

export interface EdgeInfo {
  key: string
  aKey: string
  bKey: string
  a: Vec3
  b: Vec3
  faces: number[]
}

export function buildEdges(mesh: MeshData): Map<string, EdgeInfo> {
  const edges = new Map<string, EdgeInfo>()
  const pointMap = new Map<string, Vec3>()
  const faceCount = mesh.indices.length / 3

  for (let f = 0; f < faceCount; f++) {
    const base = f * 3
    for (let e = 0; e < 3; e++) {
      const ii = mesh.indices[base + e] * 3
      const jj = mesh.indices[base + ((e + 1) % 3)] * 3
      const p1: Vec3 = [mesh.positions[ii], mesh.positions[ii + 1], mesh.positions[ii + 2]]
      const p2: Vec3 = [mesh.positions[jj], mesh.positions[jj + 1], mesh.positions[jj + 2]]
      const k1 = pointKey(p1)
      const k2 = pointKey(p2)
      pointMap.set(k1, p1)
      pointMap.set(k2, p2)
      const [aKey, bKey] = k1 < k2 ? [k1, k2] : [k2, k1]
      const key = `${aKey}|${bKey}`
      let edge = edges.get(key)
      if (!edge) {
        edge = { key, aKey, bKey, a: pointMap.get(aKey)!, b: pointMap.get(bKey)!, faces: [] }
        edges.set(key, edge)
      }
      if (!edge.faces.includes(f)) edge.faces.push(f)
    }
  }

  for (const edge of edges.values()) {
    edge.a = pointMap.get(edge.aKey)!
    edge.b = pointMap.get(edge.bKey)!
  }
  return edges
}

export function buildAdjacency(mesh: MeshData, edges: Map<string, EdgeInfo>): number[][] {
  const faceCount = mesh.indices.length / 3
  const adj: number[][] = Array.from({ length: faceCount }, () => [])
  for (const edge of edges.values()) {
    if (edge.faces.length >= 2) {
      for (let i = 0; i < edge.faces.length; i++) {
        for (let j = i + 1; j < edge.faces.length; j++) {
          const a = edge.faces[i]
          const b = edge.faces[j]
          if (!adj[a].includes(b)) adj[a].push(b)
          if (!adj[b].includes(a)) adj[b].push(a)
        }
      }
    }
  }
  return adj
}

// 根据局部法向变化自动区分光滑器表和粗糙断面。
// 生成数据自带精确 faceKinds，但导入模型会走这个分类器。
export function classifyMesh(mesh: MeshData): Uint8Array {
  const faceCount = mesh.indices.length / 3
  const normals = Array.from({ length: faceCount }, (_, f) => faceNormal(mesh, f))
  const edges = buildEdges(mesh)
  const adj = buildAdjacency(mesh, edges)
  const roughness = new Float64Array(faceCount)

  for (let f = 0; f < faceCount; f++) {
    const angles = adj[f].map((g) => {
      const d = Math.max(-1, Math.min(1, normals[f][0] * normals[g][0] + normals[f][1] * normals[g][1] + normals[f][2] * normals[g][2]))
      return Math.acos(d)
    }).sort((a, b) => a - b)
    roughness[f] = angles.length ? angles[Math.floor(angles.length / 2)] : 1
  }

  const smoothEdge = 0.13
  const component = new Int32Array(faceCount).fill(-1)
  const components: number[][] = []
  for (let start = 0; start < faceCount; start++) {
    if (component[start] !== -1) continue
    const id = components.length
    const list: number[] = []
    const stack = [start]
    component[start] = id
    while (stack.length) {
      const f = stack.pop()!
      list.push(f)
      for (const g of adj[f]) {
        if (component[g] !== -1) continue
        const d = Math.max(-1, Math.min(1, normals[f][0] * normals[g][0] + normals[f][1] * normals[g][1] + normals[f][2] * normals[g][2]))
        if (Math.acos(d) < smoothEdge && roughness[g] < 0.16) {
          component[g] = id
          stack.push(g)
        }
      }
    }
    components.push(list)
  }

  const kinds = new Uint8Array(faceCount)
  for (const list of components) {
    const avgRough = list.reduce((s, f) => s + roughness[f], 0) / list.length
    const isSmooth = list.length >= 24 && avgRough < 0.11
    if (!isSmooth) {
      for (const f of list) kinds[f] = FACE_KIND.FRACTURE
      continue
    }

    let nx = 0
    let ny = 0
    let nz = 0
    let radialVotes = 0
    let radialSum = 0
    for (const f of list) {
      const n = normals[f]
      nx += n[0]; ny += n[1]; nz += n[2]
      const c = faceCenter(mesh, f)
      const rl = Math.hypot(c[0], c[2])
      if (rl > 1) {
        radialSum += n[0] * (c[0] / rl) + n[2] * (c[2] / rl)
        radialVotes++
      }
    }
    nx /= list.length; ny /= list.length; nz /= list.length
    const nl = Math.hypot(nx, ny, nz) || 1
    const axisY = Math.abs(ny / nl)
    const radial = radialVotes ? radialSum / radialVotes : 0

    let kind: FaceKind = FACE_KIND.OUTER
    if (axisY > 0.9) kind = FACE_KIND.ORIGINAL
    else if (radial < -0.02) kind = FACE_KIND.INNER
    else kind = FACE_KIND.OUTER
    for (const f of list) kinds[f] = kind
  }

  // 极小孤立光滑面通常是噪声岛，统一并入断面
  for (let id = 0; id < components.length; id++) {
    if (components[id].length < 8) {
      for (const f of components[id]) kinds[f] = FACE_KIND.FRACTURE
    }
  }
  mesh.faceKinds = kinds
  return kinds
}

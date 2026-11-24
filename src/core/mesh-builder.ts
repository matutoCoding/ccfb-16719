import type { Vec3 } from './math.ts'
import { FACE_KIND } from './types.ts'
import type { FaceKind, MeshData } from './types.ts'

export class MeshBuilder {
  positions: number[] = []
  colors: number[] = []
  indices: number[] = []
  faceKinds: FaceKind[] = []

  vertex(p: Vec3, color?: Vec3): number {
    const id = this.positions.length / 3
    this.positions.push(p[0], p[1], p[2])
    const c = color ?? [0.62, 0.42, 0.28]
    this.colors.push(c[0], c[1], c[2])
    return id
  }

  tri(a: number, b: number, c: number, kind: FaceKind = FACE_KIND.UNKNOWN): void {
    this.indices.push(a, b, c)
    this.faceKinds.push(kind)
  }

  quad(a: number, b: number, c: number, d: number, kind: FaceKind = FACE_KIND.UNKNOWN): void {
    this.tri(a, b, c, kind)
    this.tri(a, c, d, kind)
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      colors: new Float32Array(this.colors),
      faceKinds: new Uint8Array(this.faceKinds),
    }
  }
}

export function meshCenter(positions: Float32Array | number[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  const n = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) {
    c[0] += positions[i]
    c[1] += positions[i + 1]
    c[2] += positions[i + 2]
  }
  return [c[0] / n, c[1] / n, c[2] / n]
}

export function translateMesh(mesh: MeshData, delta: Vec3): void {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] -= delta[0]
    mesh.positions[i + 1] -= delta[1]
    mesh.positions[i + 2] -= delta[2]
  }
}

export function meshBBox(mesh: MeshData): { min: Vec3; max: Vec3; size: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i + k])
      max[k] = Math.max(max[k], mesh.positions[i + k])
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  }
}

export function meshArea(mesh: MeshData): number {
  let area = 0
  const p = mesh.positions
  const idx = mesh.indices
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3
    const ib = idx[i + 1] * 3
    const ic = idx[i + 2] * 3
    const abx = p[ib] - p[ia]
    const aby = p[ib + 1] - p[ia + 1]
    const abz = p[ib + 2] - p[ia + 2]
    const acx = p[ic] - p[ia]
    const acy = p[ic + 1] - p[ia + 1]
    const acz = p[ic + 2] - p[ia + 2]
    const cx = aby * acz - abz * acy
    const cy = abz * acx - abx * acz
    const cz = abx * acy - aby * acx
    area += 0.5 * Math.hypot(cx, cy, cz)
  }
  return area
}

export function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return (x - Math.floor(x)) * 2 - 1
}

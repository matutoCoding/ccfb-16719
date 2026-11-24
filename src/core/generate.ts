import {
  matCompose, matTranslation, quatFromAxisAngle,
} from './math.ts'
import type { Mat4, Vec3 } from './math.ts'
import { MeshBuilder, deterministicNoise, meshArea, meshBBox, meshCenter, translateMesh } from './mesh-builder.ts'
import { DEFAULT_SPECS, patternColor, vesselPoint, mulberry32 } from './vessel.ts'
import type { VesselSpec } from './vessel.ts'
import { FACE_KIND } from './types.ts'
import type { FragmentRecord, VesselType } from './types.ts'

const SU = 12
const SV = 14
const WL = 5

type SideDef = {
  key: string
  count: number
  point: (t: number, inner: boolean) => Vec3
  original: boolean
}

function hashKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function addSurfaceGrid(
  b: MeshBuilder,
  spec: VesselSpec,
  r: number,
  c: number,
  inner: boolean,
): void {
  const grid: number[][] = []
  for (let j = 0; j <= SV; j++) {
    grid[j] = []
    for (let i = 0; i <= SU; i++) {
      const s = c + i / SU
      const h = r + j / SV
      const p = vesselPoint(spec, s, h, inner)
      const color = inner ? [0.58, 0.39, 0.27] as Vec3 : patternColor(spec, p)
      grid[j][i] = b.vertex(p, color)
    }
  }
  const kind = inner ? FACE_KIND.INNER : FACE_KIND.OUTER
  for (let j = 0; j < SV; j++) {
    for (let i = 0; i < SU; i++) {
      const a = grid[j][i]
      const bb = grid[j][i + 1]
      const cc = grid[j + 1][i + 1]
      const d = grid[j + 1][i]
      if (inner) b.quad(a, bb, cc, d, kind)
      else b.quad(a, d, cc, bb, kind)
    }
  }
}

function addWall(b: MeshBuilder, spec: VesselSpec, side: SideDef): void {
  const rows: number[][] = []
  const seed = hashKey(side.key)
  for (let i = 0; i <= side.count; i++) {
    const t = i / side.count
    const outer = side.point(t, false)
    const inner = side.point(t, true)
    rows[i] = []
    for (let l = 0; l <= WL; l++) {
      const q = l / WL
      const p: Vec3 = [
        outer[0] + (inner[0] - outer[0]) * q,
        outer[1] + (inner[1] - outer[1]) * q,
        outer[2] + (inner[2] - outer[2]) * q,
      ]
      if (!side.original && l > 0 && l < WL) {
        const env = Math.sin(Math.PI * q)
        const theta = Math.atan2(p[2], p[0])
        const radial: Vec3 = [Math.cos(theta), 0, Math.sin(theta)]
        const tangent: Vec3 = [-Math.sin(theta), 0, Math.cos(theta)]
        const n1 = deterministicNoise(seed + i * 19 + l * 101)
        const n2 = deterministicNoise(seed + i * 29 + l * 131 + 17)
        const n3 = deterministicNoise(seed + i * 37 + l * 157 + 41)
        const amp = spec.noiseMm * env
        p[0] += radial[0] * n1 * amp + tangent[0] * n2 * amp * 0.28
        p[1] += n3 * amp * 0.38
        p[2] += radial[2] * n1 * amp + tangent[2] * n2 * amp * 0.28
      }
      const wallColor: Vec3 = side.original ? [0.66, 0.43, 0.28] : [0.61, 0.43, 0.31]
      rows[i][l] = b.vertex(p, wallColor)
    }
  }
  const kind = side.original ? FACE_KIND.ORIGINAL : FACE_KIND.FRACTURE
  for (let i = 0; i < side.count; i++) {
    for (let l = 0; l < WL; l++) {
      b.quad(rows[i][l], rows[i + 1][l], rows[i + 1][l + 1], rows[i][l + 1], kind)
    }
  }
}

function cellSides(spec: VesselSpec, r: number, c: number): SideDef[] {
  const left = c
  const right = (c + 1) % spec.cols
  return [
    {
      key: `V:${left}:${r}`,
      count: SV,
      original: false,
      point: (t, inner) => vesselPoint(spec, c, r + t, inner),
    },
    {
      key: `V:${right}:${r}`,
      count: SV,
      original: false,
      point: (t, inner) => vesselPoint(spec, c + 1, r + t, inner),
    },
    {
      key: `H:${r}:${c}`,
      count: SU,
      original: r === 0,
      point: (t, inner) => vesselPoint(spec, c + t, r, inner),
    },
    {
      key: `H:${r + 1}:${c}`,
      count: SU,
      original: r === spec.rows - 1,
      point: (t, inner) => vesselPoint(spec, c + t, r + 1, inner),
    },
  ]
}

function scatterMatrix(rng: () => number, index: number): Mat4 {
  const angle = index * 2.399963 + rng() * 0.4
  const radius = 250 + rng() * 170
  const pos: Vec3 = [Math.cos(angle) * radius, 70 + rng() * 90, Math.sin(angle) * radius]
  const q = quatFromAxisAngle([rng() - 0.5, rng() - 0.5, rng() - 0.5], rng() * Math.PI * 2)
  return matCompose(pos, q)
}

export interface GeneratedVessel {
  artifactCode: string
  fragments: FragmentRecord[]
  dropped: string[]
}

export function generateVessel(type: VesselType, now = 0): GeneratedVessel {
  const spec = DEFAULT_SPECS[type]
  const rng = mulberry32(spec.seed)
  const allCells: Array<[number, number]> = []
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) allCells.push([r, c])
  }

  // 固定打乱后丢片，保证测试可复现
  for (let i = allCells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[allCells[i], allCells[j]] = [allCells[j], allCells[i]]
  }
  const droppedSet = new Set(allCells.slice(0, spec.drop).map(([r, c]) => `${r}-${c}`))
  const dropped = [...droppedSet]
  const cells = []
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      if (!droppedSet.has(`${r}-${c}`)) cells.push([r, c] as [number, number])
    }
  }

  const raw = cells.map(([r, c], index) => {
    const builder = new MeshBuilder()
    addSurfaceGrid(builder, spec, r, c, false)
    addSurfaceGrid(builder, spec, r, c, true)
    for (const side of cellSides(spec, r, c)) addWall(builder, spec, side)
    const mesh = builder.build()
    const centroid = meshCenter(mesh.positions)
    const truthMatrix = matTranslation(centroid)
    translateMesh(mesh, centroid)
    return { r, c, index, mesh, centroid, truthMatrix }
  })

  const areas = raw.map((x) => meshArea(x.mesh)).sort((a, b) => a - b)
  const smallMax = areas[Math.floor(areas.length / 3)]
  const largeMin = areas[Math.floor((areas.length * 2) / 3)]

  const fragments: FragmentRecord[] = raw.map((x) => {
    const area = meshArea(x.mesh)
    const bbox = meshBBox(x.mesh).size
    const painted = paintedRatio(x.mesh)
    const sizeGroup = area >= largeMin ? 'large' : area <= smallMax ? 'small' : 'medium'
    const patternGroup = painted > 0.18 ? (type === 'jar' ? '弦纹卷草' : '莲瓣弦纹') : painted > 0.04 ? '纹饰边缘' : '素面'
    return {
      id: `${type}-f-${String(x.index + 1).padStart(2, '0')}`,
      artifactId: `art-${type}`,
      name: `${type === 'jar' ? '罐' : '碗'}片 ${String(x.r + 1).padStart(2, '0')}-${String(x.c + 1).padStart(2, '0')}`,
      mesh: x.mesh,
      centroid: x.centroid,
      matrix: scatterMatrix(rng, x.index),
      truthMatrix: x.truthMatrix,
      locked: false,
      included: true,
      area,
      bboxSize: bbox,
      group: {
        sizeGroup,
        patternGroup,
        tags: [`第${x.r + 1}排`, sizeGroup === 'large' ? '大片' : sizeGroup === 'medium' ? '中片' : '小片', patternGroup],
      },
      createdAt: now,
      updatedAt: now,
    }
  })

  return { artifactCode: type === 'jar' ? 'TEST-JAR-01' : 'TEST-BOWL-01', fragments, dropped }
}

function paintedRatio(mesh: FragmentRecord['mesh']): number {
  let painted = 0
  let outer = 0
  for (let f = 0; f < mesh.faceKinds.length; f++) {
    if (mesh.faceKinds[f] !== FACE_KIND.OUTER) continue
    outer++
    const i0 = mesh.indices[f * 3] * 3
    const brightness = (mesh.colors![i0] + mesh.colors![i0 + 1] + mesh.colors![i0 + 2]) / 3
    if (brightness < 0.34) painted++
  }
  return outer ? painted / outer : 0
}

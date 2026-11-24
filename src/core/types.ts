import type { Mat4, Vec3 } from './math.ts'

export type ID = string

export type VesselType = 'jar' | 'bowl'
export type Material = '陶' | '瓷' | '釉陶' | '未定'

export interface Artifact {
  id: ID
  code: string
  name: string
  excavationUnit: string
  vesselType: VesselType
  material: Material
  dynasty?: string
  description?: string
  createdAt: number
  updatedAt: number
}

export type FaceKind = 0 | 1 | 2 | 3 | 4

export const FACE_KIND = {
  UNKNOWN: 0,
  OUTER: 1,
  INNER: 2,
  FRACTURE: 3,
  ORIGINAL: 4,
} as const

export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
  colors?: Float32Array
  faceKinds: Uint8Array
}

export interface FragmentGroup {
  sizeGroup: 'large' | 'medium' | 'small'
  patternGroup: string
  tags: string[]
}

export interface FragmentRecord {
  id: ID
  artifactId: ID
  name: string
  mesh: MeshData
  centroid: Vec3
  matrix: Mat4
  truthMatrix?: Mat4
  locked: boolean
  included: boolean
  area: number
  bboxSize: Vec3
  group: FragmentGroup
  createdAt: number
  updatedAt: number
}

export interface ScoreParts {
  contour: number
  curvature: number
  surface: number
  pattern: number
  gap: number
}

export interface PairCandidate {
  id: string
  artifactId: ID
  aId: ID
  bId: ID
  aSegment: number
  bSegment: number
  // X 把 b 的局部坐标变换到 a 的局部坐标
  relative: Mat4
  score: number
  confidence: number
  parts: ScoreParts
  basis: string[]
  rms: number
}

export type StepType = 'auto' | 'manual' | 'lock' | 'unlock' | 'reset' | 'delete'

export interface AssemblyStep {
  id: ID
  artifactId: ID
  at: number
  type: StepType
  fragmentId?: ID
  pairId?: string
  title: string
  detail: string
  score?: number
  basis?: string[]
  before?: Mat4
  after?: Mat4
  undoable: boolean
  undone?: boolean
}

export interface Settings {
  id: 'app'
  contourWeight: number
  curvatureWeight: number
  surfaceWeight: number
  patternWeight: number
  autoThreshold: number
  snapDistanceMm: number
  maxPiecesSeconds: number
  axisAligned?: boolean
  showNoise?: boolean
}

export interface BenchmarkResult {
  generatedAt: number
  pieceCount: number
  retainedCount: number
  elapsedMs: number
  maxPositionErrorMm: number
  maxAngleErrorDeg: number
  meanPositionErrorMm: number
  meanAngleErrorDeg: number
  passedAccuracy: boolean
  passedTime: boolean
  pairsEvaluated: number
  steps: number
}

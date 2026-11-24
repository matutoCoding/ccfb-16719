import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { BufferGeometry } from 'three'
import { BufferAttribute } from 'three'
import { classifyMesh } from '../core/classify.ts'
import { meshArea, meshBBox, meshCenter, translateMesh } from '../core/mesh-builder.ts'
import { matCompose, quatFromAxisAngle } from '../core/math.ts'
import type { FragmentRecord, MeshData } from '../core/types.ts'
import { uid } from './ui.ts'

async function readGeometry(file: File): Promise<BufferGeometry> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'ply') {
    const buffer = await file.arrayBuffer()
    return new PLYLoader().parse(buffer)
  }
  const text = await file.text()
  const group = new OBJLoader().parse(text)
  let geometry: BufferGeometry | null = null
  group.traverse((obj: any) => {
    const mesh = obj as unknown as { isMesh?: boolean; geometry?: BufferGeometry }
    if (mesh.isMesh && mesh.geometry && !geometry) {
      geometry = mesh.geometry
    }
  })
  if (!geometry) throw new Error('OBJ 中没有找到网格')
  return geometry
}

function toMeshData(geometry: BufferGeometry): MeshData {
  let g = geometry
  if (!g.index) {
    const count = g.attributes.position.count
    const indices = new Uint32Array(count)
    for (let i = 0; i < count; i++) indices[i] = i
    g.setIndex(new BufferAttribute(indices, 1))
  }
  const pos = new Float32Array(g.attributes.position.array as ArrayLike<number>)
  const indexSource = g.index!.array as ArrayLike<number>
  const indices = indexSource instanceof Uint32Array ? indexSource : Uint32Array.from(indexSource)
  let colors: Float32Array | undefined
  const colorAttr = g.attributes.color
  if (colorAttr) colors = new Float32Array(colorAttr.array as ArrayLike<number>)
  const faceCount = indices.length / 3
  const mesh: MeshData = {
    positions: pos,
    indices,
    colors,
    faceKinds: new Uint8Array(faceCount),
  }
  classifyMesh(mesh)
  return mesh
}

function scatterMatrix(index: number) {
  const angle = index * 2.399 + Math.random() * 0.4
  const radius = 220 + Math.random() * 180
  return matCompose(
    [Math.cos(angle) * radius, 70 + Math.random() * 80, Math.sin(angle) * radius],
    quatFromAxisAngle([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], Math.random() * Math.PI * 2),
  )
}

export async function importFragmentFile(file: File, artifactId: string, index: number): Promise<FragmentRecord> {
  const geometry = await readGeometry(file)
  const mesh = toMeshData(geometry)
  const centroid = meshCenter(mesh.positions)
  translateMesh(mesh, centroid)
  const area = meshArea(mesh)
  const bbox = meshBBox(mesh).size
  const now = Date.now()
  const sizeGroup = area > 12000 ? 'large' : area > 5000 ? 'medium' : 'small'
  return {
    id: uid('frag'),
    artifactId,
    name: file.name.replace(/\.(ply|obj)$/i, ''),
    mesh,
    centroid,
    matrix: scatterMatrix(index),
    locked: false,
    included: true,
    area,
    bboxSize: bbox,
    group: {
      sizeGroup,
      patternGroup: mesh.colors ? '带彩绘/纹理' : '素面',
      tags: ['导入模型', sizeGroup === 'large' ? '大片' : sizeGroup === 'medium' ? '中片' : '小片'],
    },
    createdAt: now,
    updatedAt: now,
  }
}

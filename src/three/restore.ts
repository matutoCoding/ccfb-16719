import * as THREE from 'three'
import { outerRadius } from '../core/vessel.ts'
import { DEFAULT_SPECS } from '../core/vessel.ts'
import type { VesselType } from '../core/types.ts'

export function createLatheReconstruction(type: VesselType): THREE.Object3D {
  const spec = DEFAULT_SPECS[type]
  const points: THREE.Vector2[] = []
  const steps = 72
  for (let i = 0; i <= steps; i++) {
    const y = (spec.height * i) / steps
    points.push(new THREE.Vector2(outerRadius(type, y, spec.height, spec.radius), y))
  }
  const geometry = new THREE.LatheGeometry(points, 96)
  const material = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0369a1,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.28,
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'symmetric-restoration'

  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.16 }),
  )
  wire.position.y = 0.2
  mesh.add(wire)
  return mesh
}

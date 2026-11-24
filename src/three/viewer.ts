import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { FragmentRecord } from '../core/types.ts'
import type { Mat4 } from '../core/math.ts'

export type ViewerMode = 'orbit' | 'translate' | 'rotate' | 'correct'

export interface MatrixCommit {
  id: string
  before: Mat4
  after: Mat4
}

export class FragmentViewer {
  container: HTMLElement
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  transform: TransformControls
  fragmentGroup = new THREE.Group()
  auxiliary = new THREE.Group()
  meshes = new Map<string, THREE.Mesh>()
  mode: ViewerMode = 'orbit'
  onCommit?: (commit: MatrixCommit) => void
  onFaceCorrect?: (id: string, faceIndex: number) => void
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private resizeObserver: ResizeObserver
  private beforeMatrix: Mat4 | null = null
  private highlight?: THREE.LineSegments

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 1, 5000)
    this.camera.position.set(430, 300, 520)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 110, 0)

    this.transform = new TransformControls(this.camera, this.renderer.domElement)
    this.transform.addEventListener('dragging-changed', (event: any) => {
      this.controls.enabled = !event.value
      if (event.value) {
        const obj = this.transform.object as THREE.Mesh | null
        if (obj) this.beforeMatrix = (obj.userData.fragmentMatrix as Mat4 | undefined)?.slice() ?? obj.matrix.toArray()
      } else if (this.transform.object && this.beforeMatrix) {
        const id = this.transform.object.userData.fragmentId as string
        const after = this.transform.object.matrix.toArray() as Mat4
        ;(this.transform.object.userData as { fragmentMatrix?: Mat4 }).fragmentMatrix = after
        this.onCommit?.({ id, before: this.beforeMatrix, after })
        this.beforeMatrix = null
      }
    })
    this.transform.addEventListener('objectChange', () => {
      const object = this.transform.object as THREE.Mesh | null
      object?.updateMatrix()
    })
    const transformHelper = (typeof (this.transform as any).getHelper === 'function'
      ? (this.transform as any).getHelper()
      : this.transform) as THREE.Object3D
    this.scene.add(transformHelper)

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(320, 520, 260)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -600
    key.shadow.camera.right = 600
    key.shadow.camera.top = 600
    key.shadow.camera.bottom = -600
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x99f6e4, 0.7)
    fill.position.set(-300, 180, -260)
    this.scene.add(fill)

    const grid = new THREE.GridHelper(1200, 24, 0x94a3b8, 0xcbd5e1)
    grid.position.y = -2
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.35
    this.scene.add(grid)
    this.scene.add(this.fragmentGroup, this.auxiliary)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.animate()
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  setMode(mode: ViewerMode): void {
    this.mode = mode
    this.transform.detach()
    if (mode === 'translate' || mode === 'rotate') {
      this.transform.setMode(mode)
      this.transform.showX = this.transform.showY = this.transform.showZ = true
    }
    this.renderer.domElement.style.cursor = mode === 'correct' ? 'crosshair' : 'grab'
  }

  setFragments(fragments: FragmentRecord[]): void {
    for (const child of [...this.fragmentGroup.children]) {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      ;(mesh.material as THREE.Material | undefined)?.dispose()
      this.fragmentGroup.remove(child)
    }
    this.meshes.clear()

    for (const f of fragments) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(f.mesh.positions, 3))
      if (f.mesh.colors) geometry.setAttribute('color', new THREE.BufferAttribute(f.mesh.colors, 3))
      geometry.setIndex(new THREE.BufferAttribute(f.mesh.indices, 1))
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      const material = new THREE.MeshStandardMaterial({
        color: f.mesh.colors ? 0xffffff : 0xb7794f,
        vertexColors: Boolean(f.mesh.colors),
        roughness: 0.88,
        metalness: 0.02,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.matrixAutoUpdate = false
      mesh.matrix.fromArray(f.matrix)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.fragmentId = f.id
      mesh.userData.fragmentMatrix = f.matrix
      this.meshes.set(f.id, mesh)
      this.fragmentGroup.add(mesh)
    }
  }

  setMatrix(id: string, matrix: Mat4): void {
    const mesh = this.meshes.get(id)
    if (!mesh) return
    mesh.matrix.fromArray(matrix)
    mesh.userData.fragmentMatrix = matrix
  }

  getMatrix(id: string): Mat4 | null {
    return (this.meshes.get(id)?.userData.fragmentMatrix as Mat4 | undefined) ?? null
  }

  attach(id: string): void {
    const mesh = this.meshes.get(id)
    if (mesh && (this.mode === 'translate' || this.mode === 'rotate')) this.transform.attach(mesh)
  }

  focus(id: string): void {
    const mesh = this.meshes.get(id)
    if (!mesh) return
    const box = new THREE.Box3().setFromObject(mesh)
    const center = box.getCenter(new THREE.Vector3())
    this.controls.target.copy(center)
    this.camera.position.copy(center).add(new THREE.Vector3(260, 180, 320))
    this.controls.update()
    this.attach(id)
  }

  setHighlight(ids: string[]): void {
    if (this.highlight) {
      this.scene.remove(this.highlight)
      this.highlight.geometry.dispose()
      ;(this.highlight.material as THREE.Material).dispose()
    }
    this.highlight = undefined
    for (const [id, mesh] of this.meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.emissive.set(ids.includes(id) ? 0x0f766e : 0x000000)
      mat.emissiveIntensity = ids.includes(id) ? 0.18 : 0
    }
  }

  private handlePointerUp = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], false)
    const hit = hits[0]
    if (!hit) return
    const id = hit.object.userData.fragmentId as string
    if (this.mode === 'correct' && hit.faceIndex != null) {
      this.showFaceHit(hit)
      this.onFaceCorrect?.(id, hit.faceIndex)
    } else if (this.mode === 'translate' || this.mode === 'rotate') {
      this.transform.attach(hit.object as THREE.Mesh)
    }
  }

  private showFaceHit(hit: THREE.Intersection): void {
    const mesh = hit.object as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry
    const index = geometry.index!
    const f = hit.faceIndex ?? 0
    const ia = index.getX(f * 3)
    const ib = index.getX(f * 3 + 1)
    const ic = index.getX(f * 3 + 2)
    const pos = geometry.attributes.position
    const points = [ia, ib, ib, ic, ic, ia].map((vi) => new THREE.Vector3().fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrix))
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 }))
    this.scene.add(line)
    window.setTimeout(() => {
      this.scene.remove(line)
      lineGeo.dispose()
    }, 900)
  }

  setAuxiliary(object: THREE.Object3D | null): void {
    this.auxiliary.clear()
    if (object) this.auxiliary.add(object)
  }

  dispose(): void {
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.controls.dispose()
    this.transform.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

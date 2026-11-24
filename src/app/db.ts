import type { Artifact, AssemblyStep, FragmentRecord, Settings } from '../core/types.ts'

const DB_NAME = 'ceramic-mending-workbench'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('artifacts')) db.createObjectStore('artifacts', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('fragments')) {
        const store = db.createObjectStore('fragments', { keyPath: 'id' })
        store.createIndex('artifactId', 'artifactId', { unique: false })
      }
      if (!db.objectStoreNames.contains('steps')) {
        const store = db.createObjectStore('steps', { keyPath: 'id' })
        store.createIndex('artifactId', 'artifactId', { unique: false })
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = run(transaction.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

export async function getAll<T>(store: string): Promise<T[]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}
export async function get<T>(store: string, id: string): Promise<T | undefined> {
  return tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>)
}
export async function put<T extends object>(store: string, value: T): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (s) => s.put(value))
}
export async function remove(store: string, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id))
}
export async function clearStore(store: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear())
}

export const listArtifacts = () => getAll<Artifact>('artifacts')
export const saveArtifact = (a: Artifact) => put('artifacts', a)
export const listFragments = async (artifactId?: string) => {
  const all = await getAll<FragmentRecord>('fragments')
  return artifactId ? all.filter((f) => f.artifactId === artifactId) : all
}
export const saveFragment = (f: FragmentRecord) => put('fragments', f)
export const saveFragments = async (items: FragmentRecord[]) => {
  for (const f of items) await put('fragments', f)
}
export const listSteps = (artifactId?: string) =>
  getAll<AssemblyStep>('steps').then((rows) =>
    (artifactId ? rows.filter((r) => r.artifactId === artifactId) : rows)
      .sort((a, b) => b.at - a.at),
  )
export const saveStep = (s: AssemblyStep) => put('steps', s)

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  contourWeight: 0.4,
  curvatureWeight: 0.2,
  surfaceWeight: 0.22,
  patternWeight: 0.18,
  autoThreshold: 45,
  snapDistanceMm: 120,
  maxPiecesSeconds: 30,
  axisAligned: true,
}

export async function getSettings(): Promise<Settings> {
  const stored = await get<Settings>('settings', 'app')
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
}
export const saveSettings = (s: Settings) => put('settings', s)

export async function deleteArtifactDeep(id: string): Promise<void> {
  const [fragments, steps] = await Promise.all([listFragments(id), listSteps(id)])
  await Promise.all([
    ...fragments.map((f) => remove('fragments', f.id)),
    ...steps.map((s) => remove('steps', s.id)),
    remove('artifacts', id),
  ])
}

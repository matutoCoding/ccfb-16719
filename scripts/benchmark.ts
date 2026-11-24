import { generateVessel } from '../src/core/generate.ts'
import { buildFeatures, evaluateAllPairs } from '../src/core/matcher.ts'
import { assembleKruskal, evaluateAgainstTruth } from '../src/core/assemble.ts'
import { finalizePoses } from '../src/core/finalize.ts'

function run(type: 'jar' | 'bowl') {
  const t0 = performance.now()
  const vessel = generateVessel(type, 0)
  const features = vessel.fragments.map((f) => buildFeatures(f.id, f.mesh))
  const contourCounts = features.map((x) => x.contours.length)
  const tMatch0 = performance.now()
  const pairs = evaluateAllPairs(features, `art-${type}`)
  const tMatch1 = performance.now()
  const assembly = assembleKruskal(vessel.fragments, pairs, 45)
  const finalized = finalizePoses(vessel.fragments, pairs, type)
  for (const [id, matrix] of finalized) assembly.matrices.set(id, matrix)
  const t1 = performance.now()
  const truth = vessel.fragments.map((f) => ({ id: f.id, truthMatrix: f.truthMatrix! }))
  const error = evaluateAgainstTruth(truth, assembly.matrices, true)

  console.log('\n===', type, '===')
  console.log('fragments', vessel.fragments.length, 'dropped', vessel.dropped.length)
  console.log('contour count min/max/avg', Math.min(...contourCounts), Math.max(...contourCounts), contourCounts.reduce((a, b) => a + b, 0) / contourCounts.length)
  console.log('pairs', pairs.length, 'match ms', (tMatch1 - tMatch0).toFixed(1), 'total ms', (t1 - t0).toFixed(1))
  console.log('attached', assembly.attached.length, 'unused', assembly.unused)
  console.log('max pos mm', error.maxPositionErrorMm.toFixed(4), 'mean', error.meanPositionErrorMm.toFixed(4))
  console.log('max ang deg', error.maxAngleErrorDeg.toFixed(4), 'mean', error.meanAngleErrorDeg.toFixed(4))
  console.log('top pairs:')
  for (const p of pairs.slice(0, 12)) {
    console.log(p.aId, p.bId, 'score', p.score, 'rms', p.rms.toFixed(3), 'parts', Object.values(p.parts).map((x) => x.toFixed(0)).join('/'))
  }
  console.log('worst fragments:')
  for (const x of error.perFragment.slice().sort((a, b) => b.angleDeg - a.angleDeg).slice(0, 8)) {
    console.log(x.id, 'pos', x.positionMm.toFixed(3), 'ang', x.angleDeg.toFixed(3))
  }
  return { error, elapsedMs: t1 - t0, count: vessel.fragments.length, attached: assembly.attached.length }
}

const jar = run('jar')
const bowl = run('bowl')
if (jar.error.maxPositionErrorMm > 1 || jar.error.maxAngleErrorDeg > 1 || jar.elapsedMs > 30000) {
  console.error('JAR_BENCH_FAILED')
  process.exitCode = 1
}

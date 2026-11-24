import { generateVessel } from '../core/generate.ts'
import type { Artifact, FragmentRecord, VesselType } from '../core/types.ts'
import { listArtifacts, saveArtifact, saveFragments } from './db.ts'

export async function seedVessel(type: VesselType): Promise<{ artifact: Artifact; fragments: FragmentRecord[] }> {
  const now = Date.now()
  const generated = generateVessel(type, now)
  const artifact: Artifact = {
    id: `art-${type}`,
    code: generated.artifactCode,
    name: type === 'jar' ? '青灰釉弦纹罐（测试复原器）' : '敞口莲瓣纹碗（测试复原器）',
    excavationUnit: type === 'jar' ? 'T03②:17' : 'T07③:04',
    vesselType: type,
    material: type === 'jar' ? '釉陶' : '陶',
    dynasty: '模拟标本',
    description: type === 'jar'
      ? '程序生成罐：4×6 分区，丢弃 3 片；断面含相干噪声，带弦纹与卷草纹。'
      : '程序生成碗：3×9 分区，丢弃 4 片；近口沿饰弦纹，腹壁饰莲瓣。',
    createdAt: now,
    updatedAt: now,
  }
  const fragments = generated.fragments.map((f) => ({ ...f, artifactId: artifact.id }))
  await saveArtifact(artifact)
  await saveFragments(fragments)
  return { artifact, fragments }
}

export async function ensureSeeded(): Promise<void> {
  const artifacts = await listArtifacts()
  if (!artifacts.some((a) => a.id === 'art-jar')) await seedVessel('jar')
  if (!artifacts.some((a) => a.id === 'art-bowl')) await seedVessel('bowl')
}

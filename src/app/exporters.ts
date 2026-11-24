import { transformPoint } from '../core/math.ts'
import type { Mat4 } from '../core/math.ts'
import type { AssemblyStep, FragmentRecord, PairCandidate } from '../core/types.ts'
import { downloadText } from './ui.ts'

export function exportMatricesJSON(fragments: FragmentRecord[], matrices: Map<string, Mat4>): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    coordinateConvention: 'column-major mat4, maps fragment local centered coordinates to artifact coordinates',
    fragments: fragments.map((f) => ({
      id: f.id,
      name: f.name,
      matrix: matrices.get(f.id) ?? f.matrix,
      locked: f.locked,
    })),
  }
  downloadText('fragment-transforms.json', JSON.stringify(payload, null, 2), 'application/json')
}

export function exportMergedOBJ(fragments: FragmentRecord[], matrices: Map<string, Mat4>): void {
  let out = '# Ceramic mending workbench assembled mesh\n'
  let vertexOffset = 1
  for (const f of fragments) {
    const m = matrices.get(f.id) ?? f.matrix
    out += `o ${f.id.replace(/[^\w.-]/g, '_')}\n`
    const p = f.mesh.positions
    for (let i = 0; i < p.length; i += 3) {
      const q = transformPoint(m, [p[i], p[i + 1], p[i + 2]])
      out += `v ${q[0].toFixed(4)} ${q[1].toFixed(4)} ${q[2].toFixed(4)}\n`
    }
    const idx = f.mesh.indices
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + vertexOffset
      const b = idx[i + 1] + vertexOffset
      const c = idx[i + 2] + vertexOffset
      out += `f ${a} ${b} ${c}\n`
    }
    vertexOffset += p.length / 3
  }
  downloadText('assembled-vessel.obj', out, 'text/plain')
}

export function exportSequenceSVG(steps: AssemblyStep[], pairs: PairCandidate[]): void {
  const pairMap = new Map(pairs.map((p) => [p.id, p]))
  const width = 1200
  const rowH = 76
  const height = 90 + steps.length * rowH
  const rows = steps.slice(0, 40)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
text{font-family:"Microsoft YaHei",sans-serif;fill:#0f172a}
.title{font-size:28px;font-weight:700}.muted{fill:#64748b;font-size:14px}
.name{font-size:18px;font-weight:600}.score{fill:#0f766e;font-size:16px;font-weight:700}
.card{fill:#fff;stroke:#e2e8f0;rx:16}.line{stroke:#99f6e4;stroke-width:4}
.circle{fill:#0f766e}.num{fill:#fff;font-size:16px;font-weight:700}
</style>
<rect width="100%" height="100%" fill="#f8fafc"/>
<text x="40" y="48" class="title">修复师拼接顺序图</text>
<text x="40" y="74" class="muted">按编号逐步拼接；每张卡片记录候选得分与几何依据。</text>
${rows.map((s, i) => {
    const y = 100 + i * rowH
    const pair = s.pairId ? pairMap.get(s.pairId) : undefined
    return `
<rect x="32" y="${y}" width="${width - 64}" height="60" class="card"/>
${i < rows.length - 1 ? `<line x1="62" y1="${y + 60}" x2="62" y2="${y + rowH}" class="line"/>` : ''}
<circle cx="62" cy="${y + 30}" r="18" class="circle"/>
<text x="62" y="${y + 36}" text-anchor="middle" class="num">${i + 1}</text>
<text x="96" y="${y + 27}" class="name">${s.title ?? s.fragmentId ?? '步骤'}</text>
<text x="96" y="${y + 49}" class="muted">${(s.basis ?? pair?.basis ?? []).slice(0, 2).join('；')}</text>
<text x="${width - 150}" y="${y + 37}" class="score">${s.score?.toFixed(1) ?? '--'} 分</text>`
  }).join('')}
</svg>`
  downloadText('assembly-sequence.svg', svg, 'image/svg+xml')
}

import type { AppContext } from '../app/context.ts'
import { exportMatricesJSON, exportMergedOBJ, exportSequenceSVG } from '../app/exporters.ts'
import { DEFAULT_SPECS } from '../core/vessel.ts'
import { FragmentViewer } from '../three/viewer.ts'
import { createLatheReconstruction } from '../three/restore.ts'
import { toast } from '../app/ui.ts'

export function renderRestorePage(ctx: AppContext): string {
  const type = ctx.state.artifacts.find((a) => a.id === ctx.state.currentArtifactId)?.vesselType ?? 'jar'
  const total = DEFAULT_SPECS[type].rows * DEFAULT_SPECS[type].cols
  const retained = ctx.state.fragments.length
  const missing = Math.max(0, total - retained)
  const completeness = Math.round((retained / total) * 100)
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">复原预览</h1>
      <p class="page-desc">查看整器三维拼合效果；蓝色半透明胎体按器型旋转对称轴补出缺失部位。可导出整器 OBJ、每片变换矩阵和拼接顺序图。</p>
    </div>
    <div class="actions">
      <select class="input" data-artifact-select style="min-width:220px">
        ${ctx.state.artifacts.map((a) => `<option value="${a.id}" ${a.id === ctx.state.currentArtifactId ? 'selected' : ''}>${a.name}</option>`).join('')}
      </select>
      <button class="btn" data-export-svg>拼接顺序图</button>
      <button class="btn" data-export-json>导出矩阵 JSON</button>
      <button class="btn primary" data-export-obj>导出整器 OBJ</button>
    </div>
  </div>

  <div class="stat-grid">
    <div class="stat"><div class="stat-value">${retained}</div><div class="stat-label">现存碎片</div></div>
    <div class="stat"><div class="stat-value">${missing}</div><div class="stat-label">模拟缺失片</div></div>
    <div class="stat"><div class="stat-value">${completeness}%</div><div class="stat-label">分区完整度</div></div>
    <div class="stat"><div class="stat-value">${ctx.state.steps.length}</div><div class="stat-label">可追溯步骤</div></div>
  </div>

  <div class="layout-work">
    <section class="panel" style="padding:12px">
      <div class="viewer" data-viewer>
        <div class="viewer-toolbar">
          <label class="btn small" style="background:rgba(255,255,255,.9)"><input type="checkbox" checked data-show-restoration style="margin-right:var(--sp-1)"/>显示对称补全</label>
        </div>
        <div class="viewer-hint">拖拽旋转 · 滚轮缩放 · 右键平移；蓝色半透明区域为补全参考</div>
      </div>
    </section>
    <aside class="panel">
      <h2 class="panel-title">导出与修复交付</h2>
      <div class="field">
        <label>交付内容</label>
        <div class="notice">OBJ 已应用每片当前矩阵；JSON 使用列主序 mat4，可直接被 three.js Matrix4.fromArray 读取。</div>
      </div>
      <div class="grid" style="gap:var(--sp-3)">
        <button class="btn" data-export-obj-2>下载拼好的整器网格 (.obj)</button>
        <button class="btn" data-export-json-2>下载每片变换矩阵 (.json)</button>
        <button class="btn primary" data-export-svg-2>生成修复师拼接顺序图 (.svg)</button>
      </div>
      <h3 style="margin:24px 0 12px;font-size:16px">颜色说明</h3>
      <div class="kv">
        <dt>陶片原色</dt><dd>导入顶点色/程序纹饰色</dd>
        <dt>蓝色透明</dt><dd>旋转轴对称补全部位</dd>
        <dt>琥珀描边</dt><dd>断面手动点选反馈</dd>
      </div>
      <div class="notice warn" style="margin-top:var(--sp-5)">真实修复时，对称补全只用于展示缺失区域，不代表纹饰和局部变形的唯一解。</div>
    </aside>
  </div>`
}

export function mountRestorePage(root: HTMLElement, ctx: AppContext): (() => void) | void {
  const viewer = new FragmentViewer(root.querySelector<HTMLElement>('[data-viewer]')!)
  viewer.setFragments(ctx.state.fragments)
  const type = ctx.state.artifacts.find((a) => a.id === ctx.state.currentArtifactId)?.vesselType ?? 'jar'
  const restoration = createLatheReconstruction(type)
  viewer.setAuxiliary(restoration)

  root.querySelector('[data-artifact-select]')?.addEventListener('change', (e) => ctx.selectArtifact((e.target as HTMLSelectElement).value))
  root.querySelector('[data-show-restoration]')?.addEventListener('change', (e) => {
    restoration.visible = (e.target as HTMLInputElement).checked
  })

  const matrices = () => new Map(ctx.state.fragments.map((f) => [f.id, f.matrix]))
  const doObj = () => {
    if (!ctx.state.fragments.length) return toast('没有可导出的碎片', 'error')
    exportMergedOBJ(ctx.state.fragments, matrices())
    toast('整器 OBJ 已导出', 'success')
  }
  const doJson = () => exportMatricesJSON(ctx.state.fragments, matrices())
  const doSvg = () => {
    if (!ctx.state.steps.length) return toast('还没有拼接步骤，请先运行自动拼对', 'error')
    exportSequenceSVG(ctx.state.steps, ctx.state.pairs)
    toast('拼接顺序 SVG 已生成', 'success')
  }
  root.querySelector('[data-export-obj]')?.addEventListener('click', doObj)
  root.querySelector('[data-export-obj-2]')?.addEventListener('click', doObj)
  root.querySelector('[data-export-json]')?.addEventListener('click', doJson)
  root.querySelector('[data-export-json-2]')?.addEventListener('click', doJson)
  root.querySelector('[data-export-svg]')?.addEventListener('click', doSvg)
  root.querySelector('[data-export-svg-2]')?.addEventListener('click', doSvg)

  return () => viewer.dispose()
}

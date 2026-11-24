import type { AppContext } from '../app/context.ts'
import { findSnapPose } from '../core/assemble.ts'
import { FragmentViewer } from '../three/viewer.ts'
import { toast } from '../app/ui.ts'

export function renderManualPage(ctx: AppContext): string {
  const fragments = ctx.state.fragments
  const locked = fragments.filter((f) => f.locked).length
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">手动调整</h1>
      <p class="page-desc">选择碎片后用三维变换手柄平移/旋转；松手自动保存并锁定。吸附会从候选配对中反推最近的匹配位姿，已锁定碎片不会被自动拼对覆盖。</p>
    </div>
    <div class="actions">
      <select class="input" data-artifact-select style="min-width:220px">
        ${ctx.state.artifacts.map((a) => `<option value="${a.id}" ${a.id === ctx.state.currentArtifactId ? 'selected' : ''}>${a.name}</option>`).join('')}
      </select>
      <button class="btn" data-snap>吸附到最近匹配位</button>
      <button class="btn ${locked ? 'is-locked' : ''}" data-toggle-selected-lock>锁定/解锁选中片</button>
    </div>
  </div>

  <div class="layout-work">
    <section class="panel" style="padding:12px">
      <div class="viewer" data-viewer>
        <div class="viewer-toolbar">
          <div class="segmented">
            <button class="active" data-mode="orbit">观察</button>
            <button data-mode="translate">平移</button>
            <button data-mode="rotate">旋转</button>
          </div>
        </div>
        <div class="viewer-hint">点击碎片选中；平移/旋转模式下拖动手柄，松手保存锁定</div>
      </div>
    </section>

    <aside class="panel">
      <h2 class="panel-title">碎片与锁定 <span class="badge warn">${locked} 锁定</span></h2>
      <p class="panel-sub">建议先在“自动拼对”生成候选和初始位姿，再回到这里细调。</p>
      <div class="list" style="max-height:620px">
        ${fragments.map((f) => `
          <div class="list-item" style="display:grid;gap:8px">
            <button class="" style="border:0;background:none;text-align:left;padding:0" data-select="${f.id}">
              <div class="list-title"><span>${f.name}</span>${f.locked ? '<span class="badge warn">锁定</span>' : '<span class="badge">未锁</span>'}</div>
              <div class="list-meta">${f.group.sizeGroup} · ${f.group.patternGroup}</div>
            </button>
            <div class="badge-row">
              <button class="btn small" data-focus="${f.id}">聚焦</button>
              <button class="btn small" data-lock="${f.id}">${f.locked ? '解锁' : '锁定'}</button>
            </div>
          </div>`).join('')}
      </div>
    </aside>
  </div>`
}

export function mountManualPage(root: HTMLElement, ctx: AppContext): (() => void) | void {
  const viewer = new FragmentViewer(root.querySelector<HTMLElement>('[data-viewer]')!)
  viewer.setFragments(ctx.state.fragments)
  let selectedId: string | null = ctx.state.fragments[0]?.id ?? null

  viewer.onCommit = async ({ id, before, after }) => {
    selectedId = id
    await ctx.commitManualMatrix(id, before, after)
  }

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      root.querySelectorAll('[data-mode]').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      viewer.setMode(b.dataset.mode as 'orbit' | 'translate' | 'rotate')
      if (selectedId) viewer.attach(selectedId)
    })
  })

  root.querySelector('[data-artifact-select]')?.addEventListener('change', (e) => ctx.selectArtifact((e.target as HTMLSelectElement).value))
  root.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) =>
    b.addEventListener('click', () => {
      selectedId = b.dataset.focus!
      viewer.setMode('translate')
      root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.mode === 'translate'))
      viewer.focus(selectedId)
    }))
  root.querySelectorAll<HTMLElement>('[data-select]').forEach((b) =>
    b.addEventListener('click', () => {
      selectedId = b.dataset.select!
      viewer.focus(selectedId)
    }))
  root.querySelectorAll<HTMLButtonElement>('[data-lock]').forEach((b) =>
    b.addEventListener('click', () => ctx.toggleLock(b.dataset.lock!)))
  root.querySelector('[data-toggle-selected-lock]')?.addEventListener('click', () => {
    if (!selectedId) return toast('请先选择碎片', 'error')
    ctx.toggleLock(selectedId)
  })

  root.querySelector('[data-snap]')?.addEventListener('click', async () => {
    if (!selectedId) return toast('请先选择要吸附的碎片', 'error')
    const current = viewer.getMatrix(selectedId)
    if (!current) return
    const snap = findSnapPose(selectedId, current, ctx.state.fragments, ctx.state.pairs, 5000)
    if (!snap) return toast('没有找到可用于吸附的候选，请先运行自动拼对', 'error', 4200)
    viewer.setMatrix(selectedId, snap.matrix)
    viewer.attach(selectedId)
    await ctx.commitManualMatrix(selectedId, current, snap.matrix, {
      title: `吸附调整 ${ctx.state.fragments.find((f) => f.id === selectedId)?.name ?? selectedId}`,
      detail: `按候选 ${snap.candidate.id} 吸附，偏差距离 ${snap.distance.toFixed(1)} mm。`,
      pairId: snap.candidate.id,
      score: snap.candidate.score,
      basis: snap.candidate.basis,
    })
    toast(`已吸附，候选得分 ${snap.candidate.score}`, 'success')
  })

  return () => viewer.dispose()
}

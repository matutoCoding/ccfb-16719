import type { AppContext } from '../app/context.ts'
import { scoreTone } from '../app/ui.ts'

export function renderMatchPage(ctx: AppContext): string {
  const pairs = ctx.state.pairs
  const steps = ctx.state.steps
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">自动拼对</h1>
      <p class="page-desc">Web Worker 中提取断面轮廓、曲率、器表法向与纹饰连续性，候选对按综合得分排序；确认两片后继续寻找下一片，逐步生成整器。</p>
    </div>
    <div class="actions">
      <select class="input" data-artifact-select style="min-width:220px">
        ${ctx.state.artifacts.map((a) => `<option value="${a.id}" ${a.id === ctx.state.currentArtifactId ? 'selected' : ''}>${a.name}</option>`).join('')}
      </select>
      <button class="btn primary" data-run ${ctx.state.matching ? 'disabled' : ''}>${ctx.state.matching ? '计算中…' : '开始自动拼对'}</button>
    </div>
  </div>

  ${ctx.state.matching ? `
    <section class="panel" style="margin-bottom:16px">
      <div class="panel-title"><span data-progress-text>正在初始化 Worker…</span><span class="badge primary">后台线程</span></div>
      <div class="progress"><i data-progress-bar style="width:${ctx.state.progress ? Math.round(ctx.state.progress.done / ctx.state.progress.total * 100) : 4}%"></i></div>
    </section>` : ''}

  <div class="stat-grid">
    <div class="stat"><div class="stat-value">${ctx.state.fragments.length}</div><div class="stat-label">参与碎片</div></div>
    <div class="stat"><div class="stat-value">${pairs.length}</div><div class="stat-label">候选配对</div></div>
    <div class="stat"><div class="stat-value">${steps.filter((s) => !s.undone).length}</div><div class="stat-label">有效步骤</div></div>
    <div class="stat"><div class="stat-value">${ctx.state.lastElapsedMs ? `${(ctx.state.lastElapsedMs / 1000).toFixed(1)}s` : '--'}</div><div class="stat-label">最近计算耗时</div></div>
  </div>

  <div class="layout-work">
    <section class="panel">
      <h2 class="panel-title">候选配对排序 <span class="badge">${pairs.length}</span></h2>
      ${pairs.length === 0 ? `
        <div class="empty"><div class="empty-icon">⌁</div><div class="empty-title">尚未计算候选对</div><div class="empty-desc">点击右上角“开始自动拼对”。罐/碗测试数据通常在 30 秒内完成。</div></div>` : `
        <div class="list" style="max-height:680px">
          ${pairs.slice(0, 80).map((p, i) => `
            <details class="list-item" data-pair="${p.id}">
              <summary style="cursor:pointer;list-style:none">
                <div class="list-title">
                  <span>#${i + 1} ${p.aId} ↔ ${p.bId}</span>
                  <span class="badge ${scoreTone(p.score)}">${p.score.toFixed(1)}</span>
                </div>
                <div class="list-meta">RMS ${p.rms.toFixed(3)} mm · 轮廓 ${p.parts.contour.toFixed(0)} · 曲率 ${p.parts.curvature.toFixed(0)} · 器表 ${p.parts.surface.toFixed(0)} · 纹饰 ${p.parts.pattern.toFixed(0)} · 支撑 ${p.parts.gap.toFixed(0)}</div>
                <div class="score-bar"><i style="width:${p.score}%"></i></div>
              </summary>
              <div class="notice" style="margin:12px 0 0">
                ${p.basis.map((b) => `<div>· ${b}</div>`).join('')}
              </div>
            </details>`).join('')}
        </div>`}
    </section>

    <aside class="panel">
      <h2 class="panel-title">拼对步骤 / 撤销</h2>
      <p class="panel-sub">每一步都保存得分、依据和前后矩阵。撤销只回退该步位姿，不删除候选记录。</p>
      ${steps.length === 0 ? '<div class="empty" style="min-height:220px"><div class="empty-title">暂无步骤</div><div class="empty-desc">运行自动拼对或在手动页调整碎片。</div></div>' : `
        <div class="sequence" style="max-height:650px;overflow:auto;padding-right:4px">
          ${steps.map((s) => `
            <div class="sequence-step ${s.undone ? 'undone' : ''}">
              <div>
                <div style="display:flex;justify-content:space-between;gap:8px">
                  <strong>${s.title}</strong>
                  ${s.score !== undefined ? `<span class="badge primary">${s.score.toFixed(1)}</span>` : ''}
                </div>
                <div class="list-meta" style="margin:var(--sp-1) 0">${s.detail ?? ''}</div>
                <div class="badge-row">
                  <span class="badge">${s.type === 'auto' ? '自动' : s.type === 'manual' ? '手动' : s.type}</span>
                  ${s.undone ? '<span class="badge danger">已撤销</span>' : ''}
                  ${s.undone
                    ? `<button class="btn small" data-redo="${s.id}">重做</button>`
                    : `<button class="btn small danger" data-undo="${s.id}">撤销</button>`}
                </div>
              </div>
            </div>`).join('')}
        </div>`}
    </aside>
  </div>`
}

export function mountMatchPage(root: HTMLElement, ctx: AppContext): void {
  root.querySelector('[data-artifact-select]')?.addEventListener('change', (e) => ctx.selectArtifact((e.target as HTMLSelectElement).value))
  root.querySelector('[data-run]')?.addEventListener('click', () => ctx.runAutoMatch())
  root.querySelectorAll<HTMLButtonElement>('[data-undo]').forEach((b) =>
    b.addEventListener('click', () => ctx.undoStep(b.dataset.undo!)))
  root.querySelectorAll<HTMLButtonElement>('[data-redo]').forEach((b) =>
    b.addEventListener('click', () => ctx.redoStep(b.dataset.redo!)))
}

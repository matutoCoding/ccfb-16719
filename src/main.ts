import './styles.css'
import type { AppContext, AppState } from './app/context.ts'
import { DEFAULT_SETTINGS, getSettings, listArtifacts, listFragments, listSteps, saveFragment, saveSettings, saveStep } from './app/db.ts'
import { ensureSeeded } from './app/seed.ts'
import { runMatching } from './app/match-service.ts'
import { uid, toast } from './app/ui.ts'
import type { AssemblyStep } from './core/types.ts'
import { renderArtifactsPage, mountArtifactsPage } from './pages/artifacts.ts'
import { renderFragmentsPage, mountFragmentsPage } from './pages/fragments.ts'
import { renderMatchPage, mountMatchPage } from './pages/match.ts'
import { renderManualPage, mountManualPage } from './pages/manual.ts'
import { renderRestorePage, mountRestorePage } from './pages/restore.ts'
import { renderSettingsPage, mountSettingsPage } from './pages/settings.ts'

const state: AppState = {
  artifacts: [],
  fragments: [],
  steps: [],
  settings: null,
  currentArtifactId: localStorage.getItem('currentArtifactId') ?? 'art-jar',
  pairs: [],
  lastElapsedMs: null,
  matching: false,
  progress: null,
}
const pairCache = new Map<string, AppState['pairs']>()
let cleanup: (() => void) | void

const routes: Record<string, { title: string; render: (ctx: AppContext) => string; mount?: (root: HTMLElement, ctx: AppContext) => (() => void) | void }> = {
  artifacts: { title: '器物档案', render: renderArtifactsPage, mount: mountArtifactsPage },
  fragments: { title: '碎片管理', render: renderFragmentsPage, mount: mountFragmentsPage },
  match: { title: '自动拼对', render: renderMatchPage, mount: mountMatchPage },
  manual: { title: '手动调整', render: renderManualPage, mount: mountManualPage },
  restore: { title: '复原预览', render: renderRestorePage, mount: mountRestorePage },
  settings: { title: '设置与验收', render: renderSettingsPage, mount: mountSettingsPage },
}

function currentRoute(): string {
  return location.hash.replace('#/', '') || 'artifacts'
}

export const ctx: AppContext = {
  state,
  navigate(hash) {
    location.hash = hash
  },
  async refresh() {
    state.artifacts = await listArtifacts()
    state.settings = (await getSettings()) ?? DEFAULT_SETTINGS
    if (!state.currentArtifactId && state.artifacts[0]) state.currentArtifactId = state.artifacts[0].id
    if (state.currentArtifactId) {
      state.fragments = await listFragments(state.currentArtifactId)
      state.steps = await listSteps(state.currentArtifactId)
      state.pairs = pairCache.get(state.currentArtifactId) ?? []
    }
    renderRoute()
  },
  async selectArtifact(id) {
    state.currentArtifactId = id
    localStorage.setItem('currentArtifactId', id)
    state.fragments = await listFragments(id)
    state.steps = await listSteps(id)
    state.pairs = pairCache.get(id) ?? []
    renderRoute()
  },
  async runAutoMatch() {
    if (!state.currentArtifactId || !state.settings || state.matching) return
    state.matching = true
    state.progress = { done: 0, total: 1 }
    renderRoute()
    try {
      const artifact = state.artifacts.find((a) => a.id === state.currentArtifactId)
      const oldMatrices = new Map(state.fragments.map((f) => [f.id, f.matrix.slice()]))
      const result = await runMatching(state.fragments, state.settings, artifact?.vesselType, (done, total) => {
        state.progress = { done, total }
        updateProgressOnly()
      })
      state.pairs = result.pairs ?? []
      state.lastElapsedMs = result.elapsedMs
      pairCache.set(state.currentArtifactId, state.pairs)

      const now = Date.now()
      const newSteps: AssemblyStep[] = []
      for (const remote of result.steps ?? []) {
        const after = result.matrices?.[remote.fragmentId]
        const fragment = state.fragments.find((f) => f.id === remote.fragmentId)
        if (!after || !fragment) continue
        const before = oldMatrices.get(remote.fragmentId) ?? fragment.matrix
        newSteps.push({
          id: uid('step'),
          artifactId: state.currentArtifactId,
          at: now + newSteps.length,
          type: 'auto',
          fragmentId: remote.fragmentId,
          pairId: remote.pairId,
          title: `自动拼入 ${fragment.name}`,
          detail: `得分 ${remote.score.toFixed(1)}；${remote.basis[0] ?? ''}`,
          score: remote.score,
          basis: remote.basis,
          before,
          after,
          undoable: true,
        })
      }
      for (const f of state.fragments) {
        const matrix = result.matrices?.[f.id]
        if (matrix && !f.locked) {
          f.matrix = matrix
          f.updatedAt = now
          await saveFragment(f)
        }
      }
      for (const step of newSteps) await saveStep(step)
      state.matching = false
      state.progress = null
      toast(`自动拼对完成：${state.pairs.length} 个候选，用时 ${(result.elapsedMs / 1000).toFixed(1)}s`, 'success')
      await ctx.refresh()
    } catch (error) {
      console.error(error)
      toast(error instanceof Error ? error.message : '自动拼对失败', 'error', 5000)
      state.matching = false
      state.progress = null
      renderRoute()
    }
  },
  async undoStep(stepId) {
    const step = state.steps.find((s) => s.id === stepId)
    const fragment = state.fragments.find((f) => f.id === step?.fragmentId)
    if (!step || !fragment || !step.before) return
    fragment.matrix = step.before
    step.undone = true
    await saveFragment(fragment)
    await saveStep(step)
    toast('已撤销该步，碎片位姿已回退')
    await ctx.refresh()
  },
  async redoStep(stepId) {
    const step = state.steps.find((s) => s.id === stepId)
    const fragment = state.fragments.find((f) => f.id === step?.fragmentId)
    if (!step || !fragment || !step.after) return
    fragment.matrix = step.after
    step.undone = false
    await saveFragment(fragment)
    await saveStep(step)
    await ctx.refresh()
  },
  async commitManualMatrix(id, before, after, extra = {}) {
    const fragment = state.fragments.find((f) => f.id === id)
    if (!fragment) return
    fragment.matrix = after
    fragment.locked = extra.type === 'lock' ? fragment.locked : true
    fragment.updatedAt = Date.now()
    const step: AssemblyStep = {
      id: uid('step'),
      artifactId: state.currentArtifactId!,
      at: Date.now(),
      type: 'manual',
      fragmentId: id,
      title: `手动调整 ${fragment.name}`,
      detail: '松手提交；该碎片已锁定，自动拼对不会覆盖。',
      before,
      after,
      undoable: true,
      ...extra,
    }
    await saveFragment(fragment)
    await saveStep(step)
    state.steps.unshift(step)
    toast('位姿已保存并锁定', 'success')
  },
  async toggleLock(id) {
    const f = state.fragments.find((x) => x.id === id)
    if (!f) return
    f.locked = !f.locked
    f.updatedAt = Date.now()
    await saveFragment(f)
    await ctx.refresh()
  },
}

function shell(route: string): string {
  const nav = [
    ['artifacts', '01', '器物档案'],
    ['fragments', '02', '碎片管理'],
    ['match', '03', '自动拼对'],
    ['manual', '04', '手动调整'],
    ['restore', '05', '复原预览'],
    ['settings', '06', '设置验收'],
  ]
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">瓷</div>
        <div><div class="brand-title">碎瓷拼对工作台</div><div class="brand-sub">3D Fragment Mending</div></div>
      </div>
      <nav class="nav">
        ${nav.map(([key, index, label]) => `
          <a class="nav-item ${route === key ? 'active' : ''}" href="#/${key}">
            <span class="nav-index">${index}</span><span>${label}</span>
          </a>`).join('')}
      </nav>
      <div class="side-foot">
        Web Worker 匹配 · IndexedDB 本地存储<br/>
        数据不出浏览器
      </div>
    </aside>
    <main class="main" id="page-root"></main>
  </div>`
}

function renderRoute(): void {
  const route = currentRoute()
  if (cleanup) {
    try { cleanup() } catch (e) { console.warn(e) }
    cleanup = undefined
  }
  if (!routes[route]) {
    location.hash = '#/artifacts'
    return
  }
  document.querySelector('#app')!.innerHTML = shell(route)
  const root = document.querySelector<HTMLElement>('#page-root')!
  root.innerHTML = routes[route].render(ctx)
  cleanup = routes[route].mount?.(root, ctx)
}

function updateProgressOnly(): void {
  const bar = document.querySelector<HTMLElement>('[data-progress-bar]')
  const text = document.querySelector<HTMLElement>('[data-progress-text]')
  if (state.progress && bar) {
    const pct = Math.round((state.progress.done / Math.max(1, state.progress.total)) * 100)
    bar.style.width = `${pct}%`
    if (text) text.textContent = `正在计算候选对 ${state.progress.done}/${state.progress.total}（${pct}%）`
  }
}

window.addEventListener('hashchange', renderRoute)
;(async function init() {
  await ensureSeeded()
  state.settings = await getSettings()
  if (!state.currentArtifactId) state.currentArtifactId = state.artifacts[0]?.id ?? null
  await ctx.refresh()
  if (!location.hash) location.hash = '#/artifacts'
})()

// 设置页保存后复用
export async function updateSettings(patch: Partial<AppState['settings']>): Promise<void> {
  if (!state.settings) return
  state.settings = { ...state.settings, ...patch }
  await saveSettings(state.settings)
  toast('设置已保存', 'success')
}

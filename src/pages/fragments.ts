import type { AppContext } from '../app/context.ts'
import { saveFragment } from '../app/db.ts'
import { importFragmentFile } from '../app/importers.ts'
import { toast } from '../app/ui.ts'
import { classifyMesh } from '../core/classify.ts'
import { FACE_KIND } from '../core/types.ts'
import { FragmentViewer } from '../three/viewer.ts'

export function renderFragmentsPage(ctx: AppContext): string {
  const current = ctx.state.artifacts.find((a) => a.id === ctx.state.currentArtifactId)
  const fragments = ctx.state.fragments
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">碎片管理</h1>
      <p class="page-desc">导入 PLY/OBJ 后自动识别光滑器表与粗糙断面；可在右侧列表按大小、纹饰分组，并可在三维视口里点选三角面手动修正。</p>
    </div>
    <div class="actions">
      <select class="input" data-artifact-select style="min-width:240px">
        ${ctx.state.artifacts.map((a) => `<option value="${a.id}" ${a.id === ctx.state.currentArtifactId ? 'selected' : ''}>${a.name}</option>`).join('')}
      </select>
      <button class="btn" data-reclassify>重新自动分区</button>
      <button class="btn primary" data-import-button>导入 PLY/OBJ</button>
      <input type="file" accept=".ply,.obj" multiple hidden data-file-input/>
    </div>
  </div>

  <div class="notice">当前：${current?.name ?? '未选择器物'} · ${fragments.length} 片。操作提示：开启“断面修正”后，点击三角面会在断面/器表之间切换。</div>

  <div class="layout-work">
    <section class="panel" style="padding:12px">
      <div class="viewer" data-viewer>
        <div class="viewer-toolbar">
          <div class="segmented">
            <button class="active" data-mode="orbit">旋转观察</button>
            <button data-mode="correct">断面修正</button>
          </div>
        </div>
        <div class="viewer-hint" data-hint>左键旋转 · 滚轮缩放 · 右键平移</div>
      </div>
    </section>

    <aside class="panel">
      <h2 class="panel-title">碎片分组 <span class="badge primary">${fragments.length}</span></h2>
      <div class="grid cols-3" style="gap:8px;margin-bottom:16px">
        ${['large', 'medium', 'small'].map((size) => {
          const label = size === 'large' ? '大片' : size === 'medium' ? '中片' : '小片'
          const count = fragments.filter((f) => f.group.sizeGroup === size).length
          return `<div class="stat" style="padding:12px"><div class="stat-value">${count}</div><div class="stat-label">${label}</div></div>`
        }).join('')}
      </div>
      <div class="field">
        <label>纹饰分组筛选</label>
        <select class="input" data-pattern-filter>
          <option value="">全部纹饰组</option>
          ${[...new Set(fragments.map((f) => f.group.patternGroup))].map((g) => `<option>${g}</option>`).join('')}
        </select>
      </div>
      <div class="list" data-fragment-list>
        ${fragments.map((f) => `
          <button class="list-item" data-focus="${f.id}">
            <div class="list-title"><span>${f.name}</span>${f.locked ? '<span class="badge warn">已锁定</span>' : ''}</div>
            <div class="list-meta">
              ${f.group.sizeGroup === 'large' ? '大片' : f.group.sizeGroup === 'medium' ? '中片' : '小片'} · ${f.group.patternGroup}<br/>
              面积 ${Math.round(f.area)} mm² · ${Math.round(f.bboxSize[0])}×${Math.round(f.bboxSize[1])}×${Math.round(f.bboxSize[2])} mm
            </div>
          </button>`).join('')}
      </div>
    </aside>
  </div>`
}

export function mountFragmentsPage(root: HTMLElement, ctx: AppContext): (() => void) | void {
  const host = root.querySelector<HTMLElement>('[data-viewer]')!
  const viewer = new FragmentViewer(host)
  viewer.setFragments(ctx.state.fragments)
  viewer.onFaceCorrect = async (id, faceIndex) => {
    const f = ctx.state.fragments.find((x) => x.id === id)
    if (!f) return
    const current = f.mesh.faceKinds[faceIndex]
    f.mesh.faceKinds[faceIndex] = current === FACE_KIND.FRACTURE ? FACE_KIND.OUTER : FACE_KIND.FRACTURE
    await saveFragment(f)
    toast(`${f.name} 第 ${faceIndex} 面已改为${f.mesh.faceKinds[faceIndex] === FACE_KIND.FRACTURE ? '断面' : '器表'}`, 'success')
  }

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      root.querySelectorAll('[data-mode]').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
      const mode = b.dataset.mode as 'orbit' | 'correct'
      viewer.setMode(mode)
      root.querySelector('[data-hint]')!.textContent = mode === 'correct'
        ? '点击三角面切换断面/器表'
        : '左键旋转 · 滚轮缩放 · 右键平移'
    })
  })

  root.querySelector('[data-artifact-select]')?.addEventListener('change', (e) => {
    ctx.selectArtifact((e.target as HTMLSelectElement).value)
  })
  root.querySelectorAll<HTMLElement>('[data-focus]').forEach((el) =>
    el.addEventListener('click', () => viewer.focus(el.dataset.focus!)))

  root.querySelector('[data-pattern-filter]')?.addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value
    root.querySelectorAll<HTMLElement>('[data-focus]').forEach((item) => {
      const f = ctx.state.fragments.find((x) => x.id === item.dataset.focus)!
      item.style.display = !value || f.group.patternGroup === value ? '' : 'none'
    })
  })

  root.querySelector('[data-import-button]')?.addEventListener('click', () =>
    root.querySelector<HTMLInputElement>('[data-file-input]')?.click())
  root.querySelector<HTMLInputElement>('[data-file-input]')?.addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement
    if (!ctx.state.currentArtifactId || !input.files?.length) return
    try {
      for (let i = 0; i < input.files.length; i++) {
        const f = await importFragmentFile(input.files[i], ctx.state.currentArtifactId, i)
        await saveFragment(f)
      }
      toast(`已导入 ${input.files.length} 个文件`, 'success')
      await ctx.refresh()
    } catch (err) {
      console.error(err)
      toast(err instanceof Error ? err.message : '导入失败', 'error', 5000)
    }
  })

  root.querySelector('[data-reclassify]')?.addEventListener('click', async () => {
    for (const f of ctx.state.fragments) {
      classifyMesh(f.mesh)
      await saveFragment(f)
    }
    toast('已按局部法向粗糙度重新识别断面', 'success')
    await ctx.refresh()
  })

  return () => viewer.dispose()
}

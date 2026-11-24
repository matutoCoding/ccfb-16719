import type { AppContext } from '../app/context.ts'
import { deleteArtifactDeep, listFragments, saveArtifact } from '../app/db.ts'
import { seedVessel } from '../app/seed.ts'
import { toast, uid } from '../app/ui.ts'
import type { Material, VesselType } from '../core/types.ts'

export function renderArtifactsPage(ctx: AppContext): string {
  const a = ctx.state.artifacts
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">器物档案</h1>
      <p class="page-desc">记录出土单位、器型、材质与修复状态。每件器物下挂所有碎片、匹配候选、操作历史和导出矩阵。</p>
    </div>
    <div class="actions">
      <button class="btn" data-seed="jar">重新生成罐</button>
      <button class="btn" data-seed="bowl">重新生成碗</button>
      <button class="btn primary" data-scroll-new>新建档案</button>
    </div>
  </div>

  <div class="stat-grid">
    <div class="stat"><div class="stat-value">${a.length}</div><div class="stat-label">器物档案</div></div>
    <div class="stat"><div class="stat-value">${ctx.state.fragments.length}</div><div class="stat-label">当前器物碎片</div></div>
    <div class="stat"><div class="stat-value">${ctx.state.pairs.length}</div><div class="stat-label">缓存候选配对</div></div>
    <div class="stat"><div class="stat-value">${ctx.state.steps.length}</div><div class="stat-label">记录步骤</div></div>
  </div>

  <div class="grid cols-2">
    <section class="panel">
      <h2 class="panel-title">档案列表</h2>
      <div class="list" style="max-height:560px">
        ${a.map((x) => `
          <div class="list-item ${x.id === ctx.state.currentArtifactId ? 'active' : ''}" data-open="${x.id}">
            <div class="list-title">
              <span>${x.name}</span>
              <span class="badge primary">${x.vesselType === 'jar' ? '罐' : '碗'}</span>
            </div>
            <div class="list-meta">
              编号 ${x.code} · 出土单位 ${x.excavationUnit}<br/>
              ${x.material}${x.dynasty ? ` · ${x.dynasty}` : ''}
            </div>
            <div class="badge-row" style="margin-top:var(--sp-2)">
              <span class="badge" data-count="${x.id}">碎片统计中</span>
              <button class="btn small primary" data-manage="${x.id}">管理碎片</button>
              <button class="btn small danger" data-delete="${x.id}">删除</button>
            </div>
          </div>`).join('')}
      </div>
    </section>

    <section class="panel" id="new-artifact">
      <h2 class="panel-title">新建器物档案</h2>
      <p class="panel-sub">没有真实三维文件时，可先用程序生成的罐/碗体验完整流程。</p>
      <form data-artifact-form>
        <div class="form-grid">
          <div class="field"><label>器物名称</label><input class="input" name="name" required placeholder="例：青釉四系罐"/></div>
          <div class="field"><label>藏品/考古编号</label><input class="input" name="code" required placeholder="例：T03②:17"/></div>
          <div class="field"><label>出土单位</label><input class="input" name="excavationUnit" required placeholder="探方/地层/墓号"/></div>
          <div class="field"><label>器型</label>
            <select class="input" name="vesselType">
              <option value="jar">罐</option><option value="bowl">碗</option>
            </select>
          </div>
          <div class="field"><label>材质</label>
            <select class="input" name="material">
              <option>陶</option><option>釉陶</option><option>瓷</option><option>未定</option>
            </select>
          </div>
          <div class="field"><label>年代</label><input class="input" name="dynasty" placeholder="例：北宋"/></div>
        </div>
        <div class="field"><label>档案说明</label><textarea class="input" name="description" placeholder="纹饰、残损、采集背景等"></textarea></div>
        <button class="btn primary" type="submit">保存档案并进入碎片管理</button>
      </form>
    </section>
  </div>`
}

export function mountArtifactsPage(root: HTMLElement, ctx: AppContext): void {
  listFragments().then((all) => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-count]')) {
      const id = el.dataset.count!
      el.textContent = `${all.filter((f) => f.artifactId === id).length} 片`
    }
  })

  root.querySelector('[data-scroll-new]')?.addEventListener('click', () => {
    root.querySelector('#new-artifact')?.scrollIntoView({ behavior: 'smooth' })
  })

  root.querySelectorAll<HTMLElement>('[data-open]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) return
      ctx.selectArtifact(el.dataset.open!)
    })
  })
  root.querySelectorAll<HTMLButtonElement>('[data-manage]').forEach((b) =>
    b.addEventListener('click', () => ctx.selectArtifact(b.dataset.manage!).then(() => ctx.navigate('#/fragments'))))
  root.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('确认删除该器物及其碎片、步骤记录？')) return
      await deleteArtifactDeep(b.dataset.delete!)
      toast('档案已删除', 'success')
      await ctx.refresh()
    }))
  root.querySelectorAll<HTMLButtonElement>('[data-seed]').forEach((b) =>
    b.addEventListener('click', async () => {
      const type = b.dataset.seed as VesselType
      await seedVessel(type)
      toast(`${type === 'jar' ? '罐' : '碗'}测试数据已重建`, 'success')
      await ctx.refresh()
    }))

  root.querySelector<HTMLFormElement>('[data-artifact-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const data = new FormData(form)
    const now = Date.now()
    const id = uid('art')
    await saveArtifact({
      id,
      name: String(data.get('name')),
      code: String(data.get('code')),
      excavationUnit: String(data.get('excavationUnit')),
      vesselType: String(data.get('vesselType')) as VesselType,
      material: String(data.get('material')) as Material,
      dynasty: String(data.get('dynasty') || ''),
      description: String(data.get('description') || ''),
      createdAt: now,
      updatedAt: now,
    })
    toast('档案已建立', 'success')
    await ctx.selectArtifact(id)
    ctx.navigate('#/fragments')
  })
}

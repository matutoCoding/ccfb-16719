import type { AppContext } from '../app/context.ts'
import { clearStore, saveSettings } from '../app/db.ts'
import { seedVessel } from '../app/seed.ts'
import { toast } from '../app/ui.ts'
import { evaluateAgainstTruth } from '../core/assemble.ts'

export function renderSettingsPage(ctx: AppContext): string {
  const s = ctx.state.settings
  if (!s) return '<div class="panel">设置加载中…</div>'
  const rows: Array<[keyof typeof s, string, number, number, number]> = [
    ['contourWeight', '断面轮廓权重', 0, 1, 0.01],
    ['curvatureWeight', '曲率权重', 0, 1, 0.01],
    ['surfaceWeight', '器表法向/曲率约束', 0, 1, 0.01],
    ['patternWeight', '纹饰连续性权重', 0, 1, 0.01],
  ]
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">设置与验收</h1>
      <p class="page-desc">调整匹配权重、吸附距离和性能目标。验收数据由程序生成：罐与碗各一套，断面带噪声并主动缺片。</p>
    </div>
  </div>

  <div class="grid cols-2">
    <section class="panel">
      <h2 class="panel-title">匹配参数</h2>
      ${rows.map(([key, label, min, max, step]) => `
        <div class="field">
          <label>${label}</label>
          <div class="range-row">
            <input type="range" min="${min}" max="${max}" step="${step}" value="${s[key] as number}" data-setting="${key}"/>
            <output>${Number(s[key]).toFixed(2)}</output>
          </div>
        </div>`).join('')}
      <div class="field">
        <label>自动拼对最低分：<strong>${s.autoThreshold}</strong></label>
        <input type="range" min="35" max="75" step="1" value="${s.autoThreshold}" data-setting="autoThreshold"/>
      </div>
      <div class="field">
        <label>手动吸附搜索半径（mm）：<strong>${s.snapDistanceMm}</strong></label>
        <input type="range" min="20" max="500" step="10" value="${s.snapDistanceMm}" data-setting="snapDistanceMm"/>
      </div>
      <label class="switch-row">
        <span><strong>器型轴归一化约束</strong><br/><span class="list-meta">生成数据与已归一化扫描件建议开启；任意原始朝向导入时关闭。</span></span>
        <input type="checkbox" ${s.axisAligned ? 'checked' : ''} data-axis/>
      </label>
      <button class="btn primary" data-save-settings>保存设置</button>
    </section>

    <section class="panel">
      <h2 class="panel-title">验收基准</h2>
      <div class="notice">命令行可运行 <span class="mono">pnpm benchmark</span>，直接执行 TypeScript 核心算法并输出最大位置/角度误差与耗时。</div>
      <div id="benchmark-result" class="notice" style="display:none"></div>
      <div class="grid" style="gap:var(--sp-3)">
        <button class="btn primary" data-browser-benchmark>在浏览器 Worker 中跑罐体验收</button>
        <button class="btn" data-seed-jar>重新生成罐测试数据</button>
        <button class="btn" data-seed-bowl>重新生成碗测试数据</button>
        <button class="btn danger" data-clear>清空 IndexedDB 并重置</button>
      </div>
      <h3 style="margin:24px 0 12px;font-size:16px">通过标准</h3>
      <div class="kv">
        <dt>位置误差</dt><dd>每片质心与真值 &lt; 1 mm</dd>
        <dt>角度误差</dt><dd>&lt; 1°</dd>
        <dt>性能</dt><dd>20 片器物自动拼对 &lt; 30 s</dd>
      </div>
    </section>
  </div>`
}

export function mountSettingsPage(root: HTMLElement, ctx: AppContext): void {
  const draft = { ...ctx.state.settings! }
  root.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.setting as keyof typeof draft
      const value = Number(input.value)
      ;(draft as Record<string, unknown>)[key] = value
      const output = input.closest('.field')?.querySelector('output')
      if (output) output.textContent = value.toFixed(2)
      const strong = input.closest('.field')?.querySelector('strong')
      if (strong) strong.textContent = String(value)
    })
  })
  root.querySelector('[data-axis]')?.addEventListener('change', (e) => {
    draft.axisAligned = (e.target as HTMLInputElement).checked
  })
  root.querySelector('[data-save-settings]')?.addEventListener('click', async () => {
    ctx.state.settings = draft
    await saveSettings(draft)
    toast('设置已保存', 'success')
  })
  root.querySelector('[data-seed-jar]')?.addEventListener('click', async () => {
    await seedVessel('jar')
    await ctx.refresh()
    toast('罐数据已生成', 'success')
  })
  root.querySelector('[data-seed-bowl]')?.addEventListener('click', async () => {
    await seedVessel('bowl')
    await ctx.refresh()
    toast('碗数据已生成', 'success')
  })
  root.querySelector('[data-clear]')?.addEventListener('click', async () => {
    if (!confirm('确认清空本机 IndexedDB 中的全部演示数据？')) return
    await Promise.all(['artifacts', 'fragments', 'steps', 'settings'].map((s) => clearStore(s)))
    location.reload()
  })
  root.querySelector('[data-browser-benchmark]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement
    button.disabled = true
    try {
      const seeded = await seedVessel('jar')
      await ctx.selectArtifact(seeded.artifact.id)
      await ctx.runAutoMatch()
      const matrices = new Map(ctx.state.fragments.map((f) => [f.id, f.matrix]))
      const truth = seeded.fragments.map((f) => ({ id: f.id, truthMatrix: f.truthMatrix! }))
      const report = evaluateAgainstTruth(truth, matrices, true)
      const box = document.querySelector<HTMLElement>('#benchmark-result')
      if (box) {
        box.style.display = 'block'
        box.innerHTML = `罐：${seeded.fragments.length} 片<br/>最大位置误差 ${report.maxPositionErrorMm.toFixed(4)} mm；最大角度误差 ${report.maxAngleErrorDeg.toFixed(4)}°<br/>Worker 耗时 ${(ctx.state.lastElapsedMs ?? 0).toFixed(0)} ms`
        box.className = report.maxPositionErrorMm < 1 && report.maxAngleErrorDeg < 1 ? 'notice' : 'notice warn'
      }
      toast(`验收完成：位置 ${report.maxPositionErrorMm.toFixed(3)}mm，角度 ${report.maxAngleErrorDeg.toFixed(3)}°`, 'success', 5000)
    } finally {
      button.disabled = false
    }
  })
}

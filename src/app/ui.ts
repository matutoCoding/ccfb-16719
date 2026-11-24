export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function toast(message: string, type: 'info' | 'success' | 'error' = 'info', timeout = 2600): void {
  let stack = document.querySelector<HTMLDivElement>('.toast-stack')
  if (!stack) {
    stack = document.createElement('div')
    stack.className = 'toast-stack'
    document.body.appendChild(stack)
  }
  const el = document.createElement('div')
  el.className = `toast ${type === 'info' ? '' : type}`
  el.textContent = message
  stack.appendChild(el)
  window.setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateY(6px)'
    window.setTimeout(() => el.remove(), 180)
  }, timeout)
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export function scoreTone(score: number): string {
  if (score >= 80) return 'success'
  if (score >= 60) return 'primary'
  if (score >= 45) return 'warn'
  return 'danger'
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  toast('已复制到剪贴板', 'success')
}

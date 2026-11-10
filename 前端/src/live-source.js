export const isStatic = false

export async function request(path, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), path === 'daily-report' ? 395000 : 45000)
  try {
    const response = await fetch('/api/' + path, { ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal })
    if (!response.ok) throw new Error('HTTP ' + response.status + '，请检查后端服务')
    return await response.json()
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? '请求超时，请稍后重试' : error.message || '无法连接数据服务')
  } finally { clearTimeout(timer) }
}

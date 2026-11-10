// 先完整读取并核对批次，再由调用方一次替换页面数据。
export async function readLiveBatch(request, categories, names = {}) {
  const keys = [...categories, 'meta']
  for (let attempt = 0; attempt < 2; attempt++) {
    const results = await Promise.allSettled(keys.map(key => request(key)))
    const failed = results.flatMap((result, index) => result.status === 'rejected' ? [keys[index]] : [])
    if (failed.length) throw new Error('以下区域未读取完成：' + failed.map(key => names[key] || key).join('、'))
    const batch = Object.fromEntries(keys.map((key, index) => [key, results[index].value]))
    const version = batch.meta?.loaded_at
    if (version && categories.every(key => batch[key]?.loaded_at === version)) return batch
    // 有其他窗口同时刷新时，只重读一次；不能将不同批次拼在一起。
  }
  throw new Error('数据批次已变化，请重新刷新')
}

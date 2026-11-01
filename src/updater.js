import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'

/** 当前应用版本号。取不到时返回空串，不抛异常。 */
export async function currentVersion() {
  try {
    return await getVersion()
  } catch (e) {
    console.error('[updater] getVersion failed', e)
    return ''
  }
}

/**
 * 检查更新。不抛异常，统一返回状态：
 *   { status: 'available', update, info } | { status: 'none' } | { status: 'error', message }
 * 注意：update 是 Rust 侧的句柄，不用时请调 closeUpdate 释放。
 */
export async function checkForUpdate({ timeout = 15000 } = {}) {
  try {
    const update = await check({ timeout })
    if (!update) return { status: 'none' }
    return {
      status: 'available',
      update,
      info: {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date || '',
        notes: update.body || ''
      }
    }
  } catch (e) {
    console.error('[updater] check failed', e)
    // 常见原因：断网、GitHub 不可达、latest.json 缺失或格式错误
    return { status: 'error', message: String(e?.message || e) }
  }
}

/** 释放更新句柄，避免重复检查时泄漏。 */
export function closeUpdate(update) {
  try {
    update?.close?.()
  } catch (e) {
    console.error('[updater] close failed', e)
  }
}

/**
 * 下载并安装。onProgress 收到 { phase, downloaded, total, percent }。
 *
 * ⚠️ Windows 上安装阶段进程会被强制退出（安装器限制），
 * 因此这个 Promise 通常不会 resolve —— 调用方不要依赖其返回值做后续 UI。
 */
export async function installUpdate(update, onProgress = () => {}) {
  let downloaded = 0
  let total = 0

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data?.contentLength || 0
        onProgress({ phase: 'started', downloaded, total, percent: 0 })
        break
      case 'Progress':
        downloaded += event.data?.chunkLength || 0
        onProgress({
          phase: 'progress',
          downloaded,
          total,
          percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0
        })
        break
      case 'Finished':
        onProgress({ phase: 'finished', downloaded, total, percent: 100 })
        break
      default:
        break
    }
  })

  onProgress({ phase: 'installing', downloaded, total, percent: 100 })
}

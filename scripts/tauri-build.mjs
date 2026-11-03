#!/usr/bin/env node
/**
 * tauri build 包装脚本
 *
 * 为什么需要它：tauri.conf.json 里 `bundle.createUpdaterArtifacts: true`
 * 会让每次构建都强制签名，否则报
 *   "A public key has been found, but no private key."
 *
 * 这里做两件事：
 *   1. 没有 TAURI_SIGNING_PRIVATE_KEY 时，自动回退到 ~/.tauri/kiko.key
 *   2. 把 TEMP/TMP 指向项目内 .tmp，规避 esbuild 清理系统临时文件失败
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const tmpDir = join(ROOT, '.tmp')
mkdirSync(tmpDir, { recursive: true })

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const fallback = join(homedir(), '.tauri', 'kiko.key')
  if (existsSync(fallback)) {
    process.env.TAURI_SIGNING_PRIVATE_KEY = fallback
    console.log(`[build] 使用默认签名私钥：${fallback}`)
  } else {
    console.error('\n[build] 未找到签名私钥，无法签名更新包。')
    console.error('  方式一：设置环境变量 TAURI_SIGNING_PRIVATE_KEY 指向私钥文件')
    console.error('  方式二：把私钥放到 ~/.tauri/kiko.key')
    console.error('  提示：私钥丢失后，已安装用户将无法再收到更新。\n')
    process.exit(1)
  }
}

// esbuild 在部分 Windows 环境下无法删除系统临时文件，统一重定向到项目内
process.env.TEMP = tmpDir
process.env.TMP = tmpDir

execFileSync('npm', ['run', 'tauri', '--', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
})

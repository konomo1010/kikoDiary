#!/usr/bin/env node
/**
 * kiko 发布脚本（本地构建 + 生成 latest.json + 上传 GitHub Release）
 *
 * 用法：
 *   npm run release -- 1.1.0
 *   npm run release -- 1.1.0 --notes .tmp/notes.md
 *   npm run release -- 1.1.0 --dry-run --skip-build   # 只预览 latest.json
 *   npm run release -- 1.1.0 --skip-build             # 复用已有构建产物
 *
 * 前置条件：
 *   1. 非 dry-run 时工作区需干净（版本号由本脚本修改）
 *   2. 已安装 gh 并登录（或设置 GH_TOKEN；脚本会尝试从 git credential 读取）
 *   3. 签名私钥存在（默认 ~/.tauri/kiko.key，可用 TAURI_SIGNING_PRIVATE_KEY 覆盖）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const pkgPath = join(ROOT, 'package.json')
const confPath = join(ROOT, 'src-tauri', 'tauri.conf.json')
const cargoPath = join(ROOT, 'src-tauri', 'Cargo.toml')
const nsisDir = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const rel = (p) => p.slice(ROOT.length + 1)

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim()
}

/** 只替换版本号字面量，保留文件原有格式与 BOM */
function replaceVersion(file, version) {
  const raw = readFileSync(file, 'utf8')
  const next = file.endsWith('.toml')
    ? raw.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
    : raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
  if (next === raw) fail(`未能更新版本号：${rel(file)}`)
  writeFileSync(file, next, 'utf8')
}

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
let notesFile = ''
const positional = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--notes') {
    notesFile = argv[++i] || ''
    continue
  }
  if (argv[i].startsWith('--')) continue
  positional.push(argv[i])
}
const version = positional[0] || ''
const dryRun = flags.has('--dry-run')
const skipBuild = flags.has('--skip-build')

if (!version) fail('用法：npm run release -- <version> [--notes <file>] [--dry-run] [--skip-build]')
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`版本号必须是 x.y.z 形式，收到：${version}`)

// ---------- 1. 工作区检查（dry-run 不修改任何文件，跳过） ----------
if (!dryRun) {
  const dirty = capture('git', ['status', '--porcelain'])
  if (dirty) fail(`工作区有未提交的改动，请先提交后再发布：\n${dirty}`)

  // ---------- 2. 同步三处版本号 ----------
  console.log(`\n▶ 更新版本号到 ${version}`)
  for (const f of [pkgPath, confPath, cargoPath]) replaceVersion(f, version)
  console.log('  package.json / tauri.conf.json / Cargo.toml 已同步')
} else {
  console.log('\n▶ dry-run：跳过工作区检查与版本号写入')
}

// ---------- 3. 准备签名私钥 ----------
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const fallback = join(homedir(), '.tauri', 'kiko.key')
  if (existsSync(fallback)) {
    process.env.TAURI_SIGNING_PRIVATE_KEY = fallback
    console.log(`▶ 使用默认签名私钥：${fallback}`)
  } else if (!skipBuild) {
    fail('未找到签名私钥。请设置 TAURI_SIGNING_PRIVATE_KEY，或放到 ~/.tauri/kiko.key')
  }
}

// ---------- 4. 构建 ----------
if (skipBuild) {
  console.log('\n▶ 跳过构建（--skip-build）')
} else {
  console.log(`\n▶ 开始构建 v${version}（约 1–3 分钟）`)
  run('npm', ['run', 'tauri:build'], { shell: true })
}

// ---------- 5. 定位产物 ----------
if (!existsSync(nsisDir)) fail(`未找到产物目录：${nsisDir}`)
const candidates = readdirSync(nsisDir).filter((f) => f.endsWith('_x64-setup.exe'))
const setupName = candidates.find((f) => f.includes(`_${version}_`))
if (!setupName) {
  fail(
    `未找到 v${version} 的安装包。\n` +
      `现有产物：${candidates.join(', ') || '(空)'}\n` +
      '请先执行 npm run tauri:build，或检查版本号是否写错。'
  )
}
const setupPath = join(nsisDir, setupName)
const sigPath = `${setupPath}.sig`
if (!existsSync(sigPath)) {
  fail(
    `未找到签名文件 ${setupName}.sig。\n` +
      '请确认 tauri.conf.json 里 bundle.createUpdaterArtifacts 为 true，且构建时私钥有效。'
  )
}
const signature = readFileSync(sigPath, 'utf8').trim()
if (!signature) fail('签名文件内容为空')
if (!setupName.includes(version)) {
  fail(`产物名叫 ${setupName}，与目标版本 ${version} 不一致（--skip-build 时请确认版本号）`)
}

// ---------- 6. 生成 latest.json ----------
const remote = capture('git', ['remote', 'get-url', 'origin'])
const repoMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/)
if (!repoMatch) fail(`无法从 origin 解析 GitHub 仓库：${remote}`)
const [, owner, repo] = repoMatch
const tag = `v${version}`
const assetUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}/${setupName}`

const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : ''
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: {
    'windows-x86_64': { signature, url: assetUrl }
  }
}
mkdirSync(join(ROOT, '.tmp'), { recursive: true })
const latestPath = join(ROOT, '.tmp', 'latest.json')
writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n', 'utf8')

console.log(`\n▶ 产物：${setupName}`)
console.log(`▶ 签名：${signature.slice(0, 28)}…（长度 ${signature.length}）`)
console.log(`▶ latest.json → ${rel(latestPath)}`)
console.log(`▶ 更新地址：${assetUrl}`)

if (dryRun) {
  console.log('\n' + JSON.stringify(latest, null, 2))
  console.log('\n▶ --dry-run：已停止，未提交、未打标签、未上传\n')
  process.exit(0)
}

// ---------- 7. 提交版本号 + 打标签 ----------
console.log(`\n▶ 提交版本号并打标签 ${tag}`)
run('git', ['add', rel(pkgPath), rel(confPath), rel(cargoPath)])
run('git', ['commit', '-m', `chore: release ${tag}`])
run('git', ['tag', '-a', tag, '-m', `kiko ${tag}`])

// ---------- 8. 推送到 GitHub ----------
console.log('\n▶ 推送提交与标签')
run('git', ['push', 'origin', 'HEAD'])
run('git', ['push', 'origin', tag])

// ---------- 9. 上传 Release ----------
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  try {
    const out = capture('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n'
    })
    const m = out.match(/^password=(.+)$/m)
    if (m) {
      process.env.GH_TOKEN = m[1].trim()
      console.log('▶ 已从 git credential 读取 GH_TOKEN')
    }
  } catch {
    /* 交给 gh 自己的登录态 */
  }
}

console.log('\n▶ 上传 Release 资产')
const ghArgs = ['release', 'create', tag, '--title', `kiko ${tag}`, '--latest']
if (notes) ghArgs.push('--notes-file', notesFile)
ghArgs.push(setupPath, sigPath, latestPath)
run('gh', ghArgs)

console.log(`\n✔ 发布完成：https://github.com/${owner}/${repo}/releases/tag/${tag}`)
console.log('  客户端下次检查更新时会读到 latest.json 并升级到该版本。\n')

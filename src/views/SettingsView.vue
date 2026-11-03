<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  state, userAvatarChar, load,
  setTheme, setShowListExcerpt, setCheckUpdatesOnStartup,
  setUserName, setUserAvatar, exportData, importData,
  openModal, toast,
  updateState, checkUpdate, promptInstallUpdate
} from '../store'
import * as dbApi from '../api'
import Icon from '../components/Icon.vue'
import { open } from '@tauri-apps/plugin-dialog'
import { currentVersion } from '../updater'

// ---------- 软件更新 ----------
const version = ref('')
const updateMsg = ref('')

async function onCheckUpdate() {
  if (updateState.status === 'checking' || updateState.installing) return
  updateMsg.value = ''
  const status = await checkUpdate()
  if (status === 'available') {
    toast(`发现新版本 v${updateState.version}`, 'success')
  } else if (status === 'none') {
    updateMsg.value = version.value ? `已是最新版本（v${version.value}）` : '已是最新版本'
  } else {
    updateMsg.value = '检查失败，请确认网络后重试'
    toast('检查更新失败', 'danger')
  }
}

// 数据导入 / 导出

const avatarPreview = computed(() => userAvatarChar())
const isImageAvatar = computed(() => (state.user.avatar || '').startsWith('data:image/'))

function pickAvatarImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    if (f.size > 2 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result || '')
      if (url) setUserAvatar(url)
    }
    reader.readAsDataURL(f)
    input.remove()
  }
  input.click()
}

// 数据目录配置
const dataDir = ref('')
const dataDirSaved = ref(false)

onMounted(async () => {
  try {
    dataDir.value = await dbApi.getDataDir()
  } catch (e) {
    console.error('[settings] get data dir failed', e)
  }
  version.value = await currentVersion()
})

async function applyDataDir(path, mode = 'migrate') {
  try {
    const res = await dbApi.setDataDir(path, mode)
    const newRoot = res && typeof res === 'object' ? res.root : res
    const oldDir = res && typeof res === 'object' ? res.oldDir : ''
    await load()  // 切换后立即从新目录重新加载数据
    dataDir.value = newRoot || '(默认：运行目录/data)'
    dataDirSaved.value = true
    setTimeout(() => { dataDirSaved.value = false }, 3000)

    // 覆盖后：询问是否清理原数据目录
    if (mode === 'overwrite' && oldDir && oldDir !== newRoot) {
      openModal({
        title: '清理原数据？',
        body: `当前数据已复制到新目录。\n原数据目录：${oldDir}\n是否删除原数据目录？（删除后数据只保留在新目录）`,
        confirmText: '清理原数据',
        danger: true,
        onConfirm: async () => {
          try {
            await dbApi.removeDataDir(oldDir)
            toast('原数据已清理', 'success')
          } catch (e) {
            console.error('[settings] remove old dir failed', e)
            toast('清理原数据失败', 'danger')
          }
        },
        onCancel: () => { /* 保留原数据 */ },
      })
    }
  } catch (e) {
    console.error('[settings] set data dir failed', e)
    toast('切换数据目录失败', 'danger')
  }
}

async function pickDataDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择数据目录',
  })
  if (!selected) return

  let info
  try {
    info = await dbApi.inspectDataDir(selected)
  } catch (e) {
    console.error('[settings] inspect data dir failed', e)
    toast('检查目录失败', 'danger')
    return
  }

  if (info.status === 'empty') {
    await applyDataDir(selected, 'migrate')
  } else if (info.status === 'kiko') {
    openModal({
      title: '该目录已有数据',
      body: '所选目录中已存在 kiko 数据。是否用当前数据覆盖它？选择「取消」将直接使用该目录已有的数据。',
      confirmText: '覆盖',
      danger: true,
      onConfirm: () => { applyDataDir(selected, 'overwrite') },
      onCancel: () => { applyDataDir(selected, 'keep') },
    })
  } else {
    toast('所选目录不是 kiko 的数据目录，请选择空目录或 kiko 数据目录', 'danger')
  }
}

function resetDataDir() {
  applyDataDir('', 'migrate')
}

async function cleanEmptyDirs() {
  try {
    const dirs = await dbApi.listEmptyDirs()
    if (!dirs || dirs.length === 0) {
      toast('没有空目录需要清理', 'success')
      return
    }
    const MAX = 20
    openModal({
      title: '清理空目录',
      body: `发现 ${dirs.length} 个空目录，是否清理这些空目录？`,
      list: dirs.slice(0, MAX).map((d) => d.rel),
      listMore: Math.max(0, dirs.length - MAX),
      confirmText: '清理',
      danger: true,
      onConfirm: async () => {
        try {
          const n = await dbApi.removeEmptyDirs()
          toast(`已清理 ${n} 个空目录`, 'success')
        } catch (e) {
          console.error('[settings] remove empty dirs failed', e)
          toast('清理空目录失败', 'danger')
        }
      },
    })
  } catch (e) {
    console.error('[settings] list empty dirs failed', e)
    toast('扫描空目录失败', 'danger')
  }
}
</script>

<template>
  <section class="view">
    <div class="page-head">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">个性化你的写作体验</p>
      </div>
    </div>

    <div class="settings-group">
      <h3>用户信息</h3>
      <p class="desc">设置头像与用户名，显示在侧栏底部与首页问候中。</p>
      <div class="setting-row">
        <div class="info"><b>用户名</b><span>显示在侧栏底部与首页问候中</span></div>
        <input type="text" class="text-input" :value="state.user.name" maxlength="12" @change="setUserName($event.target.value)">
      </div>
      <div class="setting-row">
        <div class="info"><b>头像</b><span>可用文字或图片，留空则自动取用户名首字</span></div>
        <div class="avatar-config">
          <div class="avatar">
            <img v-if="isImageAvatar" :src="state.user.avatar" alt="" class="avatar-img">
            <template v-else>{{ avatarPreview }}</template>
          </div>
          <input v-if="!isImageAvatar" type="text" class="text-input avatar-input" :value="state.user.avatar" maxlength="1" placeholder="自动" @input="setUserAvatar($event.target.value)">
          <button type="button" class="btn btn-ghost" @click="pickAvatarImage"><Icon name="image" /> 选择图片</button>
          <button v-if="isImageAvatar" type="button" class="btn-link" @click="setUserAvatar('')">恢复文字</button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h3>外观</h3>
      <p class="desc">选择主题。</p>
      <div class="setting-row">
        <div class="info"><b>主题模式</b><span>切换浅色 / 深色界面</span></div>
        <div class="theme-seg">
          <button :class="{ active: state.settings.theme === 'light' }" @click="setTheme('light')"><Icon name="sun" /> 浅色</button>
          <button :class="{ active: state.settings.theme === 'dark' }" @click="setTheme('dark')"><Icon name="moon" /> 深色</button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h3>偏好</h3>
      <p class="desc">列表展示相关的设置。</p>
      <div class="setting-row">
        <div class="info"><b>列表内容摘要</b><span>在日记列表中展示正文摘要文字</span></div>
        <label class="switch"><input type="checkbox" :checked="state.settings.showListExcerpt" @change="setShowListExcerpt($event.target.checked)"><span class="track"></span></label>
      </div>
    </div>

    <div class="settings-group">
      <h3>数据</h3>
      <p class="desc">数据目录、导入与导出。</p>
      <div class="setting-row">
        <div class="info">
          <b>数据目录</b>
          <span>当前：{{ dataDir }}。选择新目录后数据会自动迁移。</span>
        </div>
        <div class="data-dir-config">
          <button type="button" class="btn btn-ghost" @click="pickDataDir"><Icon name="folder" /> 选择目录</button>
          <button type="button" class="btn-link" @click="resetDataDir">恢复默认</button>
          <span v-if="dataDirSaved" class="saved-tip">已迁移</span>
        </div>
      </div>
      <div class="setting-row">
        <div class="info"><b>导出数据</b><span>下载全部日记为 JSON 文件</span></div>
        <button class="btn btn-ghost" @click="exportData"><Icon name="download" /> 导出</button>
      </div>
      <div class="setting-row">
        <div class="info"><b>导入数据</b><span>从 JSON 文件恢复日记与标签</span></div>
        <button class="btn btn-ghost" @click="importData"><Icon name="upload" /> 导入</button>
      </div>
      <div class="setting-row">
        <div class="info"><b>清理空目录</b><span>扫描数据目录中的空文件夹，确认后清理</span></div>
        <button class="btn btn-ghost" @click="cleanEmptyDirs"><Icon name="trash" /> 清理</button>
      </div>
    </div>

    <div class="settings-group">
      <h3>关于</h3>
      <p class="desc">版本信息与软件更新。</p>
      <div class="setting-row">
        <div class="info"><b>当前版本</b><span>{{ version || '未知' }}</span></div>
      </div>
      <div class="setting-row">
        <div class="info">
          <b>启动时检查更新</b>
          <span>开启后每次启动会连接 GitHub 检查新版本（默认关闭）</span>
        </div>
        <label class="switch">
          <input type="checkbox" :checked="state.settings.checkUpdatesOnStartup" @change="setCheckUpdatesOnStartup($event.target.checked)">
          <span class="track"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="info">
          <b>软件更新</b>
          <span>{{ updateMsg || '手动检查是否有新版本' }}</span>
        </div>
        <button class="btn btn-ghost" :disabled="updateState.status === 'checking' || updateState.installing" @click="onCheckUpdate">
          <Icon name="check" /> {{ updateState.status === 'checking' ? '检查中…' : '检查更新' }}
        </button>
      </div>
      <div v-if="updateState.status === 'available'" class="setting-row">
        <div class="info">
          <b>可更新到 v{{ updateState.version }}</b>
          <span>当前 v{{ updateState.currentVersion || version }} → v{{ updateState.version }}</span>
        </div>
        <button class="btn btn-primary" :disabled="updateState.installing" @click="promptInstallUpdate">
          <Icon name="download" /> {{ updateState.installing ? `下载中 ${updateState.percent}%` : '下载并安装' }}
        </button>
      </div>
      <div v-if="updateState.installing" class="update-progress">
        <div class="update-progress-bar" :style="{ width: updateState.percent + '%' }"></div>
      </div>
      <p v-if="updateState.installing" class="update-hint">正在下载更新，完成后程序会自动重启。</p>
      <p v-if="updateState.error" class="update-hint update-error">更新失败：{{ updateState.error }}</p>
    </div>

  </section>
</template>
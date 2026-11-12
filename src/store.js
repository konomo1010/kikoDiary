import { reactive, ref } from 'vue'
import { save } from '@tauri-apps/plugin-dialog'
import * as dbApi from './api'
import { SEED_DIARIES, SEED_TAGS } from './data/seed'
import { todayStr, normalizeContent, docToText } from './utils/helpers'
import { UNTAGGED_TAG, isUntaggedTag, withUntaggedTag } from './utils/tags'
import { checkForUpdate, closeUpdate, installUpdate as runInstallUpdate } from './updater'

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 16,
  showListExcerpt: true,
  showListTags: true,
  panelKeepScroll: false,
  diaryPanelOpen: false,
  diaryListWidth: 50,
  pinnedDiaryIds: [],
  // 启动时检查更新：默认关闭，可在「设置 → 关于」中开启
  checkUpdatesOnStartup: false
}
const DEFAULT_USER = { name: 'Kiko User', avatar: '' }

// UNTAGGED_TAG / isUntaggedTag / withUntaggedTag 来自 utils/tags：
// 「无标签」是系统保留的筛选项，永远在标签列表首位、不写进日记、不可重命名或删除。

const state = reactive({
  diaries: [],
  tags: withUntaggedTag(SEED_TAGS),
  settings: { ...DEFAULT_SETTINGS },
  user: { ...DEFAULT_USER },
  view: 'home',
  editingId: null,
  // 进入编辑页前的位置快照，用于面包屑与「返回来源」
  editorOrigin: null,
  // 日记列表的筛选状态（退回列表时原样恢复）
  diaryFilter: { tags: [], from: '', to: '', search: '' },
  // 各页面的滚动位置与已加载条数，同样用于「退回来时的地方」
  diaryScroll: 0,
  diaryVisible: 20,
  homeScroll: 0,
  search: '',
  panelTitle: '',
  panelDate: '',
  activeTags: [],
  hasTitle: true,
  calSelected: null,
  newDiaryDate: null,
  calPickerOpen: false,
  calPickerView: 'month',
  calPickerYear: new Date().getFullYear(),
  calPickerDecade: Math.floor(new Date().getFullYear() / 12) * 12
})

// Date cannot live inside reactive (internal slot access would break on the proxy)
const calAnchor = ref(new Date())

// ----- Modal -----
const modal = reactive({
  open: false,
  title: '',
  body: '',
  confirmText: '确定',
  danger: false,
  secondaryText: '',
  input: false,
  inputPlaceholder: '标签名',
  inputValue: '',
  list: [],
  listMore: 0,
  onConfirm: null,
  onCancel: null,
  onSecondary: null
})

// ----- Tag modal -----
const tagModal = reactive({ open: false, search: '' })

// ----- Toasts -----
const toasts = reactive([])
let toastId = 0

/* ================= Persistence (redb via Tauri commands) ================= */
let persistChain = Promise.resolve()

function buildExcerpt(content) {
  return docToText(content).replace(/\s/g, ' ').trim().slice(0, 80)
}

async function blobToHash(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  const arr = Array.from(new Uint8Array(hash))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function collectImages(content) {
  const images = []
  const keepImages = []
  const clone = JSON.parse(JSON.stringify(content ?? null))
  const blobNodes = []

  // 第一遍：还原已有图片 src 为绝对路径，收集 blob 节点
  const walk = (node) => {
    if (node && node.type === 'image' && node.attrs && node.attrs.src) {
      const src = node.attrs.src
      if (typeof src === 'string') {
        if (src.startsWith('blob:')) {
          blobNodes.push(node)
        } else if (src.startsWith('http://asset.localhost') || src.startsWith('asset:')) {
          // asset URL → 还原成磁盘绝对路径
          const raw = src
            .replace(/^http:\/\/asset\.localhost\//, '')
            .replace(/^asset:\/\/localhost\//, '')
          const abs = decodeURIComponent(raw)
          const fname = abs.split(/[\\/]/).pop()
          if (fname) keepImages.push(fname)
          node.attrs.src = abs
        } else if (!src.startsWith('http') && !src.startsWith('data:')) {
          // 已是绝对路径
          const fname = src.split(/[\\/]/).pop()
          if (fname) keepImages.push(fname)
        }
      }
    }
    if (node && Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(clone)

  // 第二遍：处理新 blob 图片，按内容哈希命名，相同内容去重（本地只存一份）
  const seen = new Set()
  for (const node of blobNodes) {
    const src = node.attrs.src
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const buf = await blob.arrayBuffer()
      const hash = await blobToHash(buf)
      const base64 = await arrayBufferToBase64(buf)
      const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
      const name = `${hash}.${ext}`
      node.attrs.src = name
      if (!seen.has(hash)) {
        images.push({ name, data: base64 })
        seen.add(hash)
      }
    } catch (e) {
      console.error('[store] collect image failed', e)
    }
  }

  return { content: clone, images, keepImages }
}

async function load() {
  try {
    let meta = await dbApi.loadMeta()
    if (meta == null) {
      // 仅首次初始化（meta.json 不存在）时写入示例；空数组表示用户已删除全部日记
      for (const s of SEED_DIARIES) {
        const content = normalizeContent(s.content)
        await dbApi.saveDiary({
          id: 0,
          title: s.title || '',
          date: s.date || '',
          tags: Array.isArray(s.tags) ? s.tags : [],
          content,
          text: docToText(content),
          wordCount: countWords(content),
          excerpt: buildExcerpt(content)
        })
      }
      meta = await dbApi.loadMeta()
    }
    state.diaries = meta || []

    const config = await dbApi.loadConfig()
    if (config) {
      Object.assign(state.settings, DEFAULT_SETTINGS, config.settings || {})
      Object.assign(state.user, DEFAULT_USER, config.user || {})
      if (Array.isArray(config.tags)) state.tags = config.tags
    }
    // 旧数据里没有「无标签」，补齐到首位（它是系统标签，不落盘也不可删）
    state.tags = withUntaggedTag(state.tags)
  } catch (e) {
    console.error('[store] load failed', e)
  }
}

async function writeConfig() {
  await dbApi.saveConfig({
    settings: state.settings,
    user: state.user,
    // 「无标签」是系统筛选项，不落盘（每次启动自动补齐）
    tags: state.tags.filter((t) => !isUntaggedTag(t))
  })
}

function persist() {
  persistChain = persistChain
    .then(() => writeConfig())
    .catch((e) => { console.error('[store] persist failed', e) })
}

/* ================= Derived helpers ================= */
function tagCount(name) {
  // 「无标签」统计的是没有任何标签的日记
  if (isUntaggedTag(name)) {
    return state.diaries.filter((d) => !(d.tags || []).length).length
  }
  return state.diaries.filter((d) => (d.tags || []).includes(name)).length
}

function computeStats() {
  const total = state.diaries.length
  const words = state.diaries.reduce((s, d) => s + (d.wordCount || 0), 0)
  const dates = state.diaries.map((d) => d.date).sort()
  const activeDays = new Set(dates).size
  return {
    total, words, activeDays,
    earliest: dates[0] || '—',
    latest: dates[dates.length - 1] || '—'
  }
}

function userAvatarChar() {
  const raw = (state.user.avatar || '').trim()
  if (raw.startsWith('data:image/')) {
    return (state.user.name || '拾').trim().charAt(0) || '拾'
  }
  const avatar = raw.charAt(0)
  if (avatar) return avatar
  return (state.user.name || '拾').trim().charAt(0) || '拾'
}

function countWords(s) {
  return docToText(s).replace(/\s/g, '').length
}

/* ================= Navigation ================= */
function showView(view) {
  state.view = view
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 记录「从哪儿来」：视图 + 日历选中日期（列表筛选存在 state.diaryFilter 里，无需快照） */
function captureLocation() {
  return {
    view: state.view === 'editor' ? 'diary' : state.view,
    calSelected: state.calSelected || null
  }
}

/** 回到一个位置快照（日历选中一并还原；列表筛选本来就没丢） */
function applyLocation(loc) {
  const target = loc && loc.view ? loc : { view: 'diary' }
  state.editingId = null
  state.newDiaryDate = null
  if (target.calSelected) state.calSelected = target.calSelected
  if (['home', 'diary', 'tags', 'settings'].includes(target.view)) showView(target.view)
  else showView('diary')
}

/**
 * 返回进入编辑页之前的位置：从日历进编辑就回首页日历，从日记列表进就回列表，
 * 标签筛选与滚动位置也一并恢复。
 */
function returnToOrigin() {
  const origin = state.editorOrigin
  state.editorOrigin = null
  applyLocation(origin)
}

/** 面包屑跳转：目标为 { view } */
function navigateTo(target) {
  if (!target || !target.view) return
  if (target.view === state.view) return
  state.editorOrigin = null
  state.editingId = null
  state.newDiaryDate = null
  showView(target.view)
}

/* ================= Diary CRUD ================= */
function newDiary(dateStr) {
  if (state.view !== 'editor') state.editorOrigin = captureLocation()
  state.editingId = null
  state.newDiaryDate = dateStr || null
  state.activeTags = []
  state.hasTitle = true
  showView('editor')
}

function editDiary(id) {
  if (state.view !== 'editor') state.editorOrigin = captureLocation()
  state.editingId = id
  const d = state.diaries.find((x) => x.id === id)
  state.activeTags = d ? [...(d.tags || [])] : []
  state.hasTitle = !!(d && d.title && d.title.trim())
  showView('editor')
}

// returns: null (saved) | 'title' (needs title focus) | 'tags' (tag modal opened)
// opts.stay    true 时保存后留在编辑页（Ctrl+S 用），false/缺省时保存并返回列表
// opts.onSaved 保存成功后的回调，参数为最终 id；编辑页用它刷新「未保存」快照
function saveDiary(title, content, dateStr, opts = {}) {
  const stay = !!opts.stay
  if (state.hasTitle && !title) {
    toast('请先写一个标题，或关闭标题栏', 'danger')
    return 'title'
  }
  if (!state.hasTitle && !state.activeTags.length) {
    toast('关闭标题后请至少选择一个标签', 'danger')
    openTagModal()
    return 'tags'
  }

  const editingId = state.editingId
  const existing = editingId == null ? null : state.diaries.find((x) => x.id === editingId)
  const date = dateStr || state.newDiaryDate || (existing ? existing.date : todayStr())
  const tags = [...state.activeTags]
  const wordCount = countWords(content)
  const excerpt = buildExcerpt(content)

  collectImages(content).then(({ content: resolvedContent, images, keepImages }) => {
    return dbApi.saveDiary({
      id: editingId == null ? 0 : editingId,
      title,
      date,
      tags,
      content: resolvedContent,
      text: docToText(resolvedContent),
      wordCount,
      excerpt,
      images,
      keepImages
    })
  }).then((result) => {
    const newId = Array.isArray(result) ? result[0] : result
    const dirName = Array.isArray(result) ? result[1] : ''
    if (editingId == null) {
      state.diaries.push({ id: newId, title, date, tags, wordCount, excerpt, dirName })
      // 留在编辑页时立刻转为编辑态，避免下次保存又新建一篇
      if (stay) state.editingId = newId
      toast('日记已保存', 'success')
    } else {
      const d = state.diaries.find((x) => x.id === editingId)
      if (d) {
        d.title = title
        d.date = date
        d.tags = tags
        d.wordCount = wordCount
        d.excerpt = excerpt
        if (dirName) d.dirName = dirName
      }
      toast('修改已保存', 'success')
    }
    state.newDiaryDate = null
    persist()
    // 留在编辑页：不切视图，让调用方刷新快照后可继续写作
    if (!stay) {
      if (opts.leaveTo) navigateTo(opts.leaveTo)
      else returnToOrigin()
    }
    if (typeof opts.onSaved === 'function') opts.onSaved(newId)
  }).catch((e) => {
    console.error('[store] saveDiary failed', e)
    toast('保存失败，请重试', 'danger')
  })

  return null
}

async function saveDiaryFromPanel(id, title, content, dateStr, panelTags) {
  const d = state.diaries.find((x) => x.id === id)
  if (!d) return false
  const tags = Array.isArray(panelTags) ? [...panelTags] : [...(d.tags || [])]
  if (state.hasTitle && !title) {
    toast('请先写一个标题，或关闭标题栏', 'danger')
    return false
  }
  if (!state.hasTitle && !tags.length) {
    toast('关闭标题后请至少选择一个标签', 'danger')
    openTagModal()
    return false
  }
  const wordCount = countWords(content)
  const excerpt = buildExcerpt(content)
  try {
    const { content: resolvedContent, images, keepImages } = await collectImages(content)
    const result = await dbApi.saveDiary({
      id,
      title,
      date: dateStr || d.date,
      tags,
      content: resolvedContent,
      text: docToText(resolvedContent),
      wordCount,
      excerpt,
      images,
      keepImages
    })
    const dirName = Array.isArray(result) ? result[1] : ''
    d.title = title
    d.date = dateStr || d.date
    d.tags = tags
    d.wordCount = wordCount
    d.excerpt = excerpt
    if (dirName) d.dirName = dirName
    persist()
    toast('修改已保存', 'success')
    return true
  } catch (e) {
    console.error('[store] saveDiaryFromPanel failed', e)
    toast('保存失败，请重试', 'danger')
    return false
  }
}

function togglePinDiary(id) {
  const list = state.settings.pinnedDiaryIds || (state.settings.pinnedDiaryIds = [])
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
  else list.push(id)
  persist()
  toast(index >= 0 ? '已取消置顶' : '已置顶', 'success')
}

async function duplicateDiary(id) {
  const d = state.diaries.find((x) => x.id === id)
  if (!d) return false
  try {
    const body = await dbApi.getBody(id)
    const content = normalizeContent(body)
    const tags = [...(d.tags || [])]
    const title = d.title && d.title.trim() ? `${d.title} 副本` : '副本'
    const date = todayStr()
    const resolved = await collectImages(content)
    const result = await dbApi.saveDiary({
      id: 0,
      title,
      date,
      tags,
      content: resolved.content,
      text: docToText(resolved.content),
      wordCount: countWords(resolved.content),
      excerpt: buildExcerpt(resolved.content),
      images: resolved.images,
      keepImages: resolved.keepImages
    })
    const newId = Array.isArray(result) ? result[0] : result
    const dirName = Array.isArray(result) ? result[1] : ''
    state.diaries.push({
      id: newId,
      title,
      date,
      tags,
      wordCount: countWords(resolved.content),
      excerpt: buildExcerpt(resolved.content),
      dirName
    })
    persist()
    toast('已复制日记', 'success')
    return true
  } catch (e) {
    console.error('[store] duplicateDiary failed', e)
    toast('复制失败，请重试', 'danger')
    return false
  }
}

async function saveDiaryTags(id, tags) {
  const d = state.diaries.find((x) => x.id === id)
  if (!d) return false
  if (!(d.title || '').trim() && !tags.length) {
    toast('关闭标题后请至少选择一个标签', 'danger')
    return false
  }
  try {
    const body = await dbApi.getBody(id)
    const content = normalizeContent(body)
    const resolved = await collectImages(content)
    await dbApi.saveDiary({
      id,
      title: d.title || '',
      date: d.date,
      tags: [...tags],
      content: resolved.content,
      text: docToText(resolved.content),
      wordCount: countWords(resolved.content),
      excerpt: buildExcerpt(resolved.content),
      images: resolved.images,
      keepImages: resolved.keepImages
    })
    d.tags = [...tags]
    persist()
    toast('标签已更新', 'success')
    return true
  } catch (e) {
    console.error('[store] saveDiaryTags failed', e)
    toast('保存标签失败，请重试', 'danger')
    return false
  }
}

function deleteDiary(id) {
  const d = state.diaries.find((x) => x.id === id)
  if (!d) return
  openModal({
    title: '删除这篇日记？',
    body: `${d.title && d.title.trim() ? `「${d.title}」` : '这篇日记'}删除后无法恢复。`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      dbApi.deleteDiary(id).then(() => {
        state.diaries = state.diaries.filter((x) => x.id !== id)
        persist()
        toast('日记已删除', 'success')
        returnToOrigin()
      }).catch((e) => {
        console.error('[store] deleteDiary failed', e)
        toast('删除失败，请重试', 'danger')
      })
    }
  })
}

function backFromEditor() {
  returnToOrigin()
}

/* ================= Tags ================= */
function toggleTag(tag) {
  const i = state.activeTags.indexOf(tag)
  if (i >= 0) state.activeTags.splice(i, 1)
  else state.activeTags.push(tag)
}

function openTagModal() {
  tagModal.open = true
  tagModal.search = ''
}

function closeTagModal() {
  // 关闭标题时至少需要一个标签；不满足则保持弹窗打开，让用户继续选择
  if (!state.hasTitle && !state.activeTags.length) {
    toast('关闭标题后请至少选择一个标签', 'danger')
    return
  }
  tagModal.open = false
}

function addTagFromModal(preset) {
  openModal({
    title: '新建标签',
    body: '输入一个新标签名，用于归类日记。',
    confirmText: '添加',
    input: true,
    inputValue: preset || '',
    onConfirm: (value) => {
      const name = value.trim()
      if (!name) { toast('标签名不能为空', 'danger'); return false }
      if (isUntaggedTag(name)) { toast(`「${UNTAGGED_TAG}」是系统标签，不能作为普通标签新建`, 'danger'); return false }
      if (state.tags.includes(name)) { toast('这个标签已存在', 'danger'); return false }
      state.tags.push(name)
      if (!state.activeTags.includes(name)) state.activeTags.push(name)
      persist()
      toast(`标签「${name}」已添加并选中`, 'success')
      tagModal.open = true
      return false
    }
  })
}

function openAddTag() {
  openModal({
    title: '添加标签',
    body: '输入一个新标签名，用于归类日记。',
    confirmText: '添加',
    input: true,
    onConfirm: (value) => {
      const name = value.trim()
      if (!name) { toast('标签名不能为空', 'danger'); return false }
      if (isUntaggedTag(name)) { toast(`「${UNTAGGED_TAG}」是系统标签，不能作为普通标签新建`, 'danger'); return false }
      if (state.tags.includes(name)) { toast('这个标签已存在', 'danger'); return false }
      state.tags.push(name)
      persist()
      toast(`标签「${name}」已添加`, 'success')
      return true
    }
  })
}

function renameTag(oldName) {
  if (isUntaggedTag(oldName)) {
    toast(`「${UNTAGGED_TAG}」是系统标签，不能重命名`, 'danger')
    return
  }
  openModal({
    title: '重命名标签',
    body: `把标签「${oldName}」改成新名称，所有引用它的日记会一并更新。`,
    confirmText: '保存',
    input: true,
    inputValue: oldName,
    onConfirm: (value) => {
      const name = value.trim()
      if (!name) { toast('标签名不能为空', 'danger'); return false }
      if (name === oldName) return true
      if (isUntaggedTag(name)) { toast(`「${UNTAGGED_TAG}」是系统标签，不能作为普通标签新建`, 'danger'); return false }
      if (state.tags.includes(name)) { toast('这个标签已存在', 'danger'); return false }
      const idx = state.tags.indexOf(oldName)
      if (idx > -1) state.tags[idx] = name
      state.diaries.forEach((d) => {
        if ((d.tags || []).includes(oldName)) {
          d.tags = d.tags.map((t) => (t === oldName ? name : t))
        }
      })
      if (state.activeTags.includes(oldName)) {
        state.activeTags = state.activeTags.map((t) => (t === oldName ? name : t))
      }
      persist()
      toast(`标签已重命名为「${name}」`, 'success')
      return true
    }
  })
}

function deleteTag(name) {
  if (isUntaggedTag(name)) {
    toast(`「${UNTAGGED_TAG}」是系统标签，不能删除`, 'danger')
    return
  }
  const used = state.diaries.filter((d) => (d.tags || []).includes(name)).length
  if (used > 0) {
    toast(`标签「${name}」正被 ${used} 篇日记使用，无法删除`, 'danger')
    return
  }
  openModal({
    title: '删除标签',
    body: `确定删除标签「${name}」吗？该标签会从所有日记中移除，但日记本身不会被删除。`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      state.tags = state.tags.filter((t) => t !== name)
      state.diaries.forEach((d) => {
        if (d.tags) d.tags = d.tags.filter((t) => t !== name)
      })
      state.activeTags = state.activeTags.filter((t) => t !== name)
      persist()
      toast(`标签「${name}」已删除`, 'success')
      return true
    }
  })
}

/* ================= Calendar ================= */
function calShift(delta) {
  state.calPickerOpen = false
  const d = new Date(calAnchor.value)
  d.setDate(1)
  d.setMonth(d.getMonth() + delta)
  calAnchor.value = d
}

function calGotoToday() {
  state.calPickerOpen = false
  calAnchor.value = new Date()
  state.calSelected = todayStr()
}

function calTogglePicker() {
  const y = calAnchor.value.getFullYear()
  state.calPickerOpen = !state.calPickerOpen
  if (state.calPickerOpen) {
    state.calPickerView = 'month'
    state.calPickerYear = y
    state.calPickerDecade = Math.floor(y / 12) * 12
  }
}

function calPickerToggleView() {
  state.calPickerView = state.calPickerView === 'month' ? 'year' : 'month'
}

function calPickerDecade(delta) {
  state.calPickerDecade += delta
}

function calPickerSelectYear(year) {
  state.calPickerYear = year
  state.calPickerView = 'month'
}

function calPickerYearStep(delta) {
  state.calPickerYear += delta
  state.calPickerDecade = Math.floor(state.calPickerYear / 12) * 12
}

function calPickerSelectMonth(m) {
  const d = new Date(calAnchor.value)
  d.setDate(1)
  d.setFullYear(state.calPickerYear)
  d.setMonth(m)
  calAnchor.value = d
  state.calPickerOpen = false
}

function calSelect(dateStr) {
  state.calSelected = dateStr
}

/* ================= Search / filter ================= */
function filterByTag(tag) {
  // 从标签页点进来：只看这个标签，并清掉残留的日期区间，避免「筛了却看不到」
  state.diaryFilter.tags = tag ? [tag] : []
  state.diaryFilter.from = ''
  state.diaryFilter.to = ''
  state.diaryFilter.search = ''
  state.search = ''
  showView('diary')
}

/* ================= Settings ================= */
function setTheme(t) {
  state.settings.theme = t
  applyTheme()
  persist()
}

function setShowListExcerpt(v) {
  state.settings.showListExcerpt = v
  persist()
  toast(v ? '已显示列表内容摘要' : '已隐藏列表内容摘要', 'success')
}

function setShowListTags(v) {
  state.settings.showListTags = !!v
  persist()
}

function setPanelKeepScroll(v) {
  state.settings.panelKeepScroll = !!v
  persist()
}

function setDiaryPanelOpen(v) {
  state.settings.diaryPanelOpen = !!v
  persist()
}

function setDiaryListWidth(v) {
  state.settings.diaryListWidth = Math.min(70, Math.max(25, Number(v) || 50))
  persist()
}

function setCheckUpdatesOnStartup(v) {
  state.settings.checkUpdatesOnStartup = !!v
  persist()
  toast(v ? '已开启启动时检查更新' : '已关闭启动时检查更新', 'success')
}

/* ================= Update ================= */
// 侧栏角标与设置页共用这一份状态
const updateState = reactive({
  status: 'idle', // idle | checking | available | none | error
  version: '',
  currentVersion: '',
  notes: '',
  installing: false,
  percent: 0,
  error: '',
  handle: null
})

/**
 * 检查更新。返回最终状态字符串。
 * 任何情况下都不抛异常 —— 断网、GitHub 不可达都只是 status === 'error'。
 */
async function checkUpdate() {
  if (updateState.status === 'checking' || updateState.installing) return updateState.status
  updateState.status = 'checking'
  updateState.error = ''
  if (updateState.handle) {
    closeUpdate(updateState.handle)
    updateState.handle = null
  }

  const res = await checkForUpdate()
  if (res.status === 'available') {
    updateState.status = 'available'
    updateState.handle = res.update
    updateState.version = res.info.version
    updateState.currentVersion = res.info.currentVersion
    updateState.notes = res.info.notes || ''
  } else if (res.status === 'none') {
    updateState.status = 'none'
  } else {
    updateState.status = 'error'
    updateState.error = res.message || ''
  }
  return updateState.status
}

/** 真正下载并安装。成功返回 true；Windows 上通常会随进程退出而中断。 */
async function installUpdateFlow() {
  if (!updateState.handle || updateState.installing) return false
  updateState.installing = true
  updateState.percent = 0
  updateState.error = ''
  try {
    await runInstallUpdate(updateState.handle, (p) => {
      updateState.percent = p.percent
    })
  } catch (e) {
    console.error('[store] install update failed', e)
    // 把真实原因暴露到界面上，否则只看到一句「请重试」无法排查
    updateState.error = String(e?.message || e || '未知错误')
    updateState.installing = false
    updateState.status = 'error'
    toast('更新安装失败，请重试', 'danger')
    return false
  }
  updateState.installing = false
  toast('更新已安装，请重新打开 kiko', 'success')
  return true
}

/**
 * 安装前的统一入口：编辑器里禁止直接装（本项目保存是手动的，
 * 而 Windows 安装更新会强制退出程序），其余情况弹确认框。
 */
function promptInstallUpdate() {
  if (updateState.status !== 'available' || updateState.installing) return
  if (state.view === 'editor') {
    openModal({
      title: '请先保存日记',
      body: '安装更新会退出程序，未保存的编辑内容会丢失。\n请先保存当前日记，再安装更新。',
      confirmText: '知道了'
    })
    return
  }
  openModal({
    title: `更新到 v${updateState.version}`,
    body: '将下载新版本并自动安装。\n安装完成后程序会自动重启。',
    confirmText: '立即更新',
    onConfirm: installUpdateFlow
  })
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.settings.theme)
}

/* ================= Editor dark mode (editor-local, independent of app theme) ================= */
const editorDark = ref(document.documentElement.getAttribute('data-theme') === 'dark')
function toggleEditorDark() {
  editorDark.value = !editorDark.value
}

function setUserName(v) {
  state.user.name = (v || '').trim() || 'Kiko User'
  persist()
  toast('用户名已更新', 'success')
}

function setUserAvatar(v) {
  const s = (v || '').trim()
  state.user.avatar = s.startsWith('data:image/') ? s : s.charAt(0)
  persist()
}

async function exportData() {
  try {
    const diaries = []
    for (const m of state.diaries) {
      const body = await dbApi.getBody(m.id)
      diaries.push({ ...m, content: body })
    }
    const json = JSON.stringify({ diaries, tags: state.tags.filter((t) => !isUntaggedTag(t)) }, null, 2)
    const path = await save({
      title: '导出数据',
      defaultPath: `kiko-${todayStr()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!path) return
    await dbApi.writeTextFile(path, json)
    toast(`已导出到 ${path}`, 'success')
  } catch (e) {
    console.error('[store] exportData failed', e)
    toast('导出失败', 'danger')
  }
}

function importData() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = () => {
    const file = input.files && input.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result)
        const diaries = Array.isArray(data)
          ? data
          : (data && Array.isArray(data.diaries) ? data.diaries : null)
        if (!diaries) throw new Error('no diaries')
        for (const d of diaries) {
          const content = normalizeContent(d.content)
          await dbApi.saveDiary({
            id: 0,
            title: d.title || '',
            date: d.date || todayStr(),
            tags: Array.isArray(d.tags) ? d.tags : [],
            content,
            text: docToText(content),
            wordCount: countWords(content),
            excerpt: buildExcerpt(content)
          })
        }
        state.diaries = (await dbApi.loadMeta()) || []
        if (data && !Array.isArray(data) && Array.isArray(data.tags)) {
          state.tags = withUntaggedTag(data.tags)
          persist()
        }
        toast(`已导入 ${diaries.length} 篇日记`, 'success')
        showView('diary')
      } catch (e) {
        toast('数据导入失败：文件格式不正确', 'danger')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

/* ================= Modal ================= */
function openModal(opts) {
  modal.open = true
  modal.title = opts.title
  modal.body = opts.body
  modal.confirmText = opts.confirmText || '确定'
  modal.danger = !!opts.danger
  modal.secondaryText = opts.secondaryText || ''
  modal.input = !!opts.input
  modal.inputPlaceholder = opts.inputPlaceholder || '标签名'
  modal.inputValue = opts.inputValue || ''
  modal.list = Array.isArray(opts.list) ? opts.list : []
  modal.listMore = opts.listMore || 0
  modal.onConfirm = opts.onConfirm || null
  modal.onCancel = opts.onCancel || null
  modal.onSecondary = opts.onSecondary || null
}

function closeModal() {
  modal.open = false
  modal.list = []
  modal.listMore = 0
  modal.onConfirm = null
  modal.onCancel = null
  modal.onSecondary = null
}

function cancelModal() {
  const fn = modal.onCancel
  closeModal()
  if (fn) fn()
}

function secondaryModal() {
  const fn = modal.onSecondary
  closeModal()
  if (fn) fn()
}

function confirmModal() {
  const fn = modal.onConfirm
  if (!fn) { closeModal(); return }
  let result = true
  if (modal.input) result = fn(modal.inputValue)
  else result = fn()
  if (result !== false) closeModal()
}

/* ================= Toast ================= */
function toast(msg, type = '') {
  const id = ++toastId
  toasts.push({ id, msg, type })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, 2400)
}

/* ================= Init ================= */
async function init() {
  await load()
  applyTheme()
  document.documentElement.style.fontSize = state.settings.fontSize + 'px'
  showView('home')
  scheduleStartupUpdateCheck()
}

/**
 * 启动后延迟静默检查更新。默认关闭（settings.checkUpdatesOnStartup）。
 * 任何失败都静默处理，绝不打断启动或写作。
 */
function scheduleStartupUpdateCheck() {
  if (!state.settings.checkUpdatesOnStartup) return
  setTimeout(async () => {
    // 正在编辑器里写作时不打扰
    if (state.view === 'editor') return
    const status = await checkUpdate()
    // 状态留在 updateState 里，侧栏角标会自动出现
    if (status === 'available') toast(`发现新版本 v${updateState.version}`, 'success')
  }, 3000)
}

/* ================= Sidebar ================= */
const SIDEBAR_COLLAPSED_KEY = 'kiko-sidebar-collapsed'
const sidebarCollapsed = ref(false)
try {
  sidebarCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
} catch (e) { /* ignore */ }
export {
  state,
  calAnchor,
  sidebarCollapsed,
  modal,
  tagModal,
  toasts,
  // persistence
  persist, load,
  // helpers
  tagCount, computeStats, userAvatarChar,
  // navigation
  showView, navigateTo, returnToOrigin,
  // diary
  newDiary, editDiary, saveDiary, saveDiaryFromPanel, saveDiaryTags, deleteDiary, backFromEditor,
  togglePinDiary, duplicateDiary,
  // tags
  UNTAGGED_TAG, isUntaggedTag, withUntaggedTag,
  toggleTag, openTagModal, closeTagModal, addTagFromModal, openAddTag, renameTag, deleteTag,
  // calendar
  calShift, calGotoToday, calTogglePicker, calPickerToggleView, calPickerDecade,
  calPickerSelectYear, calPickerYearStep, calPickerSelectMonth, calSelect,
  // search / filter
  filterByTag,
  // settings
  setTheme, setShowListExcerpt, setShowListTags, setPanelKeepScroll, setDiaryPanelOpen, setDiaryListWidth, setCheckUpdatesOnStartup,
  // update
  updateState, checkUpdate, installUpdateFlow, promptInstallUpdate,
  applyTheme, editorDark, toggleEditorDark,
  setUserName, setUserAvatar, exportData, importData,
  // modal
  openModal, closeModal, cancelModal, secondaryModal, confirmModal,
  // toast
  toast,
  // init
  init
}
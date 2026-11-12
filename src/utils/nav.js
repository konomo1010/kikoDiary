// 面包屑与「返回来源」共用的纯逻辑（不依赖 store，方便单测）

export const VIEW_LABELS = {
  home: '首页',
  diary: '日记',
  tags: '标签',
  settings: '设置',
  editor: '编辑',
}

const TITLE_MAX = 16

/**
 * 日记这一层反映当前筛选上下文：
 * 单标签 → 「标签：旅行」，多标签 → 「标签：旅行 等 3 个」，仅有日期区间 → 「日记 · 按日期」
 */
export function diaryLabel(filter) {
  const tags = filter && Array.isArray(filter.tags) ? filter.tags : []
  const hasRange = !!(filter && (filter.from || filter.to))
  const rawSearch = filter && typeof filter.search === 'string' ? filter.search.trim() : ''
  const search = rawSearch.length > 12 ? `${rawSearch.slice(0, 12)}…` : rawSearch

  if (search) {
    if (tags.length === 1) return `标签：${tags[0]} · 搜索：${search}`
    if (tags.length > 1) return `标签：${tags[0]} 等 ${tags.length} 个 · 搜索：${search}`
    if (hasRange) return `${VIEW_LABELS.diary} · 按日期 · 搜索：${search}`
    return `搜索：${search}`
  }

  if (tags.length === 1) return `标签：${tags[0]}`
  if (tags.length > 1) return `标签：${tags[0]} 等 ${tags.length} 个`
  if (hasRange) return `${VIEW_LABELS.diary} · 按日期`
  return VIEW_LABELS.diary
}

/** 编辑页那一层显示日记标题（过长截断），没有标题时退回「编辑日记」 */
export function editorLabel(editingId, diaries) {
  if (editingId == null) return '新建日记'
  const d = Array.isArray(diaries) ? diaries.find((x) => x.id === editingId) : null
  const title = d && typeof d.title === 'string' ? d.title.trim() : ''
  if (!title) return '编辑日记'
  return title.length > TITLE_MAX ? `编辑：${title.slice(0, TITLE_MAX)}…` : `编辑：${title}`
}

/**
 * 由当前位置生成面包屑。
 * loc: { view, editingId, diaries, diaryFilter, editorOrigin }
 * editorOrigin: 进入编辑页前的位置快照 { view, calSelected }
 * 首页是根，返回空数组（不渲染面包屑）。
 */
export function buildTrail(loc) {
  const { view, editingId, editorOrigin, diaryFilter, diaries } = loc || {}
  const home = { key: 'home', view: 'home', label: VIEW_LABELS.home }

  if (!view) return []
  if (view === 'home') return [home]

  if (view === 'editor') {
    const editor = { key: 'editor', view: 'editor', label: editorLabel(editingId, diaries) }
    const originView = (editorOrigin && editorOrigin.view) || 'home'
    // 从首页（日历）进入：首页 › 编辑日记
    if (originView === 'home') return [home, editor]
    // 从日记列表进入：首页 › 日记（或 标签：x）› 编辑日记
    if (originView === 'diary') {
      return [home, { key: 'diary', view: 'diary', label: diaryLabel(diaryFilter) }, editor]
    }
    // 其他页面（标签/设置）进入
    return [home, { key: originView, view: originView, label: VIEW_LABELS[originView] || originView }, editor]
  }

  if (view === 'diary') {
    return [home, { key: 'diary', view: 'diary', label: diaryLabel(diaryFilter) }]
  }
  if (view === 'tags') return [home, { key: 'tags', view: 'tags', label: VIEW_LABELS.tags }]
  if (view === 'settings') return [home, { key: 'settings', view: 'settings', label: VIEW_LABELS.settings }]

  return [home, { key: view, view, label: VIEW_LABELS[view] || view }]
}

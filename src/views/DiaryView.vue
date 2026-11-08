<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, newDiary, editDiary, deleteDiary, computeStats, tagCount, setShowListTags, setDiaryPanelOpen, setDiaryListWidth, openModal, showView, togglePinDiary, duplicateDiary, tagModal, openTagModal, saveDiaryTags } from '../store'
import { tagListWithUntagged, tagsMatchFilter } from '../utils/tags'
import * as dbApi from '../api'
import { fmtDate, fmtCreatedAt } from '../utils/helpers'
import { inDateRange, normalizeRange, presetRange, rangeLabel, shortRangeLabel } from '../utils/dateRange'
import { sortBy, sortDiaries } from '../composables/useSort'
import Icon from '../components/Icon.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import EditorTitleCard from '../components/EditorTitleCard.vue'
import DiaryEditorPanel from '../components/DiaryEditorPanel.vue'

function toggleSort() {
  sortBy.value = sortBy.value === 'time-desc' ? 'time-asc' : 'time-desc'
}

/* ---- search (backend full-text) ---- */
const searchIds = ref(null)
let searchTimer = null

async function performSearch(kw) {
  try {
    const ids = await dbApi.searchDiaries(kw)
    // 关键字在请求期间已变化时丢弃旧结果
    if (state.search.trim() === kw) searchIds.value = new Set(ids)
  } catch (e) {
    console.error('[diary] search failed', e)
  }
}

function scheduleSearch(kw, delay = 250) {
  clearTimeout(searchTimer)
  state.diaryFilter.search = kw
  if (!kw) {
    searchIds.value = null
    return
  }
  searchTimer = setTimeout(() => performSearch(kw), delay)
}

/** 回车立即搜索，不等 250ms 防抖 */
function runSearchNow() {
  scheduleSearch(state.search.trim(), 0)
}

watch(
  () => state.search,
  (v) => {
    scheduleSearch(v.trim())
  }
)

/* ---- tag filter (multi-select) ---- */
// 筛选状态放在 store 里：进编辑器再退回来时不会丢
const filterTags = computed({
  get: () => state.diaryFilter.tags,
  set: (v) => { state.diaryFilter.tags = [...v] },
})
const tagPanelOpen = ref(false)
const tagSearch = ref('')
const draftTags = ref([])
const tagFilterRef = ref(null)

const allTags = computed(() => tagListWithUntagged(state.diaries))

/** 单个标签是否命中：系统「无标签」= 该日记没有任何标签 */
function matchesTag(d, t) {
  return tagsMatchFilter(d.tags, t)
}

const filteredAllTags = computed(() => {
  const kw = tagSearch.value.trim().toLowerCase()
  if (!kw) return allTags.value
  return allTags.value.filter((t) => t.toLowerCase().includes(kw))
})

/* 卡片上的标签点击：直接切换过滤 */
function toggleFilterTag(t) {
  filterTags.value = filterTags.value.includes(t)
    ? filterTags.value.filter((x) => x !== t)
    : [...filterTags.value, t]
}

/* 面板内勾选：只改草稿，点「完成」才生效 */
function toggleDraftTag(t) {
  draftTags.value = draftTags.value.includes(t)
    ? draftTags.value.filter((x) => x !== t)
    : [...draftTags.value, t]
}

function clearDraftTags() {
  draftTags.value = []
}

function toggleTagPanel() {
  if (tagPanelOpen.value) {
    cancelTagPanel()
    return
  }
  draftTags.value = [...filterTags.value]
  tagPanelOpen.value = true
}

/* 完成：应用草稿 */
function closeTagPanel() {
  filterTags.value = [...draftTags.value]
  tagPanelOpen.value = false
}

/* 取消：丢弃草稿 */
function cancelTagPanel() {
  tagPanelOpen.value = false
}

/* ---- date range filter ---- */
const dateFrom = computed({
  get: () => state.diaryFilter.from,
  set: (v) => { state.diaryFilter.from = v || '' },
})
const dateTo = computed({
  get: () => state.diaryFilter.to,
  set: (v) => { state.diaryFilter.to = v || '' },
})
const datePanelOpen = ref(false)
const draftFrom = ref('')
const draftTo = ref('')
const dateFilterRef = ref(null)

const dateActive = computed(() => !!(dateFrom.value || dateTo.value))
const dateButtonText = computed(() =>
  dateActive.value ? shortRangeLabel(dateFrom.value, dateTo.value) : '日期过滤'
)

const datePresets = [
  { key: 'this-month', label: '本月' },
  { key: 'last-month', label: '上月' },
  { key: 'last-30', label: '近 30 天' },
  { key: 'this-year', label: '今年' },
  { key: 'last-year', label: '去年' },
  { key: 'all', label: '全部时间' },
]

function toggleDatePanel() {
  if (datePanelOpen.value) {
    datePanelOpen.value = false
    return
  }
  draftFrom.value = dateFrom.value
  draftTo.value = dateTo.value
  datePanelOpen.value = true
}

function applyDatePreset(key) {
  const r = presetRange(key)
  draftFrom.value = r.from
  draftTo.value = r.to
}

function clearDraftDates() {
  draftFrom.value = ''
  draftTo.value = ''
}

/* 与标签面板一致：改草稿，点「完成」才生效 */
function applyDates() {
  const r = normalizeRange(draftFrom.value, draftTo.value)
  dateFrom.value = r.from
  dateTo.value = r.to
  datePanelOpen.value = false
}

function clearAllFilters() {
  filterTags.value = []
  tagPanelOpen.value = false
  dateFrom.value = ''
  dateTo.value = ''
  datePanelOpen.value = false
  state.diaryFilter.search = ''
  state.search = ''
}

/* ---- right editor panel ---- */
const panelRef = ref(null)
const panelId = ref(null)
const inlineTitleId = ref(null)
const panelOpen = computed({
  get: () => !!state.settings.diaryPanelOpen,
  set: (v) => setDiaryPanelOpen(v),
})

function panelDirty() {
  return !!panelRef.value?.hasUnsavedChanges?.()
}

watch(panelOpen, (open) => {
  if (open && panelId.value == null) panelId.value = list.value[0]?.id ?? null
})

function withPanelGuard(action) {
  if (!panelDirty()) {
    action()
    return
  }
  openModal({
    title: '保存更改？',
    body: '当前日记有未保存的修改，是否保存后继续？',
    confirmText: '保存',
    secondaryText: '不保存',
    onConfirm: async () => {
      const ok = await panelRef.value?.save?.()
      if (ok !== false) action()
    },
    onSecondary: action,
  })
}

function openDiaryInPanel(d) {
  // 面板收起时，点击日记回到全页编辑
  if (!panelOpen.value) {
    editDiary(d.id)
    return
  }
  if (panelId.value === d.id) return
  if (inlineTitleId.value != null && inlineTitleId.value !== d.id) {
    requestCloseInline(() => {
      panelId.value = d.id
      panelOpen.value = true
    })
    return
  }
  withPanelGuard(() => {
    panelId.value = d.id
    inlineTitleId.value = null
    panelOpen.value = true
  })
}

function openInlineTitle(d) {
  if (!panelOpen.value) return
  withPanelGuard(() => {
    panelId.value = d.id
    inlineTitleId.value = d.id
    panelOpen.value = true
  })
}

const cardMenuId = ref(null)

function toggleCardMenu(id) {
  cardMenuId.value = cardMenuId.value === id ? null : id
}

const tagModalTargetId = ref(null)

function openTagEditorFromMenu(d) {
  cardMenuId.value = null
  const run = () => {
    tagModalTargetId.value = d.id
    state.hasTitle = !!(d.title && d.title.trim())
    state.panelTitle = d.title || ''
    state.panelDate = d.date || ''
    state.activeTags = [...(d.tags || [])]
    openTagModal()
  }
  if (panelOpen.value && panelId.value !== d.id) {
    withPanelGuard(run)
    return
  }
  run()
}

watch(
  () => tagModal.open,
  (open, prev) => {
    if (prev && !open && tagModalTargetId.value != null) {
      const id = tagModalTargetId.value
      const tags = [...state.activeTags]
      tagModalTargetId.value = null
      saveDiaryTags(id, tags)
    }
  },
)

function deleteFromMenu(d) {
  cardMenuId.value = null
  deleteDiary(d.id)
}

function duplicateFromMenu(d) {
  cardMenuId.value = null
  duplicateDiary(d.id)
}

function pinFromMenu(d) {
  cardMenuId.value = null
  togglePinDiary(d.id)
}

function inlineTitleDirty() {
  const d = state.diaries.find((x) => x.id === inlineTitleId.value)
  if (!d) return false
  const nextTags = [...state.activeTags].sort().join('\u0000')
  const prevTags = [...(d.tags || [])].sort().join('\u0000')
  return (
    state.panelTitle.trim() !== (d.title || '').trim() ||
    state.panelDate !== d.date ||
    nextTags !== prevTags
  )
}

function closeInlineTitle(restore = false) {
  if (restore) {
    const d = state.diaries.find((x) => x.id === inlineTitleId.value)
    if (d) {
      state.panelTitle = d.title || ''
      state.panelDate = d.date || ''
      state.activeTags = [...(d.tags || [])]
    }
  }
  inlineTitleId.value = null
}

function requestCloseInline(action = () => {}) {
  if (inlineTitleId.value == null) {
    action()
    return
  }
  if (!inlineTitleDirty()) {
    closeInlineTitle()
    action()
    return
  }
  openModal({
    title: '保存更改？',
    body: '标题、日期或标签有未保存的修改，是否保存后继续？',
    confirmText: '保存',
    secondaryText: '不保存',
    onConfirm: async () => {
      const ok = await panelRef.value?.save?.()
      if (ok !== false) {
        closeInlineTitle()
        action()
      }
    },
    onSecondary: () => {
      closeInlineTitle(true)
      action()
    },
  })
}

watch(panelId, (id) => {
  if (inlineTitleId.value != null && inlineTitleId.value !== id) inlineTitleId.value = null
})
watch(panelOpen, (open) => {
  if (!open) inlineTitleId.value = null
})

function closeDiaryPanel() {
  withPanelGuard(() => {
    panelOpen.value = false
  })
}

function onMouseBack() {
  if (panelOpen.value) {
    closeDiaryPanel()
    return
  }
  showView('home')
}

function toggleDiaryPanel() {
  if (panelOpen.value) {
    closeDiaryPanel()
    return
  }
  // 展开时若还没选中，自动打开列表第一篇，避免“点了没反应”
  if (panelId.value == null) panelId.value = list.value[0]?.id ?? null
  panelOpen.value = true
}

function openFullPageFromPanel() {
  const id = panelId.value
  if (id == null) return
  withPanelGuard(() => {
    panelOpen.value = false
    editDiary(id)
  })
}

async function savePanel() {
  await panelRef.value?.save?.()
}

const listWidth = ref(Math.min(70, Math.max(25, Number(state.settings.diaryListWidth) || 50)))
const lineX = ref(0)
const splitActive = ref(false)
const splitHover = ref(false)
let layoutResizeObserver = null

function updateLineX() {
  const el = document.querySelector('.diary-splitter')
  if (!el) return
  const rect = el.getBoundingClientRect()
  lineX.value = Math.round(rect.left + rect.width / 2)
}

watch([panelOpen, listWidth], () => nextTick(updateLineX))

function startSplitDrag(event) {
  event.preventDefault()
  splitActive.value = true
  const layout = event.currentTarget?.parentElement
  if (!layout) return
  const total = layout.getBoundingClientRect().width
  if (!total) return
  const startX = event.clientX
  const startWidth = listWidth.value
  let last = startWidth

  const onMove = (ev) => {
    const percent = startWidth + ((ev.clientX - startX) / total) * 100
    last = Math.round(Math.min(70, Math.max(25, percent)))
    listWidth.value = last
    nextTick(updateLineX)
  }
  const onUp = () => {
    splitActive.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    setDiaryListWidth(last)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function onDocClick(e) {
  if (tagPanelOpen.value && tagFilterRef.value && !tagFilterRef.value.contains(e.target)) {
    cancelTagPanel()
  }
  if (datePanelOpen.value && dateFilterRef.value && !dateFilterRef.value.contains(e.target)) {
    datePanelOpen.value = false
  }
  if (cardMenuId.value != null && e.target instanceof Element && !e.target.closest('.entry-card-menu')) {
    cardMenuId.value = null
  }
  if (inlineTitleId.value != null && e.target instanceof Element) {
    const outside =
      !e.target.closest('.editor-card-title') &&
      !e.target.closest('.meta-tags') &&
      !e.target.closest('.entry-card') &&
      !e.target.closest('.content-top') &&
      !e.target.closest('.diary-panel') &&
      !e.target.closest('.modal-overlay') &&
      !e.target.closest('.modal') &&
      !e.target.closest('.emoji-picker')
    if (outside) requestCloseInline()
  }
}

/* 只按日期过滤后的集合：标签篇数统计以它为分母，保证数字自洽 */
const dateFiltered = computed(() => {
  if (!dateActive.value) return state.diaries
  return state.diaries.filter((d) => inDateRange(d.date, dateFrom.value, dateTo.value))
})

const list = computed(() => {
  let l = sortDiaries(dateFiltered.value)
  if (filterTags.value.length) {
    l = l.filter((d) => filterTags.value.some((t) => matchesTag(d, t)))
  }
  if (searchIds.value) {
    l = l.filter((d) => searchIds.value.has(d.id))
  }
  const pinned = state.settings.pinnedDiaryIds || []
  if (pinned.length) {
    l = [...l].sort((a, b) => {
      const pa = pinned.includes(a.id) ? 1 : 0
      const pb = pinned.includes(b.id) ? 1 : 0
      return pb - pa
    })
  }
  return l
})

/* ---- filtered summary ---- */
const searchActive = computed(() => !!state.search.trim())
const filterActive = computed(
  () => dateActive.value || filterTags.value.length > 0 || searchActive.value,
)
const filteredWords = computed(() => list.value.reduce((s, d) => s + (d.wordCount || 0), 0))
const tagCountsInRange = computed(() => {
  const out = {}
  for (const t of filterTags.value) {
    out[t] = dateFiltered.value.filter((d) => matchesTag(d, t)).length
  }
  return out
})

/* ---- lazy loading ---- */
const pageSize = 20
// 恢复上次加载的条数，否则回到列表时深层滚动位置没有内容可显示
const visibleCount = ref(Math.max(pageSize, Number(state.diaryVisible) || pageSize))
const pagedList = computed(() => list.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < list.value.length)
const sentinelRef = ref(null)
let observer = null

watch(list, () => {
  visibleCount.value = pageSize
  state.diaryVisible = pageSize
})

watch(sentinelRef, (el) => {
  if (observer) { observer.disconnect(); observer = null }
  if (!el) return
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore.value) {
      visibleCount.value += pageSize
    }
  })
  observer.observe(el)
})

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('resize', updateLineX)
  window.addEventListener('kiko:back', onMouseBack)
  // 回到列表时恢复搜索：输入框保留关键字，结果也必须一起恢复
  if (state.search.trim()) runSearchNow()
  nextTick(() => {
    updateLineX()
    const layout = document.querySelector('.diary-layout')
    if (layout && typeof ResizeObserver !== 'undefined') {
      layoutResizeObserver = new ResizeObserver(() => updateLineX())
      layoutResizeObserver.observe(layout)
    }
  })
  // 回到列表时回到离开时的位置（进入编辑页/切换页面都会记住）
  const savedY = Number(state.diaryScroll) || 0
  if (savedY > 0) {
    requestAnimationFrame(() => window.scrollTo({ top: savedY, behavior: 'auto' }))
  }
})
onBeforeUnmount(() => {
  state.diaryScroll = window.scrollY
  state.diaryVisible = visibleCount.value
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('resize', updateLineX)
  window.removeEventListener('kiko:back', onMouseBack)
  layoutResizeObserver?.disconnect()
  layoutResizeObserver = null
  if (observer) observer.disconnect()
})

const stats = computed(() => computeStats())
</script>

<template>
  <section class="view">
    <div class="content-top">
      <Breadcrumb />
      <div class="content-top-actions">
        <template v-if="panelOpen && panelId != null">
          <button type="button" class="diary-panel-toggle" title="全页编辑" @click="openFullPageFromPanel">
            <Icon name="pen" />
          </button>
          <button type="button" class="btn btn-primary panel-save-btn" @click="savePanel">保存</button>
        </template>
        <button
          type="button"
          class="diary-panel-toggle"
          :class="{ active: panelOpen }"
          :aria-pressed="panelOpen"
          :title="panelOpen ? '收起编辑面板' : '展开编辑面板'"
          @click="toggleDiaryPanel"
        >
          <Icon name="panelRight" />
        </button>
      </div>
    </div>

    <div v-if="panelOpen" class="diary-vline" :class="{ hot: splitHover || splitActive }" :style="{ left: `${lineX}px` }" />

    <div class="diary-layout" :class="{ 'diary-layout--panel': panelOpen }" :style="panelOpen ? { '--list-width': `${listWidth}%` } : undefined">
            <div class="diary-main-col">
    <div class="toolbar">
      <div class="search">
        <Icon name="search" />
        <input
          v-model="state.search"
          type="text"
          placeholder="搜索标题或内容…"
          @keydown.enter.prevent="runSearchNow"
        >
      </div>

      <div class="tag-filter" ref="tagFilterRef">
        <button
          type="button"
          class="tag-filter-btn icon-only"
          :class="{ active: filterTags.length > 0 }"
          :aria-expanded="tagPanelOpen"
          title="标签过滤"
          @click="toggleTagPanel"
        >
          <Icon name="tag" />
          <span v-if="filterTags.length" class="tag-filter-count">{{ filterTags.length }}</span>
        </button>

        <div v-if="tagPanelOpen" class="tag-filter-popover" @click.stop>
          <div class="tag-modal-search">
            <Icon name="search" />
            <input v-model="tagSearch" type="text" placeholder="搜索标签…">
          </div>
          <div class="tag-filter-scroll">
            <div v-if="!filteredAllTags.length" class="tag-modal-empty">
              <p>没有匹配的标签</p>
            </div>
            <div v-else class="tag-modal-grid">
              <button
                v-for="t in filteredAllTags"
                :key="t"
                type="button"
                class="tag-modal-option"
                :class="{ on: draftTags.includes(t) }"
                @click="toggleDraftTag(t)"
              >
                <span class="mark"><Icon v-if="draftTags.includes(t)" name="check" /></span>
                <span class="n">{{ t }}</span>
                <span class="cnt">{{ tagCount(t) }} 篇</span>
              </button>
            </div>
          </div>
          <div class="tag-filter-foot">
            <button type="button" class="btn btn-ghost btn-sm" @click="clearDraftTags">清除</button>
            <button type="button" class="btn btn-primary btn-sm" @click="closeTagPanel">完成</button>
          </div>
        </div>
      </div>

      <div class="tag-filter" ref="dateFilterRef">
        <button
          type="button"
          class="tag-filter-btn icon-only"
          :class="{ active: dateActive }"
          :aria-expanded="datePanelOpen"
          :title="dateButtonText"
          @click="toggleDatePanel"
        >
          <Icon name="calendar" />
          <span v-if="dateActive" class="icon-dot" />
        </button>

        <div v-if="datePanelOpen" class="tag-filter-popover date-filter-popover" @click.stop>
          <div class="date-filter-row">
            <label>
              <span>开始日期</span>
              <input v-model="draftFrom" type="date" :max="draftTo || undefined">
            </label>
            <label>
              <span>结束日期</span>
              <input v-model="draftTo" type="date" :min="draftFrom || undefined">
            </label>
          </div>
          <div class="date-filter-presets">
            <button
              v-for="p in datePresets"
              :key="p.key"
              type="button"
              @click="applyDatePreset(p.key)"
            >{{ p.label }}</button>
          </div>
          <p class="date-filter-hint">只填一端表示「该日期之后 / 之前」，两端都空表示不限。</p>
          <div class="tag-filter-foot">
            <button type="button" class="btn btn-ghost btn-sm" @click="clearDraftDates">清除</button>
            <button type="button" class="btn btn-primary btn-sm" @click="applyDates">完成</button>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="tag-filter-btn icon-only"
        :title="`排序：${sortBy === 'time-desc' ? '最新优先' : '最早优先'}（点击切换）`"
        @click="toggleSort"
      >
        <Icon name="sort" />
      </button>

      <button
        type="button"
        class="tag-visibility-btn"
        :class="{ active: state.settings.showListTags }"
        :aria-pressed="state.settings.showListTags"
        :title="state.settings.showListTags ? '隐藏日记卡片标签' : '显示日记卡片标签'"
        @click="setShowListTags(!state.settings.showListTags)"
      >
        <Icon :name="state.settings.showListTags ? 'eye' : 'eyeOff'" />
      </button>
    </div>

    <div class="diary-list-scroll">
    <div v-if="filterActive" class="filter-summary">
      <span v-if="searchActive" class="filter-summary-item">
        <Icon name="search" />
        搜索：{{ state.search.trim() }}
      </span>
      <span v-if="dateActive" class="filter-summary-item">
        <Icon name="calendar" />
        {{ rangeLabel(dateFrom, dateTo) }}
      </span>
      <span v-for="t in filterTags" :key="t" class="filter-summary-chip">
        {{ t }} · {{ tagCountsInRange[t] }} 篇
      </span>
      <span class="filter-summary-total">
        合计 <strong>{{ list.length }}</strong> 篇 · {{ filteredWords }} 字
      </span>
      <button type="button" class="filter-summary-clear" @click="clearAllFilters">清除 ×</button>
    </div>

        <div v-if="list.length" class="entry-list">
          <template v-for="d in pagedList" :key="d.id">
            <EditorTitleCard
              v-if="inlineTitleId === d.id"
              v-model:title="state.panelTitle"
              v-model:date="state.panelDate"
            />
            <div v-else class="card entry-card" :class="{ 'entry-card--active': panelOpen && panelId === d.id, 'entry-card--menu': cardMenuId === d.id, 'entry-card--pinned': (state.settings.pinnedDiaryIds || []).includes(d.id) }" @click="openDiaryInPanel(d)" @dblclick.stop="openInlineTitle(d)">
              <div class="entry-top" :class="{ 'entry-top--untitled': !(d.title && d.title.trim()) }">
                <h3 v-if="d.title && d.title.trim()" class="entry-title">{{ d.title }}</h3>
                <div v-else-if="state.settings.showListTags" class="entry-tags entry-tags-inline">
                  <span v-for="t in (d.tags || [])" :key="t" class="tag-pill" :class="{ on: filterTags.includes(t) }" @click.stop="toggleFilterTag(t)">{{ t }}</span>
                </div>
              </div>
              <div v-if="state.settings.showListExcerpt && d.excerpt" class="entry-excerpt">{{ d.excerpt }}</div>
              <div v-if="state.settings.showListTags && d.title && d.title.trim()" class="entry-tags">
                <span v-for="t in (d.tags || [])" :key="t" class="tag-pill" :class="{ on: filterTags.includes(t) }" @click.stop="toggleFilterTag(t)">{{ t }}</span>
              </div>
              <div class="entry-date-row">
                <span class="entry-date">{{ fmtCreatedAt(d.dirName) || fmtDate(d.date) }}</span>
              </div>
              <span v-if="(state.settings.pinnedDiaryIds || []).includes(d.id)" class="entry-pin" title="已置顶">
                <Icon name="pin" />
              </span>
              <div class="entry-card-menu" @click.stop>
                <button type="button" class="entry-menu-btn" title="更多操作" @click.stop="toggleCardMenu(d.id)">
                  <Icon name="chevDown" />
                </button>
                <div v-if="cardMenuId === d.id" class="entry-menu-dropdown" @click.stop>
                  <button type="button" @click="openTagEditorFromMenu(d)">标签</button>
                  <button type="button" @click="duplicateFromMenu(d)">复制</button>
                  <button type="button" @click="deleteFromMenu(d)">删除</button>
                  <button type="button" @click="pinFromMenu(d)">
                    {{ (state.settings.pinnedDiaryIds || []).includes(d.id) ? '取消置顶' : '置顶' }}
                  </button>
                </div>
              </div>
            </div>
          </template>
          <div v-if="hasMore" ref="sentinelRef" class="load-more-sentinel">加载中…</div>
          <div v-else class="load-more-end">已经到底了</div>
        </div>
        <div v-else class="empty">
          <Icon name="search" />
          <p>没有找到匹配的日记</p>
          <button class="btn btn-ghost" @click="clearAllFilters">清除筛选</button>
        </div>
      </div>
    </div>

      <div
        v-if="panelOpen"
        class="diary-splitter"
        :class="{ active: splitActive }"
        @pointerdown="startSplitDrag"
        @mouseenter="splitHover = true"
        @mouseleave="splitHover = false"
      />

      <DiaryEditorPanel
        v-if="panelOpen && panelId != null"
        ref="panelRef"
        :diary-id="panelId"
        @close="closeDiaryPanel"
        @full-edit="openFullPageFromPanel"
      />

      <div v-else-if="panelOpen" class="diary-panel-empty">
        <Icon name="panelRight" />
        <p>从左侧选择一篇日记开始编辑</p>
      </div>

      <div v-else class="card stats">
        <div class="stats-head">
          <h3>统计</h3>
          <button class="btn btn-primary stats-new-btn" @click="newDiary()"><Icon name="plus" /> 新建日记</button>
        </div>
        <div class="stat-row"><span class="k">日记数</span><span class="v">{{ stats.total }}</span></div>
        <div class="stat-row"><span class="k">总字数</span><span class="v">{{ stats.words }}</span></div>
        <div class="stat-row"><span class="k">活跃天数</span><span class="v">{{ stats.activeDays }}</span></div>
        <div class="stat-row"><span class="k">最早日期</span><span class="v" style="font-size:13px">{{ stats.earliest }}</span></div>
        <div class="stat-row"><span class="k">最后日期</span><span class="v" style="font-size:13px">{{ stats.latest }}</span></div>
      </div>
    </div>
  </section>
</template>

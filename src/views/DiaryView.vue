<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, newDiary, editDiary, computeStats, tagCount } from '../store'
import { tagListWithUntagged, tagsMatchFilter } from '../utils/tags'
import * as dbApi from '../api'
import { fmtDate } from '../utils/helpers'
import { inDateRange, normalizeRange, presetRange, rangeLabel, shortRangeLabel } from '../utils/dateRange'
import { sortBy, sortDiaries } from '../composables/useSort'
import Icon from '../components/Icon.vue'

/* ---- search (backend full-text) ---- */
const searchIds = ref(null)
let searchTimer = null
watch(
  () => state.search,
  (v) => {
    clearTimeout(searchTimer)
    const kw = v.trim()
    if (!kw) {
      searchIds.value = null
      return
    }
    searchTimer = setTimeout(async () => {
      try {
        const ids = await dbApi.searchDiaries(kw)
        searchIds.value = new Set(ids)
      } catch (e) {
        console.error('[diary] search failed', e)
      }
    }, 250)
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
  state.search = ''
}

function onDocClick(e) {
  if (tagPanelOpen.value && tagFilterRef.value && !tagFilterRef.value.contains(e.target)) {
    cancelTagPanel()
  }
  if (datePanelOpen.value && dateFilterRef.value && !dateFilterRef.value.contains(e.target)) {
    datePanelOpen.value = false
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
  return l
})

/* ---- filtered summary ---- */
const filterActive = computed(() => dateActive.value || filterTags.value.length > 0)
const filteredWords = computed(() => list.value.reduce((s, d) => s + (d.wordCount || 0), 0))
const tagCountsInRange = computed(() => {
  const out = {}
  for (const t of filterTags.value) {
    out[t] = dateFiltered.value.filter((d) => matchesTag(d, t)).length
  }
  return out
})

const subline = computed(() => {
  // 日期/标签筛选的结果数字放在汇总条里，这里只报全量，避免重复
  if (filterActive.value) return `共 ${state.diaries.length} 篇记录`
  if (searchIds.value) return `搜索命中 ${list.value.length} 篇`
  return `共 ${state.diaries.length} 篇记录`
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
  if (observer) observer.disconnect()
})

const stats = computed(() => computeStats())
</script>

<template>
  <section class="view">
    <div class="page-head">
      <div>
        <h1 class="page-title">日记</h1>
        <p class="page-sub">{{ subline }}</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="search">
        <Icon name="search" />
        <input v-model="state.search" type="text" placeholder="搜索标题或内容…">
      </div>

      <div class="tag-filter" ref="tagFilterRef">
        <button
          type="button"
          class="tag-filter-btn"
          :class="{ active: filterTags.length > 0 }"
          :aria-expanded="tagPanelOpen"
          @click="toggleTagPanel"
        >
          <Icon name="tag" />
          标签过滤
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
          class="tag-filter-btn"
          :class="{ active: dateActive }"
          :aria-expanded="datePanelOpen"
          title="按日期区间筛选（可与标签组合）"
          @click="toggleDatePanel"
        >
          <Icon name="calendar" />
          {{ dateButtonText }}
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

      <label class="sort-select" title="排序方式">
        <Icon name="sort" />
        <select v-model="sortBy">
          <option value="time-desc">最新优先</option>
          <option value="time-asc">最早优先</option>
        </select>
      </label>
    </div>

    <div v-if="filterActive" class="filter-summary">
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

    <div class="diary-layout">
      <div>
        <div v-if="list.length" class="entry-list">
          <div v-for="d in pagedList" :key="d.id" class="card entry-card" @click="editDiary(d.id)">
            <div class="entry-top" :class="{ 'entry-top--untitled': !(d.title && d.title.trim()) }">
              <h3 v-if="d.title && d.title.trim()" class="entry-title">{{ d.title }}</h3>
              <div v-else class="entry-tags entry-tags-inline">
                <span v-for="t in (d.tags || [])" :key="t" class="tag-pill" :class="{ on: filterTags.includes(t) }" @click.stop="toggleFilterTag(t)">{{ t }}</span>
              </div>
              <span class="entry-date">{{ fmtDate(d.date) }}</span>
            </div>
            <div v-if="state.settings.showListExcerpt && d.excerpt" class="entry-excerpt">{{ d.excerpt }}</div>
            <div v-if="d.title && d.title.trim()" class="entry-tags">
              <span v-for="t in (d.tags || [])" :key="t" class="tag-pill" :class="{ on: filterTags.includes(t) }" @click.stop="toggleFilterTag(t)">{{ t }}</span>
            </div>
          </div>
          <div v-if="hasMore" ref="sentinelRef" class="load-more-sentinel">加载中…</div>
          <div v-else class="load-more-end">已经到底了</div>
        </div>
        <div v-else class="empty">
          <Icon name="search" />
          <p>没有找到匹配的日记</p>
          <button class="btn btn-ghost" @click="clearAllFilters">清除筛选</button>
        </div>
      </div>

      <div class="card stats">
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

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, newDiary, editDiary, computeStats, tagCount } from '../store'
import * as dbApi from '../api'
import { fmtDate } from '../utils/helpers'
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
const filterTags = ref(state.tagFilter ? [state.tagFilter] : [])
const tagPanelOpen = ref(false)
const tagSearch = ref('')
const draftTags = ref([])
const tagFilterRef = ref(null)

const allTags = computed(() => {
  const set = new Set()
  state.diaries.forEach((d) => (d.tags || []).forEach((t) => set.add(t)))
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

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

function clearAllFilters() {
  filterTags.value = []
  tagPanelOpen.value = false
  state.search = ''
  state.tagFilter = null
}

function onDocClick(e) {
  if (tagPanelOpen.value && tagFilterRef.value && !tagFilterRef.value.contains(e.target)) {
    cancelTagPanel()
  }
}

const sortBy = ref('time-desc')

function sortDiaries(arr) {
  const a = [...arr]
  const asc = sortBy.value === 'time-asc'
  return a.sort((x, y) => {
    // 先按日期（date）字典序排序
    if (x.date !== y.date) {
      const d = x.date < y.date ? -1 : 1
      return asc ? d : -d
    }
    // 同一天再按创建时间戳（dirName）排序
    const t = (Number(x.dirName) || 0) - (Number(y.dirName) || 0)
    return asc ? t : -t
  })
}

const list = computed(() => {
  let l = sortDiaries(state.diaries)
  if (filterTags.value.length) {
    l = l.filter((d) => filterTags.value.some((t) => (d.tags || []).includes(t)))
  }
  if (searchIds.value) {
    l = l.filter((d) => searchIds.value.has(d.id))
  }
  return l
})

/* ---- lazy loading ---- */
const pageSize = 20
const visibleCount = ref(pageSize)
const pagedList = computed(() => list.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < list.value.length)
const sentinelRef = ref(null)
let observer = null

watch(list, () => { visibleCount.value = pageSize })

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

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => {
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
        <p class="page-sub">{{ filterTags.length ? `已筛选 ${filterTags.length} 个标签 · ${list.length} 篇` : `共 ${state.diaries.length} 篇记录` }}</p>
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

      <label class="sort-select" title="排序方式">
        <Icon name="sort" />
        <select v-model="sortBy">
          <option value="time-desc">最新优先</option>
          <option value="time-asc">最早优先</option>
        </select>
      </label>

      <button v-if="filterTags.length" class="btn btn-ghost btn-sm" @click="clearAllFilters">清除筛选 ×</button>
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

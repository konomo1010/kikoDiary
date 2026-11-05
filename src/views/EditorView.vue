<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { state, saveDiary, deleteDiary, backFromEditor, toggleTag, openTagModal, openModal, editorDark, modal, tagModal, navigateTo } from '../store'
import * as dbApi from '../api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { todayStr, fmtDate, countWords, normalizeContent, toDateStr } from '../utils/helpers'
import Icon from '../components/Icon.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import NotionLikeEditor from '../components/NotionLikeEditor.vue'

const isNew = computed(() => state.editingId == null)
const currentDiary = computed(() => isNew.value ? null : state.diaries.find((x) => x.id === state.editingId))

const title = ref('')
const content = ref(null)
const titleInputEl = ref(null)
const initialSnapshot = ref(null)

function resolveImageSrc(doc) {
  const walk = (node) => {
    if (node && node.type === 'image' && node.attrs && node.attrs.src) {
      const src = node.attrs.src
      if (typeof src === 'string' && !src.startsWith('blob:') && !src.startsWith('http') && !src.startsWith('asset:') && !src.startsWith('data:')) {
        node.attrs.src = convertFileSrc(src)
      }
    }
    if (node && Array.isArray(node.content)) node.content.forEach(walk)
  }
  if (doc) walk(doc)
  return doc
}

async function initEditor() {
  if (state.hasTitle) {
    title.value = isNew.value
      ? ''
      : (currentDiary.value ? (currentDiary.value.title || '') : '')
  } else {
    title.value = ''
  }
  if (isNew.value) {
    content.value = null
  } else {
    const id = currentDiary.value ? currentDiary.value.id : null
    const body = id != null ? await dbApi.getBody(id) : null
    content.value = normalizeContent(resolveImageSrc(body))
  }
}

const wordCount = computed(() => countWords(content.value))

/* ---- date picker ---- */
const initialDate = isNew.value
  ? (state.newDiaryDate || todayStr())
  : (currentDiary.value ? currentDiary.value.date : todayStr())
const dateValue = ref(initialDate)

function diarySnapshot() {
  return JSON.stringify({
    title: state.hasTitle ? title.value.trim() : '',
    content: content.value,
    date: dateValue.value,
    tags: [...state.activeTags].sort(),
    hasTitle: state.hasTitle
  })
}

function hasUnsavedChanges() {
  return initialSnapshot.value !== null && diarySnapshot() !== initialSnapshot.value
}

const pickerOpen = ref(false)
const pickerAnchor = ref(new Date(initialDate + 'T00:00:00'))
const datePickerRef = ref(null)

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const pickerY = computed(() => pickerAnchor.value.getFullYear())
const pickerM = computed(() => pickerAnchor.value.getMonth())

const pickerCells = computed(() => {
  const year = pickerY.value
  const month = pickerM.value
  const today = todayStr()
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7
  const list = []
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, i - startOffset + 1)
    const dateStr = toDateStr(date)
    list.push({
      dateStr,
      day: date.getDate(),
      other: date.getMonth() !== month,
      today: dateStr === today,
      selected: dateStr === dateValue.value
    })
  }
  return list
})

const pickerView = ref('day')
const pickerYear = ref(pickerAnchor.value.getFullYear())
const pickerDecade = ref(Math.floor(pickerYear.value / 12) * 12)
const months = Array.from({ length: 12 }, (_, i) => i)
const decadeYears = computed(() => Array.from({ length: 12 }, (_, i) => pickerDecade.value + i))

function toggleDatePicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value) {
    pickerAnchor.value = new Date(dateValue.value + 'T00:00:00')
    pickerView.value = 'day'
  }
}

function shiftMonth(delta) {
  const d = new Date(pickerAnchor.value)
  d.setDate(1)
  d.setMonth(d.getMonth() + delta)
  pickerAnchor.value = d
}

function openMonthPicker() {
  pickerYear.value = pickerY.value
  pickerDecade.value = Math.floor(pickerYear.value / 12) * 12
  pickerView.value = 'month'
}

function pickMonth(mi) {
  const d = new Date(pickerAnchor.value)
  d.setDate(1)
  d.setFullYear(pickerYear.value)
  d.setMonth(mi)
  pickerAnchor.value = d
  pickerView.value = 'day'
}

function openYearPicker() {
  pickerView.value = 'year'
}

function pickYear(yr) {
  pickerYear.value = yr
  pickerView.value = 'month'
}

function pickerYearStep(delta) {
  pickerYear.value += delta
  pickerDecade.value = Math.floor(pickerYear.value / 12) * 12
}

function pickerDecadeStep(delta) {
  pickerDecade.value += delta
}

function onPickDate(dateStr) {
  dateValue.value = dateStr
  pickerOpen.value = false
}

function onDocClick(e) {
  if (pickerOpen.value && datePickerRef.value && !datePickerRef.value.contains(e.target)) {
    pickerOpen.value = false
  }
}

const dateLabel = computed(() => fmtDate(dateValue.value))

function onSave(opts) {
  const result = saveDiary(
    state.hasTitle ? title.value.trim() : '',
    content.value,
    dateValue.value,
    opts
  )
  if (result === 'title' && titleInputEl.value) titleInputEl.value.focus()
  return result
}

/**
 * 面包屑跳转：先处理未保存更改，确认后再离开。
 * 走 saveDiary 的 leaveTo，保存完成后直接去面包屑指定的页面。
 */
function goCrumb(crumb) {
  if (!crumb || crumb.view === 'editor') return
  if (!hasUnsavedChanges()) {
    navigateTo(crumb)
    return
  }
  openModal({
    title: '保存更改？',
    body: '这篇日记有未保存的更改，是否保存后再离开？',
    confirmText: '保存并离开',
    secondaryText: '不保存',
    onConfirm: () => onSave({ leaveTo: crumb }),
    onSecondary: () => navigateTo(crumb)
  })
}

/**
 * Ctrl/Cmd+S：保存后留在编辑页，方便继续写。
 * 校验规则与「保存日记」按钮一致（无标题且无标签时会拦下并提示）。
 */
function onQuickSave() {
  const result = saveDiary(
    state.hasTitle ? title.value.trim() : '',
    content.value,
    dateValue.value,
    {
      stay: true,
      onSaved: () => {
        // 刷新「未保存」基线，否则保存后点返回仍会弹保存确认
        initialSnapshot.value = diarySnapshot()
      }
    }
  )
  if (result === 'title' && titleInputEl.value) titleInputEl.value.focus()
  return result
}

function onKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  if (String(e.key || '').toLowerCase() !== 's') return
  // 弹窗、标签选择面板打开时不抢按键
  if (modal.open || tagModal.open) return
  e.preventDefault()
  e.stopPropagation()
  onQuickSave()
}

function onBack() {
  if (!hasUnsavedChanges()) {
    backFromEditor()
    return
  }
  openModal({
    title: '保存更改？',
    body: '这篇日记有未保存的更改，是否保存后再返回？',
    confirmText: '保存',
    secondaryText: '不保存',
    onConfirm: onSave,
    onSecondary: backFromEditor
  })
}

function onToggleTitle() {
  state.hasTitle = !state.hasTitle
  if (!state.hasTitle) title.value = ''
  if (state.hasTitle && titleInputEl.value) titleInputEl.value.focus()
}

onMounted(async () => {
  await initEditor()
  // 等 Tiptap 完成首次内容同步，避免初始化补全被当作未保存修改
  await nextTick()
  initialSnapshot.value = diarySnapshot()
  if (isNew.value && state.hasTitle && titleInputEl.value) titleInputEl.value.focus()
  document.addEventListener('click', onDocClick)
  // 捕获阶段监听，确保先于编辑器/Tiptap 的按键处理，并拦下浏览器默认保存
  window.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <section class="view editor-view">
    <Breadcrumb :resolve-nav="goCrumb" />
    <div class="editor-topbar">
      <button class="btn btn-icon btn-ghost" title="返回" @click="onBack"><Icon name="back" /></button>
      <div class="spacer"></div>
      <button v-if="!isNew" class="btn btn-danger-ghost" @click="deleteDiary(currentDiary.id)"><Icon name="trash" /> 删除</button>
      <button class="btn btn-primary" @click="onSave">保存日记</button>
    </div>

    <div class="card editor-card editor-card-title">
      <input v-if="state.hasTitle" ref="titleInputEl" v-model="title" class="title-input" type="text" placeholder="给今天起个标题…" maxlength="60">

      <div class="editor-meta-row">
        <div class="editor-meta">
          <div class="date-picker" ref="datePickerRef">
            <button type="button" class="date-trigger" title="选择日期" @click="toggleDatePicker">
              <Icon name="calendar" /> {{ dateLabel }}
            </button>
            <div v-if="pickerOpen" class="date-popover" @click.stop>
              <template v-if="pickerView === 'day'">
                <div class="date-popover-head">
                  <button type="button" class="cal-nav-btn" title="上个月" @click="shiftMonth(-1)"><Icon name="chevLeft" /></button>
                  <button type="button" class="date-popover-title" title="选择年月" @click="openMonthPicker">{{ pickerY }} 年 {{ pickerM + 1 }} 月</button>
                  <button type="button" class="cal-nav-btn" title="下个月" @click="shiftMonth(1)"><Icon name="chevRight" /></button>
                </div>
                <div class="cal-weekdays">
                  <span v-for="w in WEEKDAY_LABELS" :key="w">{{ w }}</span>
                </div>
                <div class="cal-days">
                  <button
                    v-for="c in pickerCells"
                    :key="c.dateStr"
                    type="button"
                    class="cal-day"
                    :class="{ other: c.other, today: c.today, selected: c.selected }"
                    @click="onPickDate(c.dateStr)"
                  >{{ c.day }}</button>
                </div>
                <div class="date-popover-foot">
                  <button type="button" class="cal-today-btn" @click="onPickDate(todayStr())">回到今天</button>
                </div>
              </template>

              <template v-else-if="pickerView === 'month'">
                <div class="date-popover-head">
                  <button type="button" class="cal-nav-btn" title="上一年" @click="pickerYearStep(-1)"><Icon name="chevLeft" /></button>
                  <button type="button" class="date-popover-title" title="选择年份" @click="openYearPicker">{{ pickerYear }} 年</button>
                  <button type="button" class="cal-nav-btn" title="下一年" @click="pickerYearStep(1)"><Icon name="chevRight" /></button>
                </div>
                <div class="cal-picker-grid">
                  <button
                    v-for="mi in months"
                    :key="mi"
                    type="button"
                    class="cal-picker-cell"
                    :class="{ selected: pickerYear === pickerY && mi === pickerM }"
                    @click="pickMonth(mi)"
                  >{{ mi + 1 }} 月</button>
                </div>
              </template>

              <template v-else>
                <div class="date-popover-head">
                  <button type="button" class="cal-nav-btn" title="上一个年代" @click="pickerDecadeStep(-12)"><Icon name="chevLeft" /></button>
                  <span class="date-popover-title static">{{ pickerDecade }} – {{ pickerDecade + 11 }}</span>
                  <button type="button" class="cal-nav-btn" title="下一个年代" @click="pickerDecadeStep(12)"><Icon name="chevRight" /></button>
                </div>
                <div class="cal-picker-grid">
                  <button
                    v-for="yr in decadeYears"
                    :key="yr"
                    type="button"
                    class="cal-picker-cell"
                    :class="{ selected: yr === pickerY }"
                    @click="pickYear(yr)"
                  >{{ yr }}</button>
                </div>
              </template>
            </div>
          </div>
          <button type="button" class="title-toggle" :class="{ on: state.hasTitle }" role="switch" :aria-checked="state.hasTitle" @click="onToggleTitle">
            <span class="tt-track"><span class="tt-thumb"></span></span>
            <span class="tt-label">标题</span>
          </button>
          <button type="button" class="tag-add-btn" @click="openTagModal"><Icon name="plus" /> 添加标签</button>
          <span v-if="!state.hasTitle && !state.activeTags.length" class="tag-req">必选</span>
        </div>
      </div>

      <div v-if="state.activeTags.length" class="meta-tags">
        <span v-for="t in state.activeTags" :key="t" class="tag-sel-chip">{{ t }}
          <button type="button" class="x" title="移除" :aria-label="`移除 ${t}`" @click="toggleTag(t)"><Icon name="x" /></button>
        </span>
      </div>
    </div>

    <div class="card editor-card editor-card-body" :class="{ 'editor-card-body--dark': editorDark }">
      <NotionLikeEditor v-model="content" :autofocus="isNew && !state.hasTitle" />

      <div
        class="editor-foot"
        :class="{ 'editor-foot--dark': editorDark }"
        :style="editorDark ? { background: '#0e0e11', color: 'rgba(245,245,245,0.65)' } : {}"
      >
        <span class="word-count">{{ wordCount }} 字</span>
        <span class="word-count">{{ isNew ? '新建日记' : '编辑日记' }}</span>
      </div>
    </div>
  </section>
</template>
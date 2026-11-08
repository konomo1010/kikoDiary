<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, toggleTag, openTagModal } from '../store'
import { fmtDate, todayStr, toDateStr } from '../utils/helpers'
import Icon from './Icon.vue'

const props = defineProps({
  autofocus: { type: Boolean, default: false },
})
const title = defineModel('title', { type: String, default: '' })
const date = defineModel('date', { type: String, default: '' })

const titleInputEl = ref(null)
const pickerOpen = ref(false)
const pickerAnchor = ref(new Date((date.value || todayStr()) + 'T00:00:00'))
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
    const d = new Date(year, month, i - startOffset + 1)
    const dateStr = toDateStr(d)
    list.push({
      dateStr,
      day: d.getDate(),
      other: d.getMonth() !== month,
      today: dateStr === today,
      selected: dateStr === date.value,
    })
  }
  return list
})

const pickerView = ref('day')
const pickerYear = ref(pickerAnchor.value.getFullYear())
const pickerDecade = ref(Math.floor(pickerYear.value / 12) * 12)
const months = Array.from({ length: 12 }, (_, i) => i)
const decadeYears = computed(() => Array.from({ length: 12 }, (_, i) => pickerDecade.value + i))

const dateLabel = computed(() => fmtDate(date.value))

function toggleDatePicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value) {
    pickerAnchor.value = new Date(date.value + 'T00:00:00')
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
  date.value = dateStr
  pickerOpen.value = false
}

function onDocClick(e) {
  if (pickerOpen.value && datePickerRef.value && !datePickerRef.value.contains(e.target)) {
    pickerOpen.value = false
  }
}

function onToggleTitle() {
  state.hasTitle = !state.hasTitle
  // 不在这里清空 title：未保存状态下关闭再开启应保留原标题/修改后的标题
  if (state.hasTitle) nextTick(() => titleInputEl.value?.focus())
}

function focusTitle() {
  titleInputEl.value?.focus()
}

watch(
  () => props.autofocus,
  (value) => {
    if (value) nextTick(() => titleInputEl.value?.focus())
  },
)

onMounted(() => {
  document.addEventListener('click', onDocClick)
  if (props.autofocus && state.hasTitle) nextTick(() => titleInputEl.value?.focus())
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

defineExpose({ focusTitle })
</script>

<template>
  <div class="card editor-card editor-card-title">
    <input v-if="state.hasTitle" ref="titleInputEl" v-model="title" class="title-input" type="text" placeholder="给今天起个标题…">

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
        <button type="button" class="x" title="移除" :aria-label="`移除 ${t}`" @click.stop="toggleTag(t)"><Icon name="x" /></button>
      </span>
    </div>
  </div>
</template>

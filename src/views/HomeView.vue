<script setup>
import { computed } from 'vue'
import {
  state, calAnchor, calShift, calGotoToday, calTogglePicker, calPickerToggleView,
  calPickerDecade, calPickerSelectYear, calPickerYearStep, calPickerSelectMonth,
  calSelect, newDiary, editDiary
} from '../store'
import { greeting, fmtDate, todayStr, toDateStr } from '../utils/helpers'
import Icon from '../components/Icon.vue'

if (!state.calSelected) state.calSelected = todayStr()

const y = computed(() => calAnchor.value.getFullYear())
const m = computed(() => calAnchor.value.getMonth())

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const months = Array.from({ length: 12 }, (_, i) => i)

const cells = computed(() => {
  const year = y.value
  const month = m.value
  const today = todayStr()
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7
  const byDate = {}
  state.diaries.forEach((d) => { (byDate[d.date] = byDate[d.date] || []).push(d) })
  const list = []
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, i - startOffset + 1)
    const dateStr = toDateStr(date)
    list.push({
      dateStr,
      day: date.getDate(),
      other: date.getMonth() !== month,
      today: dateStr === today,
      selected: dateStr === state.calSelected,
      count: (byDate[dateStr] || []).length
    })
  }
  return list
})

const selectedEntries = computed(() => {
  const byDate = {}
  state.diaries.forEach((d) => { (byDate[d.date] = byDate[d.date] || []).push(d) })
  return (byDate[state.calSelected] || []).slice().sort((a, b) => b.date.localeCompare(a.date))
})

const decadeYears = computed(() => Array.from({ length: 12 }, (_, i) => state.calPickerDecade + i))
</script>

<template>
  <section class="view">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ greeting() }}，{{ state.user.name }}</h1>
        <p class="page-sub">今天是 {{ fmtDate(todayStr()) }}，写点什么留下来吧。</p>
      </div>
    </div>

    <div class="hero-calendar">
      <div class="cal-main">
        <div class="cal-head">
          <button
            class="cal-month-toggle"
            :class="{ open: state.calPickerOpen }"
            :aria-expanded="state.calPickerOpen"
            aria-label="选择年份和月份"
            @click="calTogglePicker"
          >
            {{ y }} 年 {{ m + 1 }} 月
            <Icon name="chevDown" />
          </button>
          <div class="cal-nav">
            <button class="cal-nav-btn" title="上一个月" @click="calShift(-1)"><Icon name="chevLeft" /></button>
            <button class="cal-today-btn" @click="calGotoToday">回到今天</button>
            <button class="cal-nav-btn" title="下一个月" @click="calShift(1)"><Icon name="chevRight" /></button>
          </div>
        </div>

        <div v-if="state.calPickerOpen && state.calPickerView === 'month'" class="cal-picker">
          <div class="cal-picker-head">
            <button class="cal-picker-nav" title="上一年" @click="calPickerYearStep(-1)"><Icon name="chevLeft" /></button>
            <button class="cal-picker-title" title="选择年份" @click="calPickerToggleView">{{ state.calPickerYear }} 年 <Icon name="chevDown" /></button>
            <button class="cal-picker-nav" title="下一年" @click="calPickerYearStep(1)"><Icon name="chevRight" /></button>
          </div>
          <div class="cal-picker-grid">
            <button
              v-for="mi in months"
              :key="mi"
              class="cal-picker-cell"
              :class="{ selected: state.calPickerYear === y && mi === m }"
              @click="calPickerSelectMonth(mi)"
            >{{ mi + 1 }} 月</button>
          </div>
        </div>

        <div v-else-if="state.calPickerOpen && state.calPickerView === 'year'" class="cal-picker">
          <div class="cal-picker-head">
            <button class="cal-picker-nav" title="上一个年代" @click="calPickerDecade(-12)"><Icon name="chevLeft" /></button>
            <button class="cal-picker-title" title="返回月份" @click="calPickerToggleView">{{ state.calPickerDecade }} – {{ state.calPickerDecade + 11 }}</button>
            <button class="cal-picker-nav" title="下一个年代" @click="calPickerDecade(12)"><Icon name="chevRight" /></button>
          </div>
          <div class="cal-picker-grid">
            <button
              v-for="yr in decadeYears"
              :key="yr"
              class="cal-picker-cell"
              :class="{ selected: yr === y }"
              @click="calPickerSelectYear(yr)"
            >{{ yr }}</button>
          </div>
        </div>

        <template v-else>
          <div class="cal-weekdays">
            <span v-for="w in WEEKDAY_LABELS" :key="w">{{ w }}</span>
          </div>
          <div class="cal-days">
            <button
              v-for="c in cells"
              :key="c.dateStr"
              class="cal-day"
              :class="{ other: c.other, today: c.today, selected: c.selected }"
              :aria-label="c.dateStr"
              @click="calSelect(c.dateStr)"
            >
              <span class="cal-day-num">{{ c.day }}</span>
              <span v-if="c.count" class="cal-dot"></span>
            </button>
          </div>
        </template>
      </div>
    </div>

    <div class="day-entries-head">
      <h2 class="day-entries-title">{{ fmtDate(state.calSelected) }}<small v-if="selectedEntries.length">{{ selectedEntries.length }} 篇</small></h2>
      <button class="btn btn-soft btn-sm" @click="newDiary(state.calSelected)"><Icon name="plus" /> 写一篇</button>
    </div>

    <div v-if="selectedEntries.length" class="day-list">
      <button v-for="d in selectedEntries" :key="d.id" class="day-entry" @click="editDiary(d.id)">
        <span v-if="d.title && d.title.trim()" class="day-entry-title">{{ d.title }}</span>
        <span v-if="state.settings.showListExcerpt && d.excerpt" class="day-entry-excerpt">{{ d.excerpt }}</span>
        <span v-if="(d.tags || []).length" class="day-entry-meta">
          <span v-for="t in (d.tags || [])" :key="t" class="tag-pill">{{ t }}</span>
        </span>
      </button>
    </div>
    <div v-else class="day-empty">
      <Icon name="pen" />
      <p>这一天还没有记录</p>
      <button class="btn btn-soft" @click="newDiary(state.calSelected)"><Icon name="plus" /> 写一篇</button>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { state, showView, userAvatarChar, sidebarCollapsed } from '../store'
import { NAV_ITEMS } from '../utils/icons'
import Icon from './Icon.vue'

const diaryCount = computed(() => state.diaries.length)
const isImageAvatar = computed(() => (state.user.avatar || '').startsWith('data:image/'))

const MIN_W = 168
const MAX_W = 380
const COLLAPSED_W = 64
const WIDTH_KEY = 'kiko-sidebar-width'

function readWidth() {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(v) && v >= MIN_W && v <= MAX_W) return v
  } catch (e) { /* ignore */ }
  return 232
}

const width = ref(readWidth())

/* ---- drag to resize ---- */
const COLLAPSE_THRESHOLD = 120
const COLLAPSED_KEY = 'kiko-sidebar-collapsed'

let dragging = false
let startX = 0
let startW = 0

function onResizeStart(e) {
  e.preventDefault()
  dragging = true
  startX = e.clientX
  startW = sidebarCollapsed.value ? COLLAPSED_W : width.value
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e) {
  if (!dragging) return
  const raw = startW + (e.clientX - startX)
  if (sidebarCollapsed.value) {
    // 收起状态：向右拖超过阈值就展开
    if (raw > COLLAPSE_THRESHOLD) {
      sidebarCollapsed.value = false
      width.value = Math.min(MAX_W, Math.max(MIN_W, raw))
    }
  } else if (raw < COLLAPSE_THRESHOLD) {
    // 展开状态：拖到很窄就自动收起
    sidebarCollapsed.value = true
  } else {
    width.value = Math.min(MAX_W, Math.max(MIN_W, raw))
  }
}

function onResizeEnd() {
  dragging = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  try {
    localStorage.setItem(WIDTH_KEY, String(width.value))
    localStorage.setItem(COLLAPSED_KEY, String(sidebarCollapsed.value))
  } catch (e) { /* ignore */ }
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
})

const sidebarStyle = computed(() => ({
  width: (sidebarCollapsed.value ? COLLAPSED_W : width.value) + 'px'
}))
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }" :style="sidebarStyle">
    <nav class="nav">
      <button
        v-for="n in NAV_ITEMS"
        :key="n.id"
        class="nav-item"
        :class="{ active: state.view === n.id }"
        :title="sidebarCollapsed ? n.label : undefined"
        @click="showView(n.id)"
      >
        <Icon :name="n.icon" /><span>{{ n.label }}</span>
        <span v-if="n.id === 'diary'" class="nav-badge">{{ diaryCount }}</span>
      </button>
    </nav>
    <div class="sidebar-spacer"></div>
    <div class="sidebar-foot">
      <div class="user">
        <div class="avatar">
          <img v-if="isImageAvatar" :src="state.user.avatar" alt="" class="avatar-img">
          <template v-else>{{ userAvatarChar() }}</template>
        </div>
        <div class="user-meta">
          <b>{{ state.user.name || 'Kiko User' }}</b>
        </div>
      </div>
    </div>
    <div
      class="sidebar-resizer"
      title="拖动调整宽度（拖到最窄自动收起）"
      @mousedown="onResizeStart"
    ></div>
  </aside>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const dragging = ref(false)
const imgEl = ref(null)
const stageEl = ref(null)

const percent = computed(() => Math.round(scale.value * 100))
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let previousFullscreen = false
let pointerId = -1
let startX = 0
let startY = 0
let startTx = 0
let startTy = 0

function clampScale(value) {
  return Math.min(32, Math.max(0.15, value))
}

function resetView() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

function zoomAt(factor, clientX, clientY) {
  const rect = stageEl.value?.getBoundingClientRect()
  if (!rect) return
  const next = clampScale(scale.value * factor)
  if (next === scale.value) return
  const cx = clientX - rect.left - rect.width / 2
  const cy = clientY - rect.top - rect.height / 2
  const ratio = next / scale.value
  tx.value = cx - (cx - tx.value) * ratio
  ty.value = cy - (cy - ty.value) * ratio
  scale.value = next
}

function onWheel(event) {
  event.preventDefault()
  zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY)
}

function onPointerDown(event) {
  if (event.button !== 0) return
  dragging.value = true
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  startTx = tx.value
  startTy = ty.value
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function onPointerMove(event) {
  if (!dragging.value || event.pointerId !== pointerId) return
  tx.value = startTx + event.clientX - startX
  ty.value = startTy + event.clientY - startY
}

function endDrag() {
  dragging.value = false
  pointerId = -1
}

function toggleZoom(event) {
  if (scale.value > 1.01) {
    resetView()
    return
  }
  zoomAt(2, event.clientX, event.clientY)
}

function zoomIn() {
  zoomAt(1.2, window.innerWidth / 2, window.innerHeight / 2)
}

function zoomOut() {
  zoomAt(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2)
}

function actualSize() {
  const img = imgEl.value
  if (!img || !img.clientWidth) return
  scale.value = clampScale(img.naturalWidth / img.clientWidth)
  tx.value = 0
  ty.value = 0
}

function download() {
  const link = document.createElement('a')
  link.href = props.src
  link.download = props.alt || 'image'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function enterFullscreen() {
  if (isTauri) {
    try {
      const win = getCurrentWindow()
      previousFullscreen = await win.isFullscreen()
      if (!previousFullscreen) await win.setFullscreen(true)
      return
    } catch (e) {
      console.error('[viewer] fullscreen failed', e)
    }
  }
  document.documentElement.requestFullscreen?.().catch(() => {})
}

async function exitFullscreen() {
  if (isTauri) {
    try {
      if (!previousFullscreen) await getCurrentWindow().setFullscreen(false)
      return
    } catch (e) {
      console.error('[viewer] exit fullscreen failed', e)
    }
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
}

function close() {
  emit('close')
}

function onKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomAt(1.2, window.innerWidth / 2, window.innerHeight / 2)
  } else if (event.key === '-') {
    event.preventDefault()
    zoomAt(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2)
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      resetView()
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      await enterFullscreen()
    } else {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeydown)
      await exitFullscreen()
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKeydown)
  if (props.open) exitFullscreen()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="stageEl"
      class="image-viewer"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <img
        ref="imgEl"
        class="image-viewer-img"
        :class="{ dragging }"
        :src="src"
        :alt="alt"
        :style="{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }"
        draggable="false"
        @dblclick.stop.prevent="toggleZoom"
      >

      <div class="image-viewer-toolbar" @pointerdown.stop @dblclick.stop>
        <button type="button" title="缩小" @click="zoomOut">
          <Icon name="minus" />
        </button>
        <span class="image-viewer-percent">{{ percent }}%</span>
        <button type="button" title="放大" @click="zoomIn">
          <Icon name="plus" />
        </button>
        <span class="image-viewer-sep" />
        <button type="button" class="toolbar-text" @click="resetView">适应屏幕</button>
        <button type="button" class="toolbar-text" @click="actualSize">1:1</button>
        <button type="button" title="下载" @click="download"><Icon name="download" /></button>
        <span class="image-viewer-sep" />
        <button type="button" title="关闭" @click="close"><Icon name="x" /></button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.92);
  overflow: hidden;
  touch-action: none;
}
.image-viewer-img {
  max-width: 100vw;
  max-height: 100vh;
  user-select: none;
  cursor: grab;
  transform-origin: center center;
  will-change: transform;
}
.image-viewer-img.dragging { cursor: grabbing; }
.image-viewer-toolbar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 10px;
  background: rgba(24, 24, 27, 0.9);
  color: #f4f4f5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.image-viewer-toolbar button {
  height: 30px;
  min-width: 30px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  white-space: nowrap;
  flex: none;
  cursor: pointer;
}
.image-viewer-toolbar button:hover { background: rgba(255, 255, 255, 0.14); }
.image-viewer-toolbar svg { width: 15px; height: 15px; }
.image-viewer-percent {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.image-viewer-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.22);
  margin: 0 2px;
}
</style>

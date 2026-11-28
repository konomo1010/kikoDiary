<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

const win = getCurrentWindow()
const maximized = ref(false)
let unlisten = null

async function syncMaximized() {
  try {
    maximized.value = await win.isMaximized()
  } catch (e) { /* ignore */ }
}

async function minimize() {
  try { await win.minimize() } catch (e) { /* ignore */ }
}

async function toggleMaximize() {
  try {
    await win.toggleMaximize()
    await syncMaximized()
  } catch (e) { /* ignore */ }
}

async function close() {
  try { await win.close() } catch (e) { /* ignore */ }
}

function onDoubleClick(event) {
  if (event.clientY > 48) return
  const target = event.target
  if (target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return
  toggleMaximize()
}

onMounted(async () => {
  document.addEventListener('dblclick', onDoubleClick, true)
  await syncMaximized()
  try {
    unlisten = await win.onResized(() => syncMaximized())
  } catch (e) { /* ignore */ }
})

onBeforeUnmount(() => {
  document.removeEventListener('dblclick', onDoubleClick, true)
  unlisten?.()
  unlisten = null
})
</script>

<template>
  <div class="app-titlebar">
    <div class="app-titlebar-drag" data-tauri-drag-region></div>
    <div class="app-titlebar-actions">
      <button type="button" class="titlebar-btn" title="最小化" @click="minimize">
        <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
      </button>
      <button type="button" class="titlebar-btn" :title="maximized ? '还原' : '最大化'" @click="toggleMaximize">
        <svg v-if="maximized" viewBox="0 0 24 24">
          <rect x="6" y="8" width="12" height="12" rx="1" fill="none" />
          <path d="M9 8V6h11v11h-2" fill="none" />
        </svg>
        <svg v-else viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1" fill="none" /></svg>
      </button>
      <button type="button" class="titlebar-btn titlebar-close" title="关闭" @click="close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-titlebar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 30px;
  display: flex;
  align-items: stretch;
  z-index: 2000;
  background: transparent;
  border: none;
  pointer-events: none;
  user-select: none;
}
.app-titlebar-drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 10px;
  pointer-events: auto;
}
.app-titlebar-actions { display: flex; height: 100%; margin-left: auto; pointer-events: auto; }
.titlebar-btn {
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.titlebar-btn:hover { background: var(--surface-2); color: var(--fg); }
.titlebar-close:hover { background: #e81123; color: #fff; }
.titlebar-btn svg {
  width: 12px;
  height: 12px;
  stroke: currentColor;
  stroke-width: 1.2;
  fill: none;
}
</style>

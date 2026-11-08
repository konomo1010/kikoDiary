<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { state, init, showView } from './store'
import Sidebar from './components/Sidebar.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import Modal from './components/Modal.vue'
import TagModal from './components/TagModal.vue'
import ToastHost from './components/ToastHost.vue'
import HomeView from './views/HomeView.vue'
import DiaryView from './views/DiaryView.vue'
import EditorView from './views/EditorView.vue'
import TagsView from './views/TagsView.vue'
import SettingsView from './views/SettingsView.vue'

const ready = ref(false)
init()
  .catch((e) => { console.error('[app] init failed', e) })
  .finally(() => { ready.value = true })

/** 鼠标侧键「后退」：交给当前页面处理，非编辑/日记页直接回首页 */
function onAuxClick(event) {
  if (event.button !== 3) return
  event.preventDefault()
  if (state.view === 'editor' || state.view === 'diary') {
    window.dispatchEvent(new Event('kiko:back'))
    return
  }
  if (state.view !== 'home') showView('home')
}

/** WebView 的侧键历史返回在 mouseup 阶段触发，必须提前拦掉 */
function blockBackButton(event) {
  if (event.button !== 3) return
  event.preventDefault()
  event.stopPropagation()
}

onMounted(() => {
  window.addEventListener('mousedown', blockBackButton, true)
  window.addEventListener('mouseup', blockBackButton, true)
  window.addEventListener('auxclick', onAuxClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', blockBackButton, true)
  window.removeEventListener('mouseup', blockBackButton, true)
  window.removeEventListener('auxclick', onAuxClick)
})
</script>

<template>
  <div v-if="ready" class="app">
    <Sidebar />
    <main class="main" :class="{ 'main--diary': state.view === 'diary' }">
      <!-- 编辑页内部自带面包屑（需要先确认未保存更改），这里只渲染其他页面 -->
      <div v-if="state.view !== 'editor' && state.view !== 'diary'" class="content-top">
        <Breadcrumb />
      </div>
      <HomeView v-if="state.view === 'home'" />
      <DiaryView v-else-if="state.view === 'diary'" />
      <EditorView v-else-if="state.view === 'editor'" />
      <TagsView v-else-if="state.view === 'tags'" />
      <SettingsView v-else-if="state.view === 'settings'" />
    </main>
  </div>
  <ToastHost />
  <Modal />
  <TagModal />
</template>
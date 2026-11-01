<script setup>
import { ref } from 'vue'
import { state, init } from './store'
import Sidebar from './components/Sidebar.vue'
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
</script>

<template>
  <div v-if="ready" class="app">
    <Sidebar />
    <main class="main">
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
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { state, saveDiaryFromPanel, toggleTag, openTagModal } from '../store'
import * as dbApi from '../api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { normalizeContent, todayStr, docToText } from '../utils/helpers'
import NotionLikeEditor from '../components/NotionLikeEditor.vue'
import EditorBodyCard from '../components/EditorBodyCard.vue'

const props = defineProps({
  diaryId: { type: Number, default: null },
})
const emit = defineEmits(['close', 'full-edit', 'saved', 'dirty-change'])

const title = computed({
  get: () => state.panelTitle,
  set: (v) => { state.panelTitle = v },
})
const date = computed({
  get: () => state.panelDate,
  set: (v) => { state.panelDate = v },
})
const content = ref(null)
const loading = ref(false)
const initialSnapshot = ref('')
const panelEl = ref(null)

const diary = computed(() => state.diaries.find((x) => x.id === props.diaryId) || null)
const wordCount = computed(() => docToText(content.value).replace(/\s/g, '').length)

function resolveImageSrc(doc) {
  const walk = (node) => {
    if (node && node.type === 'image' && node.attrs && node.attrs.src) {
      const src = node.attrs.src
      if (
        typeof src === 'string' &&
        !src.startsWith('blob:') &&
        !src.startsWith('http') &&
        !src.startsWith('asset:') &&
        !src.startsWith('data:')
      ) {
        node.attrs.src = convertFileSrc(src)
      }
    }
    if (node && Array.isArray(node.content)) node.content.forEach(walk)
  }
  if (doc) walk(doc)
  return doc
}

function snapshot() {
  return JSON.stringify({
    title: title.value.trim(),
    content: content.value,
    date: date.value,
    hasTitle: state.hasTitle,
    tags: [...state.activeTags].sort(),
  })
}

const dirty = computed(() => !!initialSnapshot.value && snapshot() !== initialSnapshot.value)
watch(dirty, (value) => emit('dirty-change', value))

function panelScrollEls() {
  const root = panelEl.value
  if (!root) return []
  return [...root.querySelectorAll('.notion-like-editor-layout, .notion-like-editor-content, .tiptap.ProseMirror')]
}

function getPanelScrollTop() {
  return panelScrollEls()[0]?.scrollTop || 0
}

function resetPanelScroll(top = 0) {
  nextTick(() => {
    requestAnimationFrame(() => {
      panelScrollEls().forEach((el) => { el.scrollTop = top })
    })
  })
}

async function load(id) {
  if (id == null) return
  const savedScrollTop = state.settings.panelKeepScroll ? getPanelScrollTop() : 0
  loading.value = true
  initialSnapshot.value = ''
  const d = state.diaries.find((x) => x.id === id)
  title.value = d?.title || ''
  date.value = d?.date || todayStr()
  state.hasTitle = !!(d?.title && d.title.trim())
  state.activeTags = [...(d?.tags || [])]
  try {
    const body = await dbApi.getBody(id)
    content.value = normalizeContent(resolveImageSrc(body))
  } catch (e) {
    console.error('[panel] load body failed', e)
    content.value = null
  }
  await nextTick()
  initialSnapshot.value = snapshot()
  loading.value = false
  resetPanelScroll(savedScrollTop)
}

watch(
  () => props.diaryId,
  (id) => {
    if (id != null) load(id)
  },
  { immediate: true },
)

function onToggleTitle() {
  state.hasTitle = !state.hasTitle
  if (!state.hasTitle) title.value = ''
}

async function save() {
  if (props.diaryId == null) return false
  const ok = await saveDiaryFromPanel(
    props.diaryId,
    state.hasTitle ? title.value.trim() : '',
    content.value,
    date.value,
    [...state.activeTags],
  )
  if (ok) {
    if (!state.hasTitle) title.value = ''
    initialSnapshot.value = snapshot()
    emit('saved')
  }
  return ok
}

function onKeydown(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  if (String(e.key || '').toLowerCase() !== 's') return
  e.preventDefault()
  e.stopPropagation()
  save()
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

defineExpose({
  hasUnsavedChanges: () => dirty.value,
  save,
})
</script>

<template>
  <section ref="panelEl" class="diary-panel">
    <EditorBodyCard :content="content" :title="state.hasTitle ? title.trim() : ''" status="编辑日记">
      <div class="diary-panel-body">
        <NotionLikeEditor v-model="content" />
      </div>
    </EditorBodyCard>
  </section>
</template>

<style scoped>
.diary-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 90px);
  min-height: 460px;
  max-height: none;
  padding: 0;
  overflow: hidden;
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
}
.diary-panel-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 0 8px;
}
</style>

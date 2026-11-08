<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { state, saveDiary, deleteDiary, backFromEditor, toggleTag, openTagModal, openModal, editorDark, modal, tagModal, navigateTo } from '../store'
import * as dbApi from '../api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { todayStr, normalizeContent } from '../utils/helpers'
import Icon from '../components/Icon.vue'
import Breadcrumb from '../components/Breadcrumb.vue'
import NotionLikeEditor from '../components/NotionLikeEditor.vue'
import EditorTitleCard from '../components/EditorTitleCard.vue'
import EditorBodyCard from '../components/EditorBodyCard.vue'

const isNew = computed(() => state.editingId == null)
const currentDiary = computed(() => isNew.value ? null : state.diaries.find((x) => x.id === state.editingId))

const title = ref('')
const content = ref(null)
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

/* ---- date ---- */
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

function onSave(opts) {
  const result = saveDiary(
    state.hasTitle ? title.value.trim() : '',
    content.value,
    dateValue.value,
    opts
  )
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

onMounted(async () => {
  await initEditor()
  // 等 Tiptap 完成首次内容同步，避免初始化补全被当作未保存修改
  await nextTick()
  initialSnapshot.value = diarySnapshot()
  // 捕获阶段监听，确保先于编辑器/Tiptap 的按键处理，并拦下浏览器默认保存
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('kiko:back', onBack)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('kiko:back', onBack)
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

    <EditorTitleCard v-model:title="title" v-model:date="dateValue" :autofocus="isNew && state.hasTitle" />

    <EditorBodyCard :content="content" :status="isNew ? '新建日记' : '编辑日记'">
      <NotionLikeEditor v-model="content" :autofocus="isNew && !state.hasTitle" />
    </EditorBodyCard>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { blockHandleState } from '../lib/blockHandleState'
import TiIcon from './ui/TiIcon.vue'

const node = computed(() => blockHandleState.node)
const editor = computed(() => blockHandleState.editor)

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const turnIntoItems = [
  { label: 'Text', value: 'paragraph', icon: 'text' },
  { label: 'Heading 1', value: 'h1', icon: 'heading1' },
  { label: 'Heading 2', value: 'h2', icon: 'heading2' },
  { label: 'Heading 3', value: 'h3', icon: 'heading3' },
  { label: 'Bullet List', value: 'bulletList', icon: 'bullet-list' },
  { label: 'Numbered List', value: 'orderedList', icon: 'ordered-list' },
  { label: 'To-do list', value: 'taskList', icon: 'task-list' },
  { label: 'Blockquote', value: 'blockquote', icon: 'blockquote' },
  { label: 'Code Block', value: 'codeBlock', icon: 'code-block' },
]

function getPos(): number | null {
  const e = editor.value
  const n = node.value
  if (!e || !n) return null
  let found: number | null = null
  e.state.doc.descendants((child, pos) => {
    if (found !== null) return false
    if (child === n) {
      found = pos
      return false
    }
    return true
  })
  return found
}

function insertBelow() {
  const e = editor.value
  const n = node.value
  const pos = getPos()
  if (!e || !n || pos == null) return
  e.chain().focus().insertContentAt(pos + n.nodeSize, { type: 'paragraph' }).run()
  menuOpen.value = false
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function turnInto(value: string) {
  const e = editor.value
  const pos = getPos()
  if (!e || pos == null) return
  const c = e.chain().focus().setTextSelection(pos + 1)
  switch (value) {
    case 'paragraph':
      c.setParagraph().run()
      break
    case 'h1':
      c.setHeading({ level: 1 }).run()
      break
    case 'h2':
      c.setHeading({ level: 2 }).run()
      break
    case 'h3':
      c.setHeading({ level: 3 }).run()
      break
    case 'bulletList':
      c.toggleBulletList().run()
      break
    case 'orderedList':
      c.toggleOrderedList().run()
      break
    case 'taskList':
      c.toggleTaskList().run()
      break
    case 'blockquote':
      c.toggleBlockquote().run()
      break
    case 'codeBlock':
      c.toggleCodeBlock().run()
      break
  }
  menuOpen.value = false
}

function duplicate() {
  const e = editor.value
  const n = node.value
  const pos = getPos()
  if (!e || !n || pos == null) return
  e.chain().focus().insertContentAt(pos + n.nodeSize, n.toJSON()).run()
  menuOpen.value = false
}

function copyBlock() {
  const n = node.value
  if (!n) return
  navigator.clipboard?.writeText(n.textContent).catch(() => {})
  menuOpen.value = false
}

function deleteBlock() {
  const e = editor.value
  const n = node.value
  const pos = getPos()
  if (!e || !n || pos == null) return
  e.chain()
    .focus()
    .deleteRange({ from: pos, to: pos + n.nodeSize })
    .run()
  menuOpen.value = false
}

function onDocMousedown(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMousedown))
</script>

<template>
  <div v-if="node" ref="rootRef" class="block-handle">
    <button
      type="button"
      class="block-handle-btn"
      title="Insert block below"
      @click="insertBelow"
    >
      <TiIcon name="plus" class="block-handle-icon" />
    </button>
    <button
      type="button"
      class="block-handle-btn block-handle-grip"
      title="Click for options · hold to drag"
      @click="toggleMenu"
    >
      <TiIcon name="grip-vertical" class="block-handle-icon" />
    </button>

    <div v-if="menuOpen" class="block-menu">
      <div class="block-menu-label">Turn into</div>
      <button
        v-for="item in turnIntoItems"
        :key="item.value"
        type="button"
        class="block-menu-item"
        @click="turnInto(item.value)"
      >
        <TiIcon :name="item.icon" class="block-menu-icon" />
        {{ item.label }}
      </button>
      <div class="block-menu-sep" />
      <button type="button" class="block-menu-item" @click="duplicate">
        <TiIcon name="plus" class="block-menu-icon" /> Duplicate
      </button>
      <button type="button" class="block-menu-item" @click="copyBlock">
        Copy text
      </button>
      <button
        type="button"
        class="block-menu-item block-menu-danger"
        @click="deleteBlock"
      >
        <TiIcon name="trash" class="block-menu-icon" /> Delete
      </button>
    </div>
  </div>
</template>

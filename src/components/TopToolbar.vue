<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { injectEditor, useEditorTick } from '../composables/useEditor'
import { tocPosition, toggleTocPosition } from '../composables/useLayout'
import ToolbarButton from './ui/ToolbarButton.vue'
import DropdownMenu from './ui/DropdownMenu.vue'
import ColorPopover from './ui/ColorPopover.vue'
import LinkPopover from './ui/LinkPopover.vue'
import { pickAndInsertImage } from '../lib/editor'

const editor = injectEditor()
const tick = useEditorTick(editor)

function isActive(name: string, attrs?: Record<string, unknown>) {
  tick.value
  return editor?.value?.isActive(name, attrs) ?? false
}

function run(fn: (e: Editor) => void) {
  const e = editor?.value
  if (e) fn(e)
}

function toggleMark(name: string) {
  run((e) => e.chain().focus().toggleMark(name).run())
}

const blockItems = [
  { value: 'paragraph', label: 'Text', icon: 'text' },
  { value: 'heading1', label: 'Heading 1', icon: 'heading1' },
  { value: 'heading2', label: 'Heading 2', icon: 'heading2' },
  { value: 'heading3', label: 'Heading 3', icon: 'heading3' },
  { value: 'bulletList', label: 'Bullet List', icon: 'bullet-list' },
  { value: 'orderedList', label: 'Numbered List', icon: 'ordered-list' },
  { value: 'taskList', label: 'To-do list', icon: 'task-list' },
  { value: 'blockquote', label: 'Blockquote', icon: 'blockquote' },
  { value: 'codeBlock', label: 'Code Block', icon: 'code-block' },
]

const activeBlock = computed(() => {
  tick.value
  const e = editor?.value
  if (!e) return 'paragraph'
  if (e.isActive('heading', { level: 1 })) return 'heading1'
  if (e.isActive('heading', { level: 2 })) return 'heading2'
  if (e.isActive('heading', { level: 3 })) return 'heading3'
  if (e.isActive('bulletList')) return 'bulletList'
  if (e.isActive('orderedList')) return 'orderedList'
  if (e.isActive('taskList')) return 'taskList'
  if (e.isActive('blockquote')) return 'blockquote'
  if (e.isActive('codeBlock')) return 'codeBlock'
  return 'paragraph'
})

const activeBlockLabel = computed(
  () => blockItems.find((i) => i.value === activeBlock.value)?.label ?? 'Text'
)

function setBlock(value: string) {
  run((e) => {
    const c = e.chain().focus()
    switch (value) {
      case 'paragraph':
        c.setParagraph().run()
        break
      case 'heading1':
        c.setHeading({ level: 1 }).run()
        break
      case 'heading2':
        c.setHeading({ level: 2 }).run()
        break
      case 'heading3':
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
  })
}

function setAlign(align: string) {
  run((e) => e.chain().focus().setTextAlign(align).run())
}
function isAlignActive(align: string) {
  tick.value
  return editor?.value?.isActive({ textAlign: align }) ?? false
}

function insertImage() {
  pickAndInsertImage(editor?.value ?? null)
}

// ---- Right-side header actions: TOC position / undo / redo / theme ----
const tocSide = computed(() => tocPosition.value)

const canUndo = computed(() => {
  tick.value
  return editor?.value?.can().undo() ?? false
})
const canRedo = computed(() => {
  tick.value
  return editor?.value?.can().redo() ?? false
})

function undo() {
  editor?.value?.chain().focus().undo().run()
}
function redo() {
  editor?.value?.chain().focus().redo().run()
}

// Editor-local dark mode (provided by NotionLikeEditor). Does not touch the app theme.
const editorDark = inject('editorDark', ref(false))
const toggleEditorDark = inject('toggleEditorDark', () => {})
</script>

<template>
  <div class="tiptap-toolbar notion-like-editor-toolbar-top" data-variant="fixed">
    <div class="tiptap-toolbar-group">
      <DropdownMenu
        :items="blockItems"
        :trigger-text="activeBlockLabel"
        :active-value="activeBlock"
        label="Turn into"
        @select="setBlock"
      />
    </div>

    <span class="tt-separator" />

    <div class="tiptap-toolbar-group">
      <ToolbarButton icon="bold" label="Bold" :active="isActive('bold')" @click="toggleMark('bold')" />
      <ToolbarButton icon="italic" label="Italic" :active="isActive('italic')" @click="toggleMark('italic')" />
      <ToolbarButton icon="underline" label="Underline" :active="isActive('underline')" @click="toggleMark('underline')" />
      <ToolbarButton icon="strike" label="Strikethrough" :active="isActive('strike')" @click="toggleMark('strike')" />
      <ToolbarButton icon="code" label="Inline code" :active="isActive('code')" @click="toggleMark('code')" />
    </div>

    <span class="tt-separator" />

    <div class="tiptap-toolbar-group">
      <ColorPopover mode="text" icon="text-color" label="Text color" />
      <ColorPopover mode="highlight" icon="highlight" label="Highlight" />
    </div>

    <span class="tt-separator" />

    <div class="tiptap-toolbar-group">
      <ToolbarButton icon="bullet-list" label="Bullet list" :active="isActive('bulletList')" @click="run(e => e.chain().focus().toggleBulletList().run())" />
      <ToolbarButton icon="ordered-list" label="Numbered list" :active="isActive('orderedList')" @click="run(e => e.chain().focus().toggleOrderedList().run())" />
      <ToolbarButton icon="task-list" label="To-do list" :active="isActive('taskList')" @click="run(e => e.chain().focus().toggleTaskList().run())" />
    </div>

    <div class="tiptap-toolbar-group">
      <ToolbarButton icon="blockquote" label="Blockquote" :active="isActive('blockquote')" @click="run(e => e.chain().focus().toggleBlockquote().run())" />
      <ToolbarButton icon="code-block" label="Code block" :active="isActive('codeBlock')" @click="run(e => e.chain().focus().toggleCodeBlock().run())" />
    </div>

    <span class="tt-separator" />

    <div class="tiptap-toolbar-group">
      <LinkPopover icon="link" label="Link" />
      <ToolbarButton icon="image" label="Insert image" @click="insertImage" />
    </div>

    <span class="tt-separator" />

    <div class="tiptap-toolbar-group">
      <ToolbarButton icon="align-left" label="Align left" :active="isAlignActive('left')" @click="setAlign('left')" />
      <ToolbarButton icon="align-center" label="Align center" :active="isAlignActive('center')" @click="setAlign('center')" />
      <ToolbarButton icon="align-right" label="Align right" :active="isAlignActive('right')" @click="setAlign('right')" />
    </div>

    <div class="tiptap-toolbar-group">
      <ToolbarButton icon="indent-decrease" label="Decrease indent" @click="run(e => e.chain().focus().outdent().run())" />
      <ToolbarButton icon="indent-increase" label="Increase indent" @click="run(e => e.chain().focus().indent().run())" />
    </div>

    <span class="tt-separator" />

    <div class="tiptap-toolbar-group tiptap-toolbar-actions">
      <ToolbarButton
        :icon="tocSide === 'left' ? 'panel-left' : 'panel-right'"
        :label="tocSide === 'left' ? 'TOC: left (click to move right)' : 'TOC: right (click to move left)'"
        @click="toggleTocPosition"
      />
      <ToolbarButton icon="undo" label="Undo" :disabled="!canUndo" @click="undo" />
      <ToolbarButton icon="redo" label="Redo" :disabled="!canRedo" @click="redo" />
      <ToolbarButton
        :icon="editorDark ? 'sun' : 'moon'"
        :label="editorDark ? 'Light mode (editor only)' : 'Dark mode (editor only)'"
        @click="toggleEditorDark"
      />
    </div>
  </div>
</template>

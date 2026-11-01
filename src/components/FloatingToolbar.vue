<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NodeSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { injectEditor } from '../composables/useEditor'
import ToolbarButton from './ui/ToolbarButton.vue'
import DropdownMenu from './ui/DropdownMenu.vue'
import ColorPopover from './ui/ColorPopover.vue'
import LinkPopover from './ui/LinkPopover.vue'

const editor = injectEditor()

const visible = ref(false)
const left = ref(0)
const top = ref(0)
const tick = ref(0)

function bump() {
  tick.value += 1
}

function update() {
  const e = editor?.value
  if (!e) {
    visible.value = false
    return
  }
  const { selection } = e.state
  const { from, to, empty } = selection
  if (empty || from === to) {
    visible.value = false
    return
  }
  const start = e.view.coordsAtPos(from)
  const end = e.view.coordsAtPos(to)
  left.value = (start.left + end.right) / 2
  top.value = Math.min(start.top, end.top)
  visible.value = true
}

watch(
  () => editor?.value,
  (next, prev) => {
    prev?.off('selectionUpdate', update)
    prev?.off('transaction', update)
    next?.on('selectionUpdate', update)
    next?.on('transaction', update)
    update()
  },
  { immediate: true }
)

const imageSelected = computed(() => {
  tick.value
  const e = editor?.value
  if (!e) return false
  const sel = e.state.selection
  return sel instanceof NodeSelection && sel.node.type.name === 'image'
})

const imageAttrs = computed(() => {
  tick.value
  return editor?.value?.getAttributes('image') ?? {}
})
const imageAlign = computed(() => imageAttrs.value['data-align'] || 'center')
const imageShowCaption = computed(() => !!imageAttrs.value.showCaption)

function updateImage(attrs: Record<string, unknown>) {
  editor?.value?.chain().focus().updateAttributes('image', attrs).run()
}
function setImageAlign(align: string) {
  updateImage({ 'data-align': align })
}
function toggleImageCaption() {
  updateImage({ showCaption: !imageShowCaption.value })
}
function downloadImage() {
  const e = editor?.value
  if (!e) return
  const { src, alt } = e.getAttributes('image')
  if (!src) return
  const a = document.createElement('a')
  a.href = src
  a.download = alt || 'image'
  a.target = '_blank'
  a.rel = 'noopener'
  a.click()
}
function replaceImage() {
  const e = editor?.value
  if (!e) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    e.chain().focus().updateAttributes('image', { src: url }).run()
    input.remove()
  }
  input.click()
}
function deleteImage() {
  editor?.value?.chain().focus().deleteSelection().run()
}

function isActive(name: string) {
  tick.value
  return editor?.value?.isActive(name) ?? false
}

function run(fn: (e: Editor) => void) {
  const e = editor?.value
  if (e) fn(e)
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
</script>

<template>
  <Transition name="tt-fade">
    <div
      v-show="visible"
      class="floating-toolbar"
      :style="{ left: `${left}px`, top: `${top}px` }"
    >
      <div class="tiptap-toolbar" data-variant="floating">
        <template v-if="imageSelected">
          <div class="tiptap-toolbar-group">
            <ToolbarButton icon="align-left" label="Align left" :active="imageAlign === 'left'" @click="setImageAlign('left')" />
            <ToolbarButton icon="align-center" label="Align center" :active="imageAlign === 'center'" @click="setImageAlign('center')" />
            <ToolbarButton icon="align-right" label="Align right" :active="imageAlign === 'right'" @click="setImageAlign('right')" />
          </div>
          <span class="tt-separator" />
          <div class="tiptap-toolbar-group">
            <ToolbarButton icon="image-caption" label="Caption" :active="imageShowCaption" @click="toggleImageCaption" />
          </div>
          <span class="tt-separator" />
          <div class="tiptap-toolbar-group">
            <ToolbarButton icon="arrow-down-to-line" label="Download" @click="downloadImage" />
            <ToolbarButton icon="refresh-ccw" label="Replace" @click="replaceImage" />
          </div>
          <span class="tt-separator" />
          <div class="tiptap-toolbar-group">
            <ToolbarButton icon="trash" label="Delete" @click="deleteImage" />
          </div>
        </template>

        <template v-else>
          <div class="tiptap-toolbar-group">
            <DropdownMenu
              :items="blockItems"
              :active-value="activeBlock"
              label="Turn into"
              @select="setBlock"
            />
          </div>

          <span class="tt-separator" />

          <div class="tiptap-toolbar-group">
            <ToolbarButton icon="bold" label="Bold" :active="isActive('bold')" @click="run(e => e.chain().focus().toggleBold().run())" />
            <ToolbarButton icon="italic" label="Italic" :active="isActive('italic')" @click="run(e => e.chain().focus().toggleItalic().run())" />
            <ToolbarButton icon="underline" label="Underline" :active="isActive('underline')" @click="run(e => e.chain().focus().toggleUnderline().run())" />
            <ToolbarButton icon="strike" label="Strikethrough" :active="isActive('strike')" @click="run(e => e.chain().focus().toggleStrike().run())" />
            <ToolbarButton icon="code" label="Inline code" :active="isActive('code')" @click="run(e => e.chain().focus().toggleCode().run())" />
          </div>

          <span class="tt-separator" />

          <div class="tiptap-toolbar-group">
            <ColorPopover mode="text" icon="text-color" label="Text color" />
            <ColorPopover mode="highlight" icon="highlight" label="Highlight" />
            <LinkPopover icon="link" label="Link" />
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

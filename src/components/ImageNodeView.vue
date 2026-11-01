<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/core'

const props = defineProps<NodeViewProps>()

const imgRef = ref<HTMLImageElement | null>(null)
const width = ref<number | null>(props.node.attrs.width ?? null)
const resizing = ref(false)
const direction = ref(1)
const startX = ref(0)
const startWidth = ref(0)

const align = computed(() => props.node.attrs['data-align'] || 'center')
const showCaption = computed(
  () => props.node.attrs.showCaption || props.node.content.size > 0
)

function startResize(side: 'left' | 'right', e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const el = imgRef.value
  if (!el) return
  resizing.value = true
  direction.value = side === 'left' ? -1 : 1
  startX.value = e.clientX
  startWidth.value = el.getBoundingClientRect().width
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', endResize)
}

function onResize(e: MouseEvent) {
  if (!resizing.value) return
  const delta = (e.clientX - startX.value) * direction.value
  const maxWidth = (props.editor.view.dom as HTMLElement)?.clientWidth ?? 800
  const next = Math.max(96, Math.min(startWidth.value + delta, maxWidth))
  width.value = Math.round(next)
}

function endResize() {
  if (!resizing.value) return
  resizing.value = false
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', endResize)
  if (width.value != null) {
    props.updateAttributes({ width: width.value })
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', endResize)
})

function selectImage() {
  const pos = props.getPos()
  if (typeof pos === 'number') {
    props.editor.chain().focus().setNodeSelection(pos).run()
  }
}
</script>

<template>
  <NodeViewWrapper
    class="image-node"
    :data-align="align"
    :data-selected="selected ? 'true' : 'false'"
    :class="{ 'is-resizing': resizing }"
  >
    <div class="image-node-content">
      <img
        ref="imgRef"
        :src="node.attrs.src"
        :alt="node.attrs.alt || ''"
        :title="node.attrs.title || undefined"
        :style="{ width: width ? `${width}px` : undefined }"
        class="image-node-img"
        draggable="false"
        @mousedown.prevent="selectImage"
      />

      <div
        class="image-node-handle image-node-handle-left"
        contenteditable="false"
        @mousedown="startResize('left', $event)"
      />
      <div
        class="image-node-handle image-node-handle-right"
        contenteditable="false"
        @mousedown="startResize('right', $event)"
      />
    </div>

    <NodeViewContent
      as="div"
      class="image-node-caption"
      :data-visible="showCaption ? 'true' : 'false'"
      :data-placeholder="showCaption ? 'Add a caption…' : undefined"
    />
  </NodeViewWrapper>
</template>

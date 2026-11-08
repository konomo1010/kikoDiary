<script setup>
import { computed } from 'vue'
import { editorDark } from '../store'
import { docToText } from '../utils/helpers'

const props = defineProps({
  content: { type: [Object, String], default: null },
  status: { type: String, default: '' },
})

const wordCount = computed(() => docToText(props.content).replace(/\s/g, '').length)
</script>

<template>
  <div class="card editor-card editor-card-body" :class="{ 'editor-card-body--dark': editorDark }">
    <slot />

    <div
      class="editor-foot"
      :class="{ 'editor-foot--dark': editorDark }"
      :style="editorDark ? { background: '#0e0e11', color: 'rgba(245,245,245,0.65)' } : {}"
    >
      <span class="word-count">{{ wordCount }} 字</span>
      <span v-if="status" class="word-count">{{ status }}</span>
    </div>
  </div>
</template>

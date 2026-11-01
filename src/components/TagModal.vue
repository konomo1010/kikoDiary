<script setup>
import { computed } from 'vue'
import { state, tagModal, closeTagModal, toggleTag, addTagFromModal, tagCount } from '../store'
import Icon from './Icon.vue'

const filteredTags = computed(() => {
  const q = tagModal.search.trim().toLowerCase()
  if (!q) return state.tags
  return state.tags.filter((t) => t.toLowerCase().includes(q))
})
</script>

<template>
  <div v-if="tagModal.open" class="modal-overlay" @click.self="closeTagModal">
    <div class="modal tag-modal" style="max-width: 560px;">
      <h3>选择标签</h3>
      <p>点击标签进行多选，选择后自动保存。</p>
      <div class="tag-modal-search">
        <Icon name="search" />
        <input v-model="tagModal.search" type="text" placeholder="搜索标签…">
      </div>
      <div class="modal-scroll">
        <div v-if="!state.tags.length" class="tag-modal-empty">
          <p>还没有标签</p>
          <button class="btn btn-soft" @click="addTagFromModal('')"><Icon name="plus" /> 新建标签</button>
        </div>
        <div v-else-if="!filteredTags.length" class="tag-modal-empty">
          <p>没有找到与「{{ tagModal.search.trim() }}」匹配的标签</p>
          <button class="btn btn-soft" @click="addTagFromModal(tagModal.search.trim())"><Icon name="plus" /> 新建标签「{{ tagModal.search.trim() }}」</button>
        </div>
        <div v-else class="tag-modal-grid">
          <button
            v-for="t in filteredTags"
            :key="t"
            type="button"
            class="tag-modal-option"
            :class="{ on: state.activeTags.includes(t) }"
            :aria-pressed="state.activeTags.includes(t)"
            @click="toggleTag(t)"
          >
            <span class="mark"><Icon v-if="state.activeTags.includes(t)" name="check" /></span>
            <span class="n">{{ t }}</span>
            <span class="cnt">{{ tagCount(t) }} 篇</span>
          </button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" @click="addTagFromModal(tagModal.search.trim())"><Icon name="plus" /> 新建标签</button>
        <button class="btn btn-primary" @click="closeTagModal">完成</button>
      </div>
    </div>
  </div>
</template>
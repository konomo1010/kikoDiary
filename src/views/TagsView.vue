<script setup>
import { computed } from 'vue'
import { state, tagCount, filterByTag, openAddTag, renameTag, deleteTag } from '../store'
import Icon from '../components/Icon.vue'

const counts = computed(() =>
  state.tags.map((t) => ({ name: t, count: tagCount(t) })).sort((a, b) => b.count - a.count)
)
const max = computed(() => Math.max(1, ...counts.value.map((c) => c.count)))
</script>

<template>
  <section class="view">
    <div class="page-head">
      <div>
        <h1 class="page-title">标签</h1>
        <p class="page-sub">用标签整理你的日记，共 {{ state.tags.length }} 个标签</p>
      </div>
      <button class="btn btn-primary" @click="openAddTag"><Icon name="plus" /> 添加标签</button>
    </div>

    <div v-if="counts.length" class="tags-grid">
      <div v-for="t in counts" :key="t.name" class="card tag-card" @click="filterByTag(t.name)">
        <div class="tag-card-head">
          <h3 class="tname">{{ t.name }}</h3>
          <div class="tag-actions">
            <button class="tag-action-btn" title="重命名" :aria-label="`重命名 ${t.name}`" @click.stop="renameTag(t.name)"><Icon name="pen" /></button>
            <button class="tag-action-btn danger" title="删除" :aria-label="`删除 ${t.name}`" @click.stop="deleteTag(t.name)"><Icon name="trash" /></button>
          </div>
        </div>
        <p class="tcount">{{ t.count }} 篇日记</p>
        <div class="tag-bar"><span :style="{ width: (t.count / max) * 100 + '%' }"></span></div>
      </div>
    </div>
    <div v-else class="empty">
      <Icon name="tag" />
      <p>还没有标签</p>
      <button class="btn btn-primary" @click="openAddTag"><Icon name="plus" /> 添加第一个标签</button>
    </div>
  </section>
</template>
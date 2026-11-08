<script setup lang="ts">
import { computed } from 'vue'
import { slashState } from '../lib/slash'
import TiIcon from './ui/TiIcon.vue'

function select(index: number) {
  slashState.selectedIndex = index
  const item = slashState.items[index]
  if (item) slashState.command?.(item)
}

/** 按 group 分组，保持原始顺序 */
const grouped = computed(() => {
  const groups: { label: string; items: { item: (typeof slashState.items)[0]; index: number }[] }[] = []
  const map = new Map<string, { label: string; items: { item: (typeof slashState.items)[0]; index: number }[] }>()
  slashState.items.forEach((item, index) => {
    const label = item.group || ''
    let g = map.get(label)
    if (!g) {
      g = { label, items: [] }
      map.set(label, g)
      groups.push(g)
    }
    g.items.push({ item, index })
  })
  return groups
})
</script>

<template>
  <div class="slash-menu">
    <template v-for="(group, gi) in grouped" :key="group.label || gi">
      <div v-if="group.label" class="slash-menu-group-label">{{ group.label }}</div>
      <button
        v-for="entry in group.items"
        :key="entry.index"
        type="button"
        class="slash-menu-item"
        :class="{ 'is-active': entry.index === slashState.selectedIndex }"
        @click="select(entry.index)"
        @mousemove="slashState.selectedIndex = entry.index"
      >
        <TiIcon :name="entry.item.icon" class="slash-icon" />
        <span class="slash-body">
          <span class="slash-title">{{ entry.item.title }}</span>
          <span class="slash-desc">{{ entry.item.description }}</span>
        </span>
      </button>
    </template>
  </div>
</template>

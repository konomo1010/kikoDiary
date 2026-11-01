<script setup lang="ts">
import { slashState } from '../lib/slash'
import TiIcon from './ui/TiIcon.vue'

function select(index: number) {
  slashState.selectedIndex = index
  const item = slashState.items[index]
  if (item) slashState.command?.(item)
}
</script>

<template>
  <div class="slash-menu">
    <button
      v-for="(item, i) in slashState.items"
      :key="item.title"
      type="button"
      class="slash-menu-item"
      :class="{ 'is-active': i === slashState.selectedIndex }"
      @click="select(i)"
      @mousemove="slashState.selectedIndex = i"
    >
      <TiIcon :name="item.icon" class="slash-icon" />
      <span class="slash-body">
        <span class="slash-title">{{ item.title }}</span>
        <span class="slash-desc">{{ item.description }}</span>
      </span>
    </button>
  </div>
</template>

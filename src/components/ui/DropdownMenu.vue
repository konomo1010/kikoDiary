<script setup lang="ts">
import TiIcon from './TiIcon.vue'
import { usePopover } from '../../composables/usePopover'

interface DropdownItem {
  value: string
  label: string
  icon?: string
}

withDefaults(
  defineProps<{
    items: DropdownItem[]
    triggerText?: string
    triggerIcon?: string
    label?: string
    activeValue?: string
  }>(),
  { triggerText: '', triggerIcon: '', label: '', activeValue: '' }
)

const emit = defineEmits<{ select: [string] }>()

const { open, triggerRef, panelRef, style, toggle } = usePopover()

function select(value: string) {
  emit('select', value)
  open.value = false
}
</script>

<template>
  <button
    ref="triggerRef"
    type="button"
    class="tt-btn"
    :title="label"
    @click="toggle()"
  >
    <TiIcon v-if="triggerIcon" :name="triggerIcon" class="tt-btn-icon" />
    <span v-if="triggerText" class="tt-btn-label">{{ triggerText }}</span>
    <TiIcon name="chevron-down" class="tt-btn-caret" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="panelRef"
      class="tt-dropdown-panel"
      :style="style"
    >
      <button
        v-for="item in items"
        :key="item.value"
        type="button"
        class="tt-dropdown-item"
        :class="{ 'is-active': item.value === activeValue }"
        @click="select(item.value)"
      >
        <TiIcon v-if="item.icon" :name="item.icon" class="tt-btn-icon" />
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

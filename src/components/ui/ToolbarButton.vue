<script setup lang="ts">
import TiIcon from './TiIcon.vue'

withDefaults(
  defineProps<{
    icon?: string
    label?: string
    active?: boolean
    disabled?: boolean
  }>(),
  { active: false, disabled: false }
)

const emit = defineEmits<{ click: [MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="tt-btn"
    :class="{ 'is-active': active }"
    :disabled="disabled"
    :title="label"
    :aria-label="label"
    :aria-pressed="active || undefined"
    @click="emit('click', $event)"
  >
    <TiIcon v-if="icon" :name="icon" class="tt-btn-icon" />
    <slot />
  </button>
</template>

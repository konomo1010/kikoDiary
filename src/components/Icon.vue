<script setup>
import { computed } from 'vue'
import { ICONS } from '../utils/icons'

const props = defineProps({
  name: { type: String, required: true }
})

const svg = computed(() => ICONS[props.name] || '')
</script>

<template>
  <i class="icon" v-html="svg"></i>
</template>

<style scoped>
.icon {
  display: contents;
  font-style: normal;
}
</style>
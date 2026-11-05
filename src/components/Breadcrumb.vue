<script setup>
import { computed } from 'vue'
import { state, navigateTo } from '../store'
import { buildTrail } from '../utils/nav'

/**
 * resolveNav：可选。编辑页传入自己的跳转函数，先做「未保存更改」确认，
 * 确认后再调用 store 的 navigateTo。其他页面直接用默认跳转。
 */
const props = defineProps({
  resolveNav: { type: Function, default: null },
})

const trail = computed(() => buildTrail(state))

function go(crumb) {
  if (props.resolveNav) {
    props.resolveNav(crumb)
    return
  }
  navigateTo(crumb)
}
</script>

<template>
  <nav v-if="trail.length" class="breadcrumb" aria-label="面包屑导航">
    <template v-for="(c, i) in trail" :key="c.key">
      <button
        type="button"
        class="breadcrumb-item"
        :class="{ current: i === trail.length - 1 }"
        :aria-current="i === trail.length - 1 ? 'page' : undefined"
        :disabled="i === trail.length - 1"
        @click="go(c)"
      >{{ c.label }}</button>
      <span v-if="i < trail.length - 1" class="breadcrumb-sep" aria-hidden="true">›</span>
    </template>
  </nav>
</template>

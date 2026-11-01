import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Shared popover/dropdown behavior: renders the panel in <Teleport to="body">
 * (so the toolbar's overflow can't clip it) and positions it with `position:
 * fixed` below the trigger, matching the original portal-based menus.
 */
export function usePopover() {
  const open = ref(false)
  const triggerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)
  const style = ref<{ top: string; left: string }>({
    top: '0px',
    left: '0px',
  })

  function position() {
    const trigger = triggerRef.value
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    style.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    }
  }

  function toggle(next?: boolean) {
    open.value = next ?? !open.value
    if (open.value) nextTick(position)
  }

  function onMousedown(e: MouseEvent) {
    const t = e.target as Node
    if (triggerRef.value?.contains(t)) return
    if (panelRef.value?.contains(t)) return
    open.value = false
  }

  function onScrollOrResize() {
    if (open.value) position()
  }

  onMounted(() => {
    document.addEventListener('mousedown', onMousedown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onMousedown)
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
  })

  return { open, triggerRef, panelRef, style, toggle }
}

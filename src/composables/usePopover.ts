import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'

/**
 * Shared popover/dropdown behavior: renders the panel in <Teleport to="body">
 * (so the toolbar's overflow can't clip it) and positions it with `position:
 * fixed` relative to the trigger.
 *
 * 定位交给 floating-ui：默认从触发按钮下方展开，空间不足时自动翻到上方，
 * 水平方向自动平移，保证弹层整体留在窗口内（四周留 8px）。滚动、窗口缩放、
 * 面板自身尺寸变化都由 autoUpdate 跟随，不再手写 scroll/resize 监听。
 */
export function usePopover() {
  const open = ref(false)
  const triggerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)

  const position = ref({ top: '0px', left: '0px' })
  const flipped = ref(false)
  // 首次定位完成前先隐藏，避免弹层在窗口左上角闪一下
  const ready = ref(false)

  const style = computed(() => ({
    top: position.value.top,
    left: position.value.left,
    // 从按钮那一侧展开：翻到上方时改为从底部缩放
    transformOrigin: flipped.value ? 'bottom' : 'top',
    visibility: ready.value ? 'visible' : 'hidden',
  }))

  let stopAutoUpdate: (() => void) | null = null

  async function update() {
    const trigger = triggerRef.value
    const panel = panelRef.value
    if (!trigger || !panel) return
    const result = await computePosition(trigger, panel, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    })
    const el = panelRef.value
    if (!el) return
    flipped.value = result.placement.startsWith('top')
    position.value = { top: `${result.y}px`, left: `${result.x}px` }
    ready.value = true
  }

  function stopTracking() {
    stopAutoUpdate?.()
    stopAutoUpdate = null
  }

  async function startTracking() {
    stopTracking()
    ready.value = false
    await nextTick()
    const trigger = triggerRef.value
    const panel = panelRef.value
    if (!trigger || !panel) return
    stopAutoUpdate = autoUpdate(trigger, panel, update)
    await update()
  }

  function toggle(next?: boolean) {
    const target = next ?? !open.value
    open.value = target
    // 已经打开时再点一次入口（如重复点链接按钮）也要重新测量位置
    if (target) startTracking()
  }

  function onMousedown(e: MouseEvent) {
    const t = e.target as Node
    if (triggerRef.value?.contains(t)) return
    if (panelRef.value?.contains(t)) return
    open.value = false
  }

  // 任何途径关闭（点外部、选中菜单项、提交）都停止跟随
  watch(open, (value) => {
    if (!value) stopTracking()
  })

  onMounted(() => document.addEventListener('mousedown', onMousedown))
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onMousedown)
    stopTracking()
  })

  return { open, triggerRef, panelRef, style, toggle }
}

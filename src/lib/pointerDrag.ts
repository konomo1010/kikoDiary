import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

const DRAG_SCROLL_ZONE = 64
const DRAG_SCROLL_MAX_STEP = 20

function findScrollContainer(element: HTMLElement): HTMLElement {
  let current: HTMLElement | null = element
  while (current) {
    const { overflowY } = window.getComputedStyle(current)
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current
    }
    current = current.parentElement
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

/**
 * Vue 版块级拖拽：用指针事件驱动，而不是浏览器原生 drag-and-drop。
 *
 * 原生拖拽期间光标由 OS 接管（CSS cursor 失效、drop 在部分 WebView 里不可靠），
 * 所以我们在原生 dragstart 触发时取消它，再用 pointermove/pointerup 手工派发
 * 合成的 dragover/drop/dragend 事件给 ProseMirror。拖拽范围仍由
 * @tiptap/extension-drag-handle 的 dragstart 监听器计算（它设置 view.dragging）。
 *
 * @param editorRef  当前编辑器
 * @param anchorRef  渲染在可拖拽 `.block-handle-root` 内部的锚点元素（其 parentElement 即拖拽源）
 * @param nodePosRef 当前块位置（来自 onNodeChange），当扩展无法解析拖拽源时回退使用
 */
export function usePointerDrag(
  editorRef: Ref<Editor | null>,
  anchorRef: Ref<HTMLElement | null>,
  nodePosRef: Ref<number>
) {
  let unbind: (() => void) | null = null

  const bind = (editor: Editor | null, anchor: HTMLElement | null) => {
    unbind?.()
    unbind = null
    if (!editor || editor.isDestroyed || !anchor) return

    const handleElement = anchor.parentElement
    if (!handleElement) return

    const { view } = editor
    // 合成事件复用一个空的 DataTransfer：编辑器内部发起的拖拽不读它，
    // ProseMirror 用 view.dragging.slice 完成移动。
    const dataTransfer = new DataTransfer()

    let pointerId = -1
    let active = false
    let sawDragStart = false
    let lastX = 0
    let lastY = 0
    let grabOffsetX = 0
    let grabOffsetY = 0
    let insideEditor = false
    let preview: HTMLDivElement | null = null
    let cursorStyle: HTMLStyleElement | null = null
    let scrollContainer: HTMLElement | null = null
    let scrollTimer = 0

    const dispatchDragEvent = (
      type: string,
      target: EventTarget,
      x: number,
      y: number
    ) => {
      target.dispatchEvent(
        new DragEvent(type, {
          dataTransfer,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        })
      )
    }

    const isOverEditor = (x: number, y: number) => {
      const rect = view.dom.getBoundingClientRect()
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      )
    }

    const positionPreview = () => {
      if (preview) {
        preview.style.transform = `translate(${lastX - grabOffsetX}px, ${lastY - grabOffsetY}px)`
      }
    }

    const syncDropIndicator = () => {
      if (isOverEditor(lastX, lastY)) {
        insideEditor = true
        dispatchDragEvent('dragover', view.dom, lastX, lastY)
      } else if (insideEditor) {
        insideEditor = false
        dispatchDragEvent('dragleave', view.dom, lastX, lastY)
      }
    }

    const autoScroll = () => {
      if (!scrollContainer) return
      const isRoot = scrollContainer === document.scrollingElement
      const rect = isRoot ? null : scrollContainer.getBoundingClientRect()
      const top = rect ? rect.top : 0
      const bottom = rect ? rect.bottom : window.innerHeight
      let step = 0
      if (lastY < top + DRAG_SCROLL_ZONE) {
        step = -Math.min(
          DRAG_SCROLL_MAX_STEP,
          Math.ceil((top + DRAG_SCROLL_ZONE - lastY) / 4)
        )
      } else if (lastY > bottom - DRAG_SCROLL_ZONE) {
        step = Math.min(
          DRAG_SCROLL_MAX_STEP,
          Math.ceil((lastY - (bottom - DRAG_SCROLL_ZONE)) / 4)
        )
      }
      if (step !== 0) {
        scrollContainer.scrollTop += step
        syncDropIndicator()
      }
    }

    const buildPreview = () => {
      const dom = view.nodeDOM(view.state.selection.from)
      if (!(dom instanceof HTMLElement)) return
      const rect = dom.getBoundingClientRect()
      grabOffsetX = lastX - rect.left
      grabOffsetY = lastY - rect.top
      preview = document.createElement('div')
      preview.dataset.dragPreview = 'true'
      preview.setAttribute('aria-hidden', 'true')
      preview.className = view.dom.className
      Object.assign(preview.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: `${rect.width}px`,
        maxHeight: '40vh',
        overflow: 'hidden',
        margin: '0',
        padding: '0',
        background: 'transparent',
        opacity: '0.5',
        pointerEvents: 'none',
        zIndex: '1000',
        willChange: 'transform',
      })
      preview.appendChild(dom.cloneNode(true))
      preview.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
      document.body.appendChild(preview)
      positionPreview()
    }

    const suppressNextClick = () => {
      const block = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
      }
      window.addEventListener('click', block, { capture: true, once: true })
      window.setTimeout(
        () => window.removeEventListener('click', block, { capture: true }),
        150
      )
    }

    const teardown = () => {
      if (pointerId !== -1) {
        try {
          handleElement.releasePointerCapture(pointerId)
        } catch {
          // pointer already released
        }
      }
      active = false
      insideEditor = false
      pointerId = -1
      sawDragStart = false
      window.clearInterval(scrollTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      cursorStyle?.remove()
      cursorStyle = null
      preview?.remove()
      preview = null
      scrollContainer = null
    }

    const finishDrag = (x: number, y: number, drop: boolean) => {
      if (drop && isOverEditor(x, y)) {
        dispatchDragEvent('drop', view.dom, x, y)
      } else {
        dispatchDragEvent('dragend', view.dom, x, y)
        view.dragging = null
      }
      dispatchDragEvent('dragend', handleElement, x, y)
      teardown()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finishDrag(lastX, lastY, false)
      window.addEventListener('pointerup', () => suppressNextClick(), {
        capture: true,
        once: true,
      })
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      lastX = event.clientX
      lastY = event.clientY
      if (!active) return
      event.preventDefault()
      positionPreview()
      syncDropIndicator()
    }

    const abortGesture = (x: number, y: number) => {
      if (sawDragStart) {
        view.dragging = null
        dispatchDragEvent('dragend', handleElement, x, y)
      }
      teardown()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      if (active) {
        finishDrag(event.clientX, event.clientY, true)
        suppressNextClick()
      } else {
        abortGesture(event.clientX, event.clientY)
      }
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      if (active) finishDrag(event.clientX, event.clientY, false)
      else abortGesture(event.clientX, event.clientY)
    }

    const activate = () => {
      if (!view.dragging || active || pointerId === -1) return
      active = true
      cursorStyle = document.createElement('style')
      cursorStyle.textContent = '* { cursor: grabbing !important; }'
      document.head.appendChild(cursorStyle)
      buildPreview()
      scrollContainer = findScrollContainer(view.dom)
      scrollTimer = window.setInterval(autoScroll, 50)
      document.addEventListener('keydown', onKeyDown, true)
      try {
        handleElement.setPointerCapture(pointerId)
      } catch {
        // pointer no longer active — pointerup will tear down
      }
      syncDropIndicator()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return
      pointerId = event.pointerId
      lastX = event.clientX
      lastY = event.clientY
      // 清除上一次被取消的原生 dragstart 留下的脏状态
      view.dragging = null
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
    }

    // 冒泡阶段：扩展的 dragstart 监听器在目标元素上，先于此处运行并已设置
    // view.dragging。这里 preventDefault 取消原生会话，把光标留给我们的样式。
    const onNativeDragStart = (event: DragEvent) => {
      if (!event.isTrusted || pointerId === -1) return
      if (
        !(event.target instanceof Node) ||
        !handleElement.contains(event.target)
      ) {
        return
      }
      event.preventDefault()
      sawDragStart = true
      // 扩展没能解析出拖拽范围时，回退到拖拽手柄附着的块。
      if (!view.dragging) {
        const pos = nodePosRef.value
        const node = pos >= 0 ? view.state.doc.nodeAt(pos) : null
        if (node && NodeSelection.isSelectable(node)) {
          const selection = NodeSelection.create(view.state.doc, pos)
          view.dispatch(view.state.tr.setSelection(selection))
          view.dragging = { slice: selection.content(), move: true }
        }
      }
      activate()
    }

    // 编辑器内部发起的拖拽是「移动」，而非「复制」。
    const handleDragOver = (event: DragEvent) => {
      if (!view.dragging || !event.dataTransfer) return
      event.dataTransfer.dropEffect = view.dragging.move ? 'move' : 'copy'
    }
    view.dom.addEventListener('dragover', handleDragOver)

    handleElement.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('dragstart', onNativeDragStart)

    unbind = () => {
      view.dom.removeEventListener('dragover', handleDragOver)
      handleElement.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('dragstart', onNativeDragStart)
      teardown()
    }
  }

  watch([editorRef, anchorRef], ([e, a]) => bind(e, a), { flush: 'post' })
  onBeforeUnmount(() => {
    unbind?.()
    unbind = null
  })
}

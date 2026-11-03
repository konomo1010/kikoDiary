<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { blockHandleState } from '../lib/blockHandleState'
import { usePointerDrag } from '../lib/pointerDrag'
import {
  copyBlockAnchor,
  copyBlockText,
  deleteBlockAt,
  duplicateBlock,
  selectBlock,
  setBlockColor,
  setBlockHighlight,
  turnBlockInto,
  type TurnIntoValue,
} from '../lib/blockActions'
import { editorDark } from '../store'
import TiIcon from './ui/TiIcon.vue'

const editor = computed(() => blockHandleState.editor)
const pos = computed(() => blockHandleState.pos)
const visible = computed(() => pos.value >= 0)

const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const gripRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
// 菜单定位完成前先隐藏，避免出现在左上角闪一下
const menuReady = ref(false)

// 二级菜单
type SubKind = 'color' | 'turnInto'
const activeSub = ref<SubKind | null>(null)
const subRef = ref<HTMLElement | null>(null)
const subReady = ref(false)
const colorTriggerRef = ref<HTMLElement | null>(null)
const turnIntoTriggerRef = ref<HTMLElement | null>(null)

// 用指针事件驱动块拖拽，替代不可靠的原生 drag-and-drop
usePointerDrag(editor, rootRef, pos)

let stopMenuAutoUpdate: (() => void) | null = null
let stopSubAutoUpdate: (() => void) | null = null

function updateMenuPosition() {
  if (!gripRef.value || !menuRef.value) return
  computePosition(gripRef.value, menuRef.value, {
    placement: 'left-start',
    strategy: 'fixed',
    // 左侧空间不足时翻到右侧，并保证不超出视口
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    const el = menuRef.value
    if (!el) return
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    menuReady.value = true
  })
}

function startMenuPositioning() {
  stopMenuPositioning()
  if (!gripRef.value || !menuRef.value) return
  stopMenuAutoUpdate = autoUpdate(gripRef.value, menuRef.value, updateMenuPosition)
  updateMenuPosition()
}

function stopMenuPositioning() {
  stopMenuAutoUpdate?.()
  stopMenuAutoUpdate = null
  menuReady.value = false
}

function subTrigger(kind: SubKind) {
  return kind === 'color' ? colorTriggerRef.value : turnIntoTriggerRef.value
}

function updateSubPosition() {
  const kind = activeSub.value
  if (!kind) return
  const trigger = subTrigger(kind)
  if (!trigger || !subRef.value) return
  computePosition(trigger, subRef.value, {
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    const el = subRef.value
    if (!el) return
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    subReady.value = true
  })
}

function stopSubPositioning() {
  stopSubAutoUpdate?.()
  stopSubAutoUpdate = null
}

async function openSub(kind: SubKind) {
  if (activeSub.value === kind) return
  subReady.value = false
  activeSub.value = kind
  await nextTick()
  const trigger = subTrigger(kind)
  if (!trigger || !subRef.value) return
  stopSubPositioning()
  stopSubAutoUpdate = autoUpdate(trigger, subRef.value, updateSubPosition)
  updateSubPosition()
}

function closeSub() {
  activeSub.value = null
  subReady.value = false
  stopSubPositioning()
}

const turnIntoItems: { label: string; value: TurnIntoValue; icon: string }[] = [
  { label: 'Text', value: 'paragraph', icon: 'text' },
  { label: 'Heading 1', value: 'h1', icon: 'heading1' },
  { label: 'Heading 2', value: 'h2', icon: 'heading2' },
  { label: 'Heading 3', value: 'h3', icon: 'heading3' },
  { label: 'Bullet List', value: 'bulletList', icon: 'bullet-list' },
  { label: 'Numbered List', value: 'orderedList', icon: 'ordered-list' },
  { label: 'To-do list', value: 'taskList', icon: 'task-list' },
  { label: 'Blockquote', value: 'blockquote', icon: 'blockquote' },
  { label: 'Code Block', value: 'codeBlock', icon: 'code-block' },
]

const textColors: { label: string; value: string | null; swatch: string }[] = [
  { label: 'Default text', value: null, swatch: '#222325' },
  { label: 'Gray text', value: '#787673', swatch: '#787673' },
  { label: 'Brown text', value: '#9d6a53', swatch: '#9d6a53' },
  { label: 'Orange text', value: '#d9730d', swatch: '#d9730d' },
  { label: 'Yellow text', value: '#ca922f', swatch: '#ca922f' },
  { label: 'Green text', value: '#448361', swatch: '#448361' },
  { label: 'Blue text', value: '#327da9', swatch: '#327da9' },
  { label: 'Purple text', value: '#8f64af', swatch: '#8f64af' },
  { label: 'Pink text', value: '#c24c8b', swatch: '#c24c8b' },
  { label: 'Red text', value: '#d34a45', swatch: '#d34a45' },
]

const highlightColors: { label: string; value: string | null; swatch: string }[] = [
  { label: 'Default background', value: null, swatch: '#ffffff' },
  { label: 'Gray background', value: '#f8f8f7', swatch: '#f8f8f7' },
  { label: 'Brown background', value: '#f4eeee', swatch: '#f4eeee' },
  { label: 'Orange background', value: '#fbecdd', swatch: '#fbecdd' },
  { label: 'Yellow background', value: '#fef9c3', swatch: '#fef9c3' },
  { label: 'Green background', value: '#dcfce7', swatch: '#dcfce7' },
  { label: 'Blue background', value: '#e0f2fe', swatch: '#e0f2fe' },
  { label: 'Purple background', value: '#f3e8ff', swatch: '#f3e8ff' },
  { label: 'Pink background', value: '#fcf1f6', swatch: '#fcf1f6' },
  { label: 'Red background', value: '#ffe4e6', swatch: '#ffe4e6' },
]

const nodeNameLabel = computed(() => {
  const e = editor.value
  const p = pos.value
  if (!e || p < 0) return ''
  const n = e.state.doc.nodeAt(p)
  if (!n) return ''
  const map: Record<string, string> = {
    paragraph: 'Text',
    heading: 'Heading',
    bulletList: 'Bullet List',
    orderedList: 'Numbered List',
    taskList: 'To-do list',
    blockquote: 'Blockquote',
    codeBlock: 'Code Block',
    image: 'Image',
    table: 'Table',
    horizontalRule: 'Separator',
  }
  return map[n.type.name] ?? n.type.name
})

function currentNode() {
  const e = editor.value
  const p = pos.value
  if (!e || p < 0) return null
  return e.state.doc.nodeAt(p)
}

function insertBlock() {
  const e = editor.value
  const p = pos.value
  if (!e || p < 0) return
  const n = currentNode()
  if (!n) return
  menuOpen.value = false

  const isEmptyParagraph =
    n.type.name === 'paragraph' && n.content.size === 0
  if (isEmptyParagraph) {
    e.chain().focus().insertContentAt(p + 1, '/').run()
    return
  }

  e.chain()
    .focus()
    .insertContentAt(p + n.nodeSize, {
      type: 'paragraph',
      content: [{ type: 'text', text: '/' }],
    })
    .run()
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

/** 在小手上按下时先选中整块，让快捷键（ModD/ModC/Backspace）有作用对象 */
function onGripMousedown() {
  const p = pos.value
  if (p >= 0) selectBlock(editor.value, p)
}

function withBlock(fn: (pos: number) => void) {
  const p = pos.value
  if (p < 0) return
  fn(p)
  menuOpen.value = false
}

function onTurnInto(value: TurnIntoValue) {
  withBlock((p) => turnBlockInto(editor.value, p, value))
}

function onPickTextColor(color: string | null) {
  activeSub.value = null
  withBlock((p) => setBlockColor(editor.value, p, color))
}

function onPickHighlight(color: string | null) {
  activeSub.value = null
  withBlock((p) => setBlockHighlight(editor.value, p, color))
}

function onDuplicate() {
  withBlock((p) => duplicateBlock(editor.value, p))
}

function onCopyText() {
  withBlock((p) => {
    void copyBlockText(editor.value, p)
  })
}

function onCopyAnchor() {
  withBlock((p) => {
    void copyBlockAnchor(editor.value, p)
  })
}

function onDelete() {
  withBlock((p) => deleteBlockAt(editor.value, p))
}

watch(menuOpen, async (open) => {
  const e = editor.value
  if (e) {
    if (open) e.commands.lockDragHandle()
    else e.commands.unlockDragHandle()
    if (!open) e.commands.setMeta('hideDragHandle', true)
  }
  if (open) {
    await nextTick()
    startMenuPositioning()
  } else {
    closeSub()
    stopMenuPositioning()
  }
})

function onDocMousedown(e: MouseEvent) {
  const target = e.target as Node
  // 菜单用 fixed 定位后可能不在 rootRef 内，点菜单内部不应关闭
  if (menuRef.value?.contains(target)) return
  if (subRef.value?.contains(target)) return
  if (rootRef.value && !rootRef.value.contains(target)) {
    menuOpen.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  stopMenuPositioning()
  stopSubPositioning()
})
</script>

<template>
  <div v-if="visible" ref="rootRef" class="block-handle">
    <button
      type="button"
      class="block-handle-btn"
      title="Insert block"
      @click="insertBlock"
    >
      <TiIcon name="plus" class="block-handle-icon" />
    </button>
    <div
      ref="gripRef"
      class="block-handle-btn block-handle-grip"
      title="Click for options · hold to drag"
      draggable="true"
      @mousedown="onGripMousedown"
      @click="toggleMenu"
    >
      <TiIcon name="grip-vertical" class="block-handle-icon" />
    </div>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="menuRef"
        class="block-menu"
        :data-tt-theme="editorDark ? 'dark' : 'light'"
        :style="{ visibility: menuReady ? undefined : 'hidden' }"
      >
        <div v-if="nodeNameLabel" class="block-menu-title">{{ nodeNameLabel }}</div>

        <button
          ref="colorTriggerRef"
          type="button"
          class="block-menu-item block-menu-item-sub"
          @mouseenter="openSub('color')"
          @click="openSub('color')"
        >
          <TiIcon name="text-color" class="block-menu-icon" />
          <span class="block-menu-item-label">Color</span>
          <TiIcon name="chevron-right" class="block-menu-chevron" />
        </button>

        <button
          ref="turnIntoTriggerRef"
          type="button"
          class="block-menu-item block-menu-item-sub"
          @mouseenter="openSub('turnInto')"
          @click="openSub('turnInto')"
        >
          <TiIcon name="repeat" class="block-menu-icon" />
          <span class="block-menu-item-label">Turn Into</span>
          <TiIcon name="chevron-right" class="block-menu-chevron" />
        </button>

        <div class="block-menu-sep" />

        <button
          type="button"
          class="block-menu-item"
          @mouseenter="closeSub"
          @click="onDuplicate"
        >
          <TiIcon name="copy" class="block-menu-icon" />
          <span class="block-menu-item-label">Duplicate node</span>
          <span class="block-menu-kbd">ModD</span>
        </button>
        <button
          type="button"
          class="block-menu-item"
          @mouseenter="closeSub"
          @click="onCopyText"
        >
          <TiIcon name="clipboard" class="block-menu-icon" />
          <span class="block-menu-item-label">Copy to clipboard</span>
          <span class="block-menu-kbd">ModC</span>
        </button>
        <button
          type="button"
          class="block-menu-item"
          @mouseenter="closeSub"
          @click="onCopyAnchor"
        >
          <TiIcon name="link" class="block-menu-icon" />
          <span class="block-menu-item-label">Copy anchor link</span>
          <span class="block-menu-kbd">ModCtrlL</span>
        </button>

        <div class="block-menu-sep" />

        <button
          type="button"
          class="block-menu-item block-menu-danger"
          @mouseenter="closeSub"
          @click="onDelete"
        >
          <TiIcon name="trash" class="block-menu-icon" />
          <span class="block-menu-item-label">Delete</span>
          <span class="block-menu-kbd">Backspace</span>
        </button>
      </div>

      <div
        v-if="menuOpen && activeSub"
        ref="subRef"
        class="block-submenu"
        :data-tt-theme="editorDark ? 'dark' : 'light'"
        :style="{ visibility: subReady ? undefined : 'hidden' }"
      >
        <template v-if="activeSub === 'turnInto'">
          <div class="block-menu-sublabel">Turn into</div>
          <button
            v-for="item in turnIntoItems"
            :key="item.value"
            type="button"
            class="block-menu-item"
            @click="onTurnInto(item.value)"
          >
            <TiIcon :name="item.icon" class="block-menu-icon" />
            <span class="block-menu-item-label">{{ item.label }}</span>
          </button>
        </template>

        <template v-else>
          <div class="block-menu-sublabel">Text color</div>
          <button
            v-for="c in textColors"
            :key="c.label"
            type="button"
            class="block-menu-item"
            @click="onPickTextColor(c.value)"
          >
            <span class="block-color-text-icon" :style="{ color: c.swatch }">A</span>
            <span class="block-menu-item-label">{{ c.label }}</span>
          </button>

          <div class="block-menu-sep" />

          <div class="block-menu-sublabel">Background color</div>
          <button
            v-for="c in highlightColors"
            :key="c.label"
            type="button"
            class="block-menu-item"
            @click="onPickHighlight(c.value)"
          >
            <span class="block-color-dot" :style="{ background: c.swatch }" />
            <span class="block-menu-item-label">{{ c.label }}</span>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

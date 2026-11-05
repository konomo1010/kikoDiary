import { ref } from 'vue'

export type TocPosition = 'left' | 'right'

const STORAGE_KEY = 'tiptap-toc-position'

function readStored(): TocPosition {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'left' || v === 'right') return v
  } catch {
    /* ignore */
  }
  return 'left'
}

/** Where the table-of-contents sidebar sits. Defaults to the left. */
export const tocPosition = ref<TocPosition>(readStored())

/**
 * 当前文档是否真的有目录项。为空时布局不为一侧预留列宽，
 * 否则没有标题的日记正文会被推到左边。
 */
export const tocHasItems = ref(false)

/**
 * 正文区在多少宽度以上才显示目录。
 * 目录最少 132px + 正文 708px + 对侧 20px，正好 860。
 */
export const TOC_MIN_LAYOUT_WIDTH = 860

/**
 * 当前正文区是否放得下目录。由编辑器用 ResizeObserver 按「实际可用宽度」
 * 维护——不按视口宽度判断，这样高 DPI 笔记本全屏时也能正确显示。
 */
export const tocFits = ref(true)

export function toggleTocPosition() {
  tocPosition.value = tocPosition.value === 'left' ? 'right' : 'left'
  try {
    localStorage.setItem(STORAGE_KEY, tocPosition.value)
  } catch {
    /* ignore */
  }
}

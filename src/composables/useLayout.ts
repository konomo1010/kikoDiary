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

export function toggleTocPosition() {
  tocPosition.value = tocPosition.value === 'left' ? 'right' : 'left'
  try {
    localStorage.setItem(STORAGE_KEY, tocPosition.value)
  } catch {
    /* ignore */
  }
}

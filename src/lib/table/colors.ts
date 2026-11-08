import { shallowReactive } from 'vue'

export interface TableColorOption {
  label: string
  value: string | null
}

export interface RecentTableColor extends TableColorOption {
  type: 'text' | 'background'
}

/** 与 my-app 的 TEXT_COLORS 对齐（value 为 null 表示恢复默认）。 */
export const TABLE_TEXT_COLORS: TableColorOption[] = [
  { label: 'Default text', value: null },
  { label: 'Gray text', value: '#787673' },
  { label: 'Brown text', value: '#9d6a53' },
  { label: 'Orange text', value: '#d9730d' },
  { label: 'Yellow text', value: '#ca922f' },
  { label: 'Green text', value: '#448361' },
  { label: 'Blue text', value: '#327da9' },
  { label: 'Purple text', value: '#8f64af' },
  { label: 'Pink text', value: '#c24c8b' },
  { label: 'Red text', value: '#d34a45' },
]

/** 与 my-app 的 HIGHLIGHT_COLORS（单元格背景）对齐。 */
export const TABLE_BACKGROUND_COLORS: TableColorOption[] = [
  { label: 'Default background', value: null },
  { label: 'Gray background', value: '#f8f8f7' },
  { label: 'Brown background', value: '#f4eeee' },
  { label: 'Orange background', value: '#fbecdd' },
  { label: 'Yellow background', value: '#fef9c3' },
  { label: 'Green background', value: '#dcfce7' },
  { label: 'Blue background', value: '#e0f2fe' },
  { label: 'Purple background', value: '#f3e8ff' },
  { label: 'Pink background', value: '#fcf1f6' },
  { label: 'Red background', value: '#ffe4e6' },
]

export interface TableAlignItem {
  label: string
  icon: string
  type: 'text' | 'vertical'
  value: string
}

export const TABLE_ALIGN_ITEMS: TableAlignItem[] = [
  { label: 'Align left', icon: 'align-left', type: 'text', value: 'left' },
  { label: 'Align center', icon: 'align-center', type: 'text', value: 'center' },
  { label: 'Align right', icon: 'align-right', type: 'text', value: 'right' },
  { label: 'Align top', icon: 'align-top', type: 'vertical', value: 'top' },
  { label: 'Align middle', icon: 'align-middle', type: 'vertical', value: 'middle' },
  { label: 'Align bottom', icon: 'align-bottom', type: 'vertical', value: 'bottom' },
]

/** 最近使用的颜色（与 my-app 的 Recent colors 对应，跨会话保留）。 */
const RECENT_STORAGE_KEY = 'kiko.table.recentColors'

export const recentTableColors = shallowReactive<RecentTableColor[]>([])

try {
  const raw = localStorage.getItem(RECENT_STORAGE_KEY)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) recentTableColors.push(...parsed.slice(0, 5))
  }
} catch {
  /* ignore */
}

function persistRecent() {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentTableColors.slice(0, 5)))
  } catch {
    /* ignore */
  }
}

export function addRecentTableColor(color: RecentTableColor) {
  const index = recentTableColors.findIndex(
    (item) => item.type === color.type && item.label === color.label,
  )
  if (index >= 0) recentTableColors.splice(index, 1)
  recentTableColors.unshift(color)
  if (recentTableColors.length > 5) recentTableColors.length = 5
  persistRecent()
}

// 「无标签」不是真实写进日记的标签，而是一个系统保留的筛选项：
// 它代表「这篇日记没有任何标签」，永远存在、不可重命名、不可删除。

export const UNTAGGED_TAG = '无标签'

export function isUntaggedTag(name) {
  return name === UNTAGGED_TAG
}

/** 保证标签列表里「无标签」在首位且只有一份 */
export function withUntaggedTag(list) {
  const rest = (Array.isArray(list) ? list : []).filter((t) => t !== UNTAGGED_TAG)
  return [UNTAGGED_TAG, ...rest]
}

/**
 * 日记的 tags 数组是否匹配某个筛选项。
 * 选中系统「无标签」时，只有完全没有标签的日记算命中。
 */
export function tagsMatchFilter(tags, filter) {
  const list = Array.isArray(tags) ? tags : []
  return isUntaggedTag(filter) ? list.length === 0 : list.includes(filter)
}

/** 从日记里收集真实标签，按中文排序，并去掉误存的系统标签 */
export function collectRealTags(diaries) {
  const set = new Set()
  ;(Array.isArray(diaries) ? diaries : []).forEach((d) => {
    ;(Array.isArray(d && d.tags) ? d.tags : []).forEach((t) => {
      if (t && !isUntaggedTag(t)) set.add(t)
    })
  })
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/** 筛选面板用的完整列表：系统标签在首位 */
export function tagListWithUntagged(diaries) {
  return [UNTAGGED_TAG, ...collectRealTags(diaries)]
}

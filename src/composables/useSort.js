import { ref } from 'vue'

/**
 * 共享的排序方向。日记页的排序选择由它驱动，首页的同一天列表也跟随，
 * 避免两个页面出现不同的顺序。
 */
export const sortBy = ref('time-desc')

/**
 * 日记排序：先按日期，再按创建时间戳（dirName）。
 * @param {Array} arr 日记元数据数组
 * @param {boolean} [asc] true 升序；默认跟随共享的 sortBy
 */
export function sortDiaries(arr, asc = sortBy.value === 'time-asc') {
  return [...arr].sort((x, y) => {
    if (x.date !== y.date) {
      const d = x.date < y.date ? -1 : 1
      return asc ? d : -d
    }
    // 同一天再按创建时间戳排序
    const t = (Number(x.dirName) || 0) - (Number(y.dirName) || 0)
    return asc ? t : -t
  })
}

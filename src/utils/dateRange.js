// 日记的 `date` 字段统一是 `YYYY-MM-DD`（无时间、无时区），
// 所以区间判断直接用字符串比较：既精确，也不会被时区偏移带偏。

/** 取出日期字段里的日部分，容忍意外的长时间格式 */
export function dayOf(date) {
  return String(date == null ? '' : date).slice(0, 10)
}

/** 某篇日记是否落在 [from, to] 区间内；两端都可为空表示不限 */
export function inDateRange(date, from, to) {
  const day = dayOf(date)
  if (!day) return false
  if (from && day < dayOf(from)) return false
  if (to && day > dayOf(to)) return false
  return true
}

/** 起止填反了自动交换，避免用户空列表困惑 */
export function normalizeRange(from, to) {
  const f = dayOf(from)
  const t = dayOf(to)
  if (f && t && f > t) return { from: t, to: f }
  return { from: f, to: t }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function ymd(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function daysInMonth(y, m) {
  // Date 的月份从 0 开始：new Date(y, m, 0) 即第 m 个月的最后一天
  return new Date(y, m, 0).getDate()
}

function localDateStr(d) {
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/**
 * 常用区间预置。today 可注入，便于测试。
 * key: this-month | last-month | last-30 | this-year | last-year | all
 */
export function presetRange(key, today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const day = today.getDate()

  switch (key) {
    case 'this-month':
      return { from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)) }
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y
      const lm = m === 1 ? 12 : m - 1
      return { from: ymd(ly, lm, 1), to: ymd(ly, lm, daysInMonth(ly, lm)) }
    }
    case 'last-30': {
      const start = new Date(y, m - 1, day - 29)
      return { from: localDateStr(start), to: ymd(y, m, day) }
    }
    case 'this-year':
      return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) }
    case 'last-year':
      return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) }
    default:
      return { from: '', to: '' }
  }
}

/** 完整范围文案，用于筛选摘要 */
export function rangeLabel(from, to) {
  const f = dayOf(from)
  const t = dayOf(to)
  if (f && t) return f === t ? f : `${f} 至 ${t}`
  if (f) return `${f} 之后`
  if (t) return `${t} 之前`
  return '全部时间'
}

/** 工具栏按钮上的紧凑文案：同年只显示月-日 */
export function shortRangeLabel(from, to) {
  const f = dayOf(from)
  const t = dayOf(to)
  if (f && t) {
    if (f === t) return f
    if (f.slice(0, 4) === t.slice(0, 4)) return `${f.slice(5)} ~ ${t.slice(5)}`
    return `${f.slice(5)} ~ ${t}`
  }
  if (f) return `${f.slice(5)} 之后`
  if (t) return `${t.slice(5)} 之前`
  return ''
}

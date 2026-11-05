import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dayOf,
  inDateRange,
  normalizeRange,
  presetRange,
  rangeLabel,
  shortRangeLabel,
} from '../src/utils/dateRange.js'

const TODAY = new Date(2026, 10, 5) // 2026-11-05（本地时间）

test('dayOf 只取日期部分', () => {
  assert.equal(dayOf('2026-11-05'), '2026-11-05')
  assert.equal(dayOf('2026-11-05T09:30:00'), '2026-11-05')
  assert.equal(dayOf(null), '')
})

test('inDateRange 闭区间，两端可省略', () => {
  assert.equal(inDateRange('2026-05-01', '2026-05-01', '2026-06-30'), true)
  assert.equal(inDateRange('2026-06-30', '2026-05-01', '2026-06-30'), true)
  assert.equal(inDateRange('2026-07-01', '2026-05-01', '2026-06-30'), false)
  assert.equal(inDateRange('2026-04-30', '2026-05-01', '2026-06-30'), false)
  assert.equal(inDateRange('2026-05-20', '2026-05-01', ''), true)
  assert.equal(inDateRange('2026-04-20', '2026-05-01', ''), false)
  assert.equal(inDateRange('2026-05-20', '', ''), true)
  assert.equal(inDateRange('', '2026-05-01', ''), false)
})

test('normalizeRange 起止填反时自动交换', () => {
  assert.deepEqual(normalizeRange('2026-06-30', '2026-05-01'), {
    from: '2026-05-01',
    to: '2026-06-30',
  })
  assert.deepEqual(normalizeRange('2026-05-01', '2026-06-30'), {
    from: '2026-05-01',
    to: '2026-06-30',
  })
  assert.deepEqual(normalizeRange('', ''), { from: '', to: '' })
})

test('presetRange 本月 / 上月 / 今年', () => {
  assert.deepEqual(presetRange('this-month', TODAY), {
    from: '2026-11-01',
    to: '2026-11-30',
  })
  assert.deepEqual(presetRange('last-month', TODAY), {
    from: '2026-10-01',
    to: '2026-10-31',
  })
  assert.deepEqual(presetRange('this-year', TODAY), {
    from: '2026-01-01',
    to: '2026-12-31',
  })
  assert.deepEqual(presetRange('last-year', TODAY), {
    from: '2025-01-01',
    to: '2025-12-31',
  })
})

test('presetRange 近 30 天跨月也正确', () => {
  assert.deepEqual(presetRange('last-30', TODAY), {
    from: '2026-10-07',
    to: '2026-11-05',
  })
  // 1 月初回溯到上一年
  assert.deepEqual(presetRange('last-30', new Date(2026, 0, 3)), {
    from: '2025-12-05',
    to: '2026-01-03',
  })
})

test('presetRange 一月的上月是上一年十二月', () => {
  assert.deepEqual(presetRange('last-month', new Date(2026, 0, 15)), {
    from: '2025-12-01',
    to: '2025-12-31',
  })
})

test('rangeLabel / shortRangeLabel 文案', () => {
  assert.equal(rangeLabel('2026-05-01', '2026-06-30'), '2026-05-01 至 2026-06-30')
  assert.equal(rangeLabel('2026-05-01', ''), '2026-05-01 之后')
  assert.equal(rangeLabel('', '2026-06-30'), '2026-06-30 之前')
  assert.equal(rangeLabel('', ''), '全部时间')
  assert.equal(shortRangeLabel('2026-05-01', '2026-06-30'), '05-01 ~ 06-30')
  assert.equal(shortRangeLabel('2026-12-01', '2027-01-31'), '12-01 ~ 2027-01-31')
  assert.equal(shortRangeLabel('2026-05-01', '2026-05-01'), '2026-05-01')
})

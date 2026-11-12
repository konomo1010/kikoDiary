import assert from 'node:assert/strict'
import test from 'node:test'
import { VIEW_LABELS, buildTrail, diaryLabel, editorLabel } from '../src/utils/nav.js'

test('diaryLabel 反映筛选上下文', () => {
  assert.equal(diaryLabel(null), '日记')
  assert.equal(diaryLabel({ tags: [], from: '', to: '' }), '日记')
  assert.equal(diaryLabel({ tags: ['旅行'] }), '标签：旅行')
  assert.equal(diaryLabel({ tags: ['旅行', '工作'] }), '标签：旅行 等 2 个')
  assert.equal(diaryLabel({ tags: [], from: '2026-05-01', to: '' }), '日记 · 按日期')
  // 有标签时优先显示标签
  assert.equal(diaryLabel({ tags: ['旅行'], from: '2026-05-01' }), '标签：旅行')
})

test('editorLabel 用标题，超长截断，无标题时回退', () => {
  assert.equal(editorLabel(null, []), '新建日记')
  assert.equal(editorLabel(7, [{ id: 7, title: '' }]), '编辑日记')
  assert.equal(editorLabel(7, []), '编辑日记')
  assert.equal(editorLabel(7, [{ id: 7, title: '今天的天气' }]), '编辑：今天的天气')
  const long = '一'.repeat(20)
  assert.equal(editorLabel(8, [{ id: 8, title: long }]), '编辑：' + '一'.repeat(16) + '…')
})

test('首页面包屑只显示「首页」；空位置返回空数组', () => {
  assert.deepEqual(buildTrail({ view: 'home' }).map((c) => c.label), ['首页'])
  assert.deepEqual(buildTrail(null), [])
})

test('日记页：首页 › 日记（含筛选标签）', () => {
  const trail = buildTrail({ view: 'diary', diaryFilter: { tags: ['旅行'], from: '', to: '' } })
  assert.equal(trail.length, 2)
  assert.deepEqual(trail.map((c) => c.label), ['首页', '标签：旅行'])
  assert.deepEqual(trail.map((c) => c.view), ['home', 'diary'])
})

test('编辑页：从首页进 → 首页 › 编辑；从列表进 → 首页 › 日记 › 编辑', () => {
  const fromHome = buildTrail({ view: 'editor', editingId: null, editorOrigin: { view: 'home' }, diaries: [] })
  assert.deepEqual(fromHome.map((c) => c.label), ['首页', '新建日记'])

  const fromList = buildTrail({
    view: 'editor',
    editingId: 3,
    editorOrigin: { view: 'diary' },
    diaryFilter: { tags: ['工作'], from: '', to: '' },
    diaries: [{ id: 3, title: '周报' }],
  })
  assert.deepEqual(fromList.map((c) => c.label), ['首页', '标签：工作', '编辑：周报'])
  assert.deepEqual(fromList.map((c) => c.view), ['home', 'diary', 'editor'])
})

test('标签页 / 设置页只有两层', () => {
  assert.deepEqual(buildTrail({ view: 'tags' }).map((c) => c.label), ['首页', VIEW_LABELS.tags])
  assert.deepEqual(buildTrail({ view: 'settings' }).map((c) => c.label), ['首页', VIEW_LABELS.settings])
})

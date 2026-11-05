import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UNTAGGED_TAG,
  collectRealTags,
  isUntaggedTag,
  tagListWithUntagged,
  tagsMatchFilter,
  withUntaggedTag,
} from '../src/utils/tags.js'

test('isUntaggedTag 只认系统标签名', () => {
  assert.equal(isUntaggedTag('无标签'), true)
  assert.equal(isUntaggedTag('旅行'), false)
  assert.equal(isUntaggedTag(''), false)
  assert.equal(isUntaggedTag(null), false)
})

test('withUntaggedTag 置顶且去重，兼容空/非数组', () => {
  assert.deepEqual(withUntaggedTag(['旅行', '工作']), ['无标签', '旅行', '工作'])
  assert.deepEqual(withUntaggedTag(['旅行', '无标签', '工作']), ['无标签', '旅行', '工作'])
  assert.deepEqual(withUntaggedTag(['无标签', '无标签']), ['无标签'])
  assert.deepEqual(withUntaggedTag([]), ['无标签'])
  assert.deepEqual(withUntaggedTag(undefined), ['无标签'])
})

test('tagsMatchFilter：无标签只命中空 tags', () => {
  assert.equal(tagsMatchFilter([], UNTAGGED_TAG), true)
  assert.equal(tagsMatchFilter(['旅行'], UNTAGGED_TAG), false)
  assert.equal(tagsMatchFilter(undefined, UNTAGGED_TAG), true)
  assert.equal(tagsMatchFilter(['旅行', '工作'], '旅行'), true)
  assert.equal(tagsMatchFilter(['工作'], '旅行'), false)
  assert.equal(tagsMatchFilter(undefined, '旅行'), false)
})

test('collectRealTags 过滤系统标签并按中文排序', () => {
  const diaries = [
    { tags: ['旅行', '工作'] },
    { tags: ['无标签'] },
    { tags: [] },
    { tags: ['旅行', '爱好'] },
    {},
  ]
  assert.deepEqual(collectRealTags(diaries), ['爱好', '工作', '旅行'])
})

test('tagListWithUntagged 系统标签固定在首位', () => {
  const list = tagListWithUntagged([{ tags: ['z'] }, { tags: ['a'] }])
  assert.equal(list[0], UNTAGGED_TAG)
  assert.deepEqual(list.slice(1), ['a', 'z'])
  assert.deepEqual(tagListWithUntagged([]), [UNTAGGED_TAG])
})

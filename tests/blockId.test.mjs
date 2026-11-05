import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { history, undo } from '@tiptap/pm/history'
import { EditorState } from '@tiptap/pm/state'
import { BlockId } from '../src/lib/blockId.ts'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      attrs: { id: { default: null } },
    },
    text: {},
  },
})

function blockIdPlugin() {
  const addPlugins = BlockId.config.addProseMirrorPlugins
  if (!addPlugins) throw new Error('BlockId plugin is not configured')
  return addPlugins()[0]
}

function stateWithChineseText() {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('中文')]),
    ]),
    plugins: [blockIdPlugin()],
  })
}

test('does not rewrite block markup during IME composition', () => {
  const state = stateWithChineseText()
  const transaction = state.tr.insertText('。', 3).setMeta('composition', 1)
  const next = state.apply(transaction)

  assert.equal(next.doc.textContent, '中文。')
  assert.equal(next.doc.firstChild?.attrs.id, null)
})

test('assigns a block id after a normal document change', () => {
  const state = stateWithChineseText()
  const next = state.apply(state.tr.insertText('。', 3))

  assert.equal(next.doc.textContent, '中文。')
  assert.match(next.doc.firstChild?.attrs.id ?? '', /^[a-z0-9]{8}$/)
})

test('programmatic content load does not create an undo step', () => {
  const initial = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph')]),
    plugins: [blockIdPlugin(), history()],
  })
  const paragraph = schema.node('paragraph', null, [schema.text('整篇日记')])
  const transaction = initial.tr
    .replaceWith(0, initial.doc.content.size, [paragraph])
    .setMeta('addToHistory', false)
  const loaded = initial.apply(transaction)

  assert.equal(loaded.doc.textContent, '整篇日记')
  assert.equal(
    undo(loaded, () => {
      throw new Error('Initial content load must not be undoable')
    }),
    false
  )

  const changed = loaded.apply(loaded.tr.insertText('！', 5))
  let reverted
  assert.equal(
    undo(changed, (tr) => {
      reverted = changed.apply(tr)
    }),
    true
  )
  assert.equal(reverted.doc.textContent, '整篇日记')
})

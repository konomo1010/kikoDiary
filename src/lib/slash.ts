import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { createApp, reactive } from 'vue'
import type { App } from 'vue'
import SlashMenu from '../components/SlashMenu.vue'
import { pickAndInsertImage } from './editor'

interface RangeLike {
  from: number
  to: number
}

export interface SlashItem {
  title: string
  description: string
  keywords: string[]
  icon: string
  group: string
  command: (props: { editor: Editor; range: RangeLike }) => void
}

/**
 * Slash 菜单项，按 my-app notion-like 模板分组：
 * Style（文本块类型）/ Insert（插入元素）/ Upload（上传）
 */
export const slashItems: SlashItem[] = [
  // ---- Style ----
  {
    title: 'Text',
    description: 'Regular text paragraph',
    keywords: ['p', 'paragraph', 'text'],
    icon: 'text',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    },
  },
  {
    title: 'Heading 1',
    description: 'Top-level heading',
    keywords: ['h1', 'heading1', 'h', 'heading'],
    icon: 'heading1',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    },
  },
  {
    title: 'Heading 2',
    description: 'Key section heading',
    keywords: ['h2', 'heading2', 'subheading'],
    icon: 'heading2',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    },
  },
  {
    title: 'Heading 3',
    description: 'Subsection and group heading',
    keywords: ['h3', 'heading3', 'subheading'],
    icon: 'heading3',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    },
  },
  {
    title: 'Bullet List',
    description: 'List with unordered items',
    keywords: ['ul', 'li', 'list', 'bullet', 'bulletlist'],
    icon: 'bullet-list',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    title: 'Numbered List',
    description: 'List with ordered items',
    keywords: ['ol', 'list', 'numbered', 'numberedlist'],
    icon: 'ordered-list',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    title: 'To-do list',
    description: 'List with tasks',
    keywords: ['task', 'todo', 'checklist', 'tasklist'],
    icon: 'task-list',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    title: 'Blockquote',
    description: 'Blockquote block',
    keywords: ['quote', 'blockquote'],
    icon: 'blockquote',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    title: 'Code Block',
    description: 'Code block with syntax highlighting',
    keywords: ['code', 'pre'],
    icon: 'code-block',
    group: 'Style',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },

  // ---- Insert ----
  {
    title: 'Table',
    description: 'Insert a 3×3 table',
    keywords: ['table', 'grid', 'inserttable'],
    icon: 'table',
    group: 'Insert',
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
        .run()
    },
  },
  {
    title: 'Separator',
    description: 'Horizontal line to separate content',
    keywords: ['hr', 'line', 'separator', 'divider', 'horizontalrule'],
    icon: 'minus',
    group: 'Insert',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
  {
    title: 'Emoji',
    description: 'Insert an emoji',
    keywords: ['emoji', 'emoticon', 'smiley'],
    icon: 'emoji',
    group: 'Insert',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      // 触发全局 emoji picker（由 NotionLikeEditor 挂载）
      window.dispatchEvent(new CustomEvent('kiko:open-emoji-picker'))
    },
  },

  // ---- Upload ----
  {
    title: 'Image',
    description: 'Upload an image',
    keywords: ['image', 'img', 'picture', 'upload', 'media'],
    icon: 'image',
    group: 'Upload',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      pickAndInsertImage(editor)
    },
  },
]

/** Reactive bridge shared between the Suggestion render callbacks and SlashMenu.vue. */
export const slashState = reactive<{
  items: SlashItem[]
  command: ((item: SlashItem) => void) | null
  selectedIndex: number
}>({
  items: [],
  command: null,
  selectedIndex: 0,
})

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowSpaces: false,

        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },

        items: ({ query }) => {
          const q = query.trim().toLowerCase()
          return slashItems.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              item.keywords.some((k) => k.includes(q))
          )
        },

        render: () => {
          let app: App | null = null
          let el: HTMLDivElement | null = null
          let unmount: (() => void) | null = null

          return {
            onStart(props) {
              slashState.items = props.items as SlashItem[]
              slashState.command = props.command as (item: SlashItem) => void
              slashState.selectedIndex = 0

              el = document.createElement('div')
              el.className = 'slash-menu-portal'
              app = createApp(SlashMenu)
              app.mount(el)
              unmount = props.mount(el)
            },
            onUpdate(props) {
              slashState.items = props.items as SlashItem[]
              slashState.selectedIndex = 0
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') {
                return false
              }
              if (event.key === 'ArrowDown') {
                slashState.selectedIndex = Math.min(
                  slashState.selectedIndex + 1,
                  slashState.items.length - 1
                )
                return true
              }
              if (event.key === 'ArrowUp') {
                slashState.selectedIndex = Math.max(
                  slashState.selectedIndex - 1,
                  0
                )
                return true
              }
              if (event.key === 'Enter') {
                const item = slashState.items[slashState.selectedIndex]
                if (item) slashState.command?.(item)
                return true
              }
              return false
            },
            onExit() {
              unmount?.()
              app?.unmount()
              app = null
              el = null
              unmount = null
            },
          }
        },
      }),
    ]
  },
})

export default SlashCommands

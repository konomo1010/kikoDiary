import type { Editor, JSONContent } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { Image } from './image'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Typography } from '@tiptap/extension-typography'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { SlashCommands } from './slash'
import { Indent } from './indent'
import { BlockHandleExtension } from './blockHandle'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'

const lowlight = createLowlight(common)

export const MAX_FILE_SIZE = 5 * 1024 * 1024

/** Extensions that reproduce the Notion-like editor (no collaboration / AI). */
export function createEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    Typography,
    Image.configure({ inline: false, allowBase64: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Indent.configure({ useStyle: true, indentUnit: 24 }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') {
          return 'Heading'
        }
        return "Write, type '/' for commands…"
      },
    }),
    SlashCommands,
    BlockHandleExtension,
  ]
}

/**
 * Inserts image files (pasted screenshots / dropped files) as `image` nodes
 * using local object URLs for instant display.
 */
export function insertImageFiles(
  editor: Editor | null,
  files: FileList | File[] | null | undefined
): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false

  const imageFiles = Array.from(files ?? []).filter((f) =>
    f.type.startsWith('image/')
  )
  if (imageFiles.length === 0) return false

  const content: JSONContent[] = []
  for (const file of imageFiles) {
    if (file.size > MAX_FILE_SIZE) {
      console.warn(
        `Skipping "${file.name}": exceeds the ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`
      )
      continue
    }
    const url = URL.createObjectURL(file)
    const name = file.name.replace(/\.[^/.]+$/, '') || 'image'
    content.push({
      type: 'image',
      attrs: { src: url, alt: name, title: name },
    })
  }

  if (content.length === 0) return false

  // 图片后追加一个空段落，光标落在段落里，避免进入 caption 导致后续粘贴/回车异常
  const nodes = [...content, { type: 'paragraph' }]
  editor.chain().focus().insertContent(nodes).run()
  return true
}

/** Opens a file picker and inserts the chosen images. */
export function pickAndInsertImage(editor: Editor | null): void {
  if (!editor) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.style.display = 'none'
  input.onchange = () => {
    if (input.files) insertImageFiles(editor, input.files)
    input.remove()
  }
  document.body.appendChild(input)
  input.click()
}

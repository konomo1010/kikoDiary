import { Image as TiptapImage } from '@tiptap/extension-image'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageNodeView from '../components/ImageNodeView.vue'

function num(value: string | null): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Notion-style image node: block image with resize handles, alignment and an
 * editable caption. Mirrors the my-app image node.
 */
export const Image = TiptapImage.extend({
  content: 'inline*',
  isolating: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => num(el.getAttribute('width')),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.width ? { width: attrs.width } : {},
      },
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => num(el.getAttribute('height')),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.height ? { height: attrs.height } : {},
      },
      'data-align': {
        default: 'center',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || 'center',
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-align': attrs['data-align'] || 'center',
        }),
      },
      showCaption: {
        default: false,
        parseHTML: (el: HTMLElement) =>
          el.tagName === 'FIGURE' || el.getAttribute('data-show-caption') === 'true',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.showCaption ? { 'data-show-caption': 'true' } : {},
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        contentElement: (el: HTMLElement) =>
          el.querySelector('figcaption') ?? undefined,
        getAttrs: (el: HTMLElement) => {
          const img = el.querySelector('img')
          if (!img) return false
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt'),
            title: img.getAttribute('title'),
            width: num(img.getAttribute('width')),
            height: num(img.getAttribute('height')),
            'data-align': el.getAttribute('data-align') || 'center',
            showCaption: true,
          }
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (el: HTMLElement) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
          title: el.getAttribute('title'),
          width: num(el.getAttribute('width')),
          height: num(el.getAttribute('height')),
          'data-align': el.getAttribute('data-align') || 'center',
          showCaption: false,
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const align = node.attrs['data-align'] || 'center'
    const showCaption = node.attrs.showCaption
    const imgAttrs: Record<string, unknown> = { ...HTMLAttributes }
    delete imgAttrs['data-align']

    if (showCaption || node.content.size > 0) {
      return [
        'figure',
        {
          'data-align': align,
          ...(showCaption ? { 'data-show-caption': 'true' } : {}),
        },
        ['img', imgAttrs],
        ['figcaption', {}, 0],
      ]
    }
    imgAttrs['data-align'] = align
    return ['img', imgAttrs]
  },

  addNodeView() {
    return VueNodeViewRenderer(ImageNodeView)
  },
})

export default Image

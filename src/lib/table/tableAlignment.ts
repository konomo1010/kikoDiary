import { Extension } from '@tiptap/core'

/**
 * 给 tableCell / tableHeader 增加水平与垂直对齐属性（对齐 my-app 的 NodeAlignment）。
 */
export const TableAlignment = Extension.create({
  name: 'tableAlignment',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-text-align'),
            renderHTML: (attributes) => {
              if (!attributes.textAlign) return {}
              return {
                'data-node-text-align': attributes.textAlign,
                style: `text-align: ${attributes.textAlign}`,
              }
            },
          },
          verticalAlign: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-vertical-align'),
            renderHTML: (attributes) => {
              if (!attributes.verticalAlign) return {}
              return {
                'data-node-vertical-align': attributes.verticalAlign,
                style: `vertical-align: ${attributes.verticalAlign}`,
              }
            },
          },
          backgroundColor: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-background-color') ||
              (element as HTMLElement).style.backgroundColor ||
              null,
            renderHTML: (attributes) => {
              if (!attributes.backgroundColor) return {}
              return {
                'data-background-color': attributes.backgroundColor,
                style: `background-color: ${attributes.backgroundColor}`,
              }
            },
          },
        },
      },
    ]
  },
})

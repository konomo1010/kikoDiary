export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

export const todayStr = () => {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

export const toDateStr = (d) => {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

export const weekdayOf = (dateStr) => WEEKDAYS[new Date(dateStr + "T00:00:00").getDay()]

export const fmtDate = (dateStr) => `${dateStr} · ${weekdayOf(dateStr)}`

/* ================= Tiptap JSON helpers ================= */

// A Tiptap/ProseMirror document is `{ type: "doc", content: [...] }`.
// Every text node carries a `text` field; nodes may nest via `content`.
export function docToText(doc) {
  if (!doc) return ""
  if (typeof doc === "string") return doc
  const parts = []
  const walk = (node) => {
    if (!node || typeof node !== "object") return
    if (typeof node.text === "string") { parts.push(node.text); return }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc)
  return parts.join("\n")
}

// Convert legacy plain-text content (paragraphs separated by blank lines)
// into a minimal Tiptap JSON document.
export function textToDoc(text) {
  const s = String(text == null ? "" : text).replace(/\r\n?/g, "\n")
  const paragraphs = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (!paragraphs.length) return { type: "doc", content: [{ type: "paragraph" }] }
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").map((line) => ({ type: "text", text: line }))
    }))
  }
}

// Ensure a stored value is a Tiptap JSON doc (migrates legacy strings).
export function normalizeContent(content) {
  if (content && typeof content === "object" && content.type === "doc") return content
  if (typeof content === "string") return textToDoc(content)
  return { type: "doc", content: [{ type: "paragraph" }] }
}

export const countWords = (s) => docToText(s).replace(/\s/g, "").length

export const greeting = () => {
  const h = new Date().getHours()
  if (h < 6) return "夜深了"
  if (h < 11) return "早上好"
  if (h < 14) return "中午好"
  if (h < 18) return "下午好"
  return "晚上好"
}
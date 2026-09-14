import type { CSSProperties } from 'react'

export interface TagGroupColors {
  background: string
  border: string
  text: string
}

export function tagGroupColors(groupName: string): TagGroupColors {
  const normalized = groupName.trim().toLowerCase() || 'general'
  if (normalized === 'general') return { background: '#f2f1ec', border: '#c7cbc4', text: '#59645e' }
  let hash = 2166136261
  for (const character of normalized) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const hue = (hash >>> 0) % 360
  return {
    background: `hsl(${hue}, 34%, 93%)`,
    border: `hsl(${hue}, 25%, 73%)`,
    text: `hsl(${hue}, 31%, 34%)`,
  }
}

export function tagGroupStyle(groupName: string): CSSProperties {
  const colors = tagGroupColors(groupName)
  return {
    '--tag-background': colors.background,
    '--tag-border': colors.border,
    '--tag-text': colors.text,
  } as CSSProperties
}

export function tagColors(tagName: string, groupName: string): TagGroupColors {
  return tagGroupColors(groupName.trim() || `tag:${tagName}`)
}

export function tagStyle(tagName: string, groupName: string): CSSProperties {
  const colors = tagColors(tagName, groupName)
  return {
    '--tag-background': colors.background,
    '--tag-border': colors.border,
    '--tag-text': colors.text,
  } as CSSProperties
}

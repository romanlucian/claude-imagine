/** One generated picture: where Codex saved it, and whether it was added to the project. */
export type ImagineImage = {
  id: string
  /** Absolute path of the mod's copy in `~/Pictures/Imagine` (Codex's own file when the copy failed). */
  path: string
  name: string
  prompt: string
  createdAt: number
  isSelected: boolean
  /** The project-relative path it was copied to, once added. */
  addedTo?: string
  /** The Codex run that drew it: Edit continues that conversation. */
  threadId?: string
}

/** One `/imagine` request while it runs, and how it ended. */
export type ImagineJob = {
  id: string
  prompt: string
  count: number
  status: 'running' | 'done' | 'failed'
  message: string
  startedAt: number
}

/** Whether Codex is installed and logged in with ChatGPT; the link and code while logging in. */
export type ImagineLogin = {
  status: 'unknown' | 'no-codex' | 'logged-out' | 'logging-in' | 'logged-in'
  detail: string
  url?: string
  code?: string
}

declare module 'claude-code' {
  interface PluginState {
    imagine: {
      images: ImagineImage[]
      jobs: ImagineJob[]
      login: ImagineLogin
      dest: string
      lastAdded: string[]
      /** Draw thumbnails (kitty and Ghostty terminals only). */
      previews: boolean
      /** The image whose Edit box is open, or empty. */
      editing: string
      /** What is typed in the Edit box and the describe box, shown wrapped above them. */
      editDraft: string
      promptDraft: string
    }
  }
}

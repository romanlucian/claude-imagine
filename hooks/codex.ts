// Pure helpers for talking to OpenAI's Codex CLI: what to send it, and how
// to read what it prints. No `$` here, so the tests can call them directly.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i

export const MAX_IMAGES = 4

export const stripAnsi = (text: string): string => text.replace(ANSI, '')

export const isImageFile = (path: string): boolean => IMAGE_FILE.test(path)

/**
 * Splits what the person typed into how many images and the description:
 * `3x a red fox logo` (or `x3 ...`) asks for three; anything else for one.
 */
export function parseRequest(text: string): { count: number; prompt: string } {
  const trimmed = text.trim()
  const match = trimmed.match(/^(?:(\d+)x|x(\d+))\s+([\s\S]+)$/i)
  if (match === null) return { count: 1, prompt: trimmed }
  const count = Number(match[1] ?? match[2])
  return { count: Math.min(Math.max(count, 1), MAX_IMAGES), prompt: (match[3] ?? '').trim() }
}

/** The instructions `codex exec` gets: use its built-in image tool, touch nothing else. */
export function codexPrompt(prompt: string, count: number): string {
  const what =
    count === 1
      ? 'one image'
      : `${count} different variations, one separate image_gen call for each,`
  return [
    `Use $imagegen to generate ${what} of: ${prompt}`,
    '',
    'This is for preview only: leave the generated files where image_gen saves them.',
    'Do not copy, move or edit any files, and do not run shell commands.',
  ].join('\n')
}

/** What a resumed `codex exec` gets: change the image it made last, in the same conversation. */
export function editPrompt(change: string): string {
  return [
    `Use $imagegen to make a new version of the last image you generated, with this change: ${change}`,
    'Keep everything else about it the same.',
    '',
    'This is for preview only: leave the generated files where image_gen saves them.',
    'Do not copy, move or edit any files, and do not run shell commands.',
  ].join('\n')
}

/**
 * Where Codex saves one run's images: `$CODEX_HOME/generated_images/<thread id>/<call id>.png`,
 * the id cleaned the way Codex cleans it (codex-rs/ext/image-generation/src/artifact.rs).
 * `codex exec --json` names no image file, so this folder is how the mod finds them.
 */
export function imageFolder(codexHome: string, threadId: string): string {
  const clean = threadId.replace(/[^A-Za-z0-9_-]/g, '_') || 'generated_image'
  return `${codexHome}/generated_images/${clean}`
}

/** What one line of `codex exec --json` says that the mod cares about. */
export type CodexLine = {
  /** The run's id, from `thread.started`: its images are saved under it. */
  threadId?: string
  /** Why the run failed, when the line says it did. */
  failure?: string
  /** Codex's own reply, kept to explain a run that made no image. */
  reply?: string
  /** Image files the reply names, for a Codex that saves them elsewhere. */
  mentioned: string[]
}

export function readLine(line: string): CodexLine {
  const result: CodexLine = { mentioned: [] }
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return result
  }
  if (event === null || typeof event !== 'object') return result

  const record = event as {
    type?: unknown
    thread_id?: unknown
    error?: { message?: unknown }
    item?: { type?: unknown; text?: unknown }
  }
  if (record.type === 'thread.started' && typeof record.thread_id === 'string') {
    result.threadId = record.thread_id
  }
  if (record.type === 'turn.failed') {
    const message = record.error?.message
    result.failure = typeof message === 'string' ? message : 'Codex stopped with an error.'
  }
  const item = record.item
  if (record.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
    result.reply = item.text
    for (const [path] of item.text.matchAll(/\/[^\s'"`()<>]+/g)) {
      const clean = path.replace(/[.,;:!?]+$/, '')
      if (isImageFile(clean) && !result.mentioned.includes(clean)) result.mentioned.push(clean)
    }
  }
  return result
}

/** The link to open and the one-time code, from what `codex login` printed so far. */
export function loginPrompt(text: string): { url?: string; code?: string } {
  const plain = stripAnsi(text)
  const url = plain.match(/https:\/\/[^\s"'<>]+/)?.[0]
  const code = plain.match(/\b[A-Z0-9]{3,6}-[A-Z0-9]{3,6}\b/)?.[0]
  return { url, code }
}

/**
 * What `codex login status` means for making images, without echoing any key.
 * Codex offers its image tool only to a ChatGPT login (not an API key, not the
 * Free plan), so an API-key login counts as not logged in here.
 */
export function readLoginStatus(
  exitCode: number,
  output: string,
): { status: 'logged-in' | 'logged-out'; detail: string } {
  if (exitCode !== 0) return { status: 'logged-out', detail: 'Not logged in to ChatGPT yet.' }
  if (/chatgpt/i.test(output)) return { status: 'logged-in', detail: 'ChatGPT account' }
  if (/api key/i.test(output)) {
    return {
      status: 'logged-out',
      detail: 'Codex is logged in with an API key, but it makes images only with a ChatGPT login.',
    }
  }
  return { status: 'logged-in', detail: 'logged in' }
}

/** A file name from the description: `A red fox, flat logo!` → `a-red-fox-flat-logo`. */
export function slug(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word.length > 0)
    .slice(0, 6)
  return words.join('-').slice(0, 48).replace(/-+$/, '') || 'image'
}

export const extensionOf = (path: string): string =>
  path.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? '.png'

export const baseName = (path: string): string => path.split('/').pop() ?? path

export const dirName = (path: string): string => {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** `public/images/` → `public/images`; empty → the fallback. */
export function cleanFolder(folder: string, fallback: string): string {
  const trimmed = folder.trim().replace(/\/+$/, '')
  return trimmed === '' ? fallback : trimmed
}

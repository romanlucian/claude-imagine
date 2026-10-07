import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ImagineImage, ImagineJob, ImagineLogin } from '../types'
import {
  baseName,
  cleanFolder,
  codexPrompt,
  dirName,
  editPrompt,
  extensionOf,
  imageFolder,
  isImageFile,
  loginPrompt,
  parseRequest,
  readLine,
  readLoginStatus,
  slug,
} from './codex'

type Engine = EngineInterface

const PANE = 'imagine'
const TITLE = 'Imagine'
const KEEP_IMAGES = 40
const SHOWN_IMAGES = 12

const images = atom({ plugin: 'imagine', key: 'images' } as const, [])
const jobs = atom({ plugin: 'imagine', key: 'jobs' } as const, [])
const login = atom({ plugin: 'imagine', key: 'login' } as const, { status: 'unknown', detail: '' })
const dest = atom({ plugin: 'imagine', key: 'dest' } as const, '')
const lastAdded = atom({ plugin: 'imagine', key: 'lastAdded' } as const, [])
const previews = atom({ plugin: 'imagine', key: 'previews' } as const, false)
const editing = atom({ plugin: 'imagine', key: 'editing' } as const, '')
const editDraft = atom({ plugin: 'imagine', key: 'editDraft' } as const, '')
const promptDraft = atom({ plugin: 'imagine', key: 'promptDraft' } as const, '')

// The children still running (Codex runs, a login), so Cancel can stop them.
// Module state on purpose: a reload ends them anyway.
const running = new Map<string, () => void>()

const short = (text: string, max = 40): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const oneLine = (text: string): string => short(text.replace(/\s+/g, ' ').trim(), 200)

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`

// How to run Codex: the `codexPath` option, read again at every load.
let codex = 'codex'

// ---- Codex: install, login --------------------------------------------

async function checkLogin($: Engine, force = false): Promise<ImagineLogin> {
  let found: ImagineLogin
  try {
    const ran = await $.process.run([codex, 'login', 'status'], { timeoutMs: 20_000 })
    found = readLoginStatus(ran.exitCode, `${ran.stdout}\n${ran.stderr}`)
  } catch {
    found = { status: 'no-codex', detail: `Claude Code could not run \`${codex}\`.` }
  }
  // A check never interrupts a login in progress; the login checks when it ends.
  await update($, login, current =>
    current.status === 'logging-in' && !force && found.status !== 'logged-in' ? current : found,
  )
  return found
}

async function installCodex($: Engine): Promise<void> {
  $.ui.status('imagine: installing Codex CLI…')
  try {
    const ran = await $.process.run(['npm', 'install', '-g', '@openai/codex'], {
      timeoutMs: 300_000,
    })
    if (ran.exitCode !== 0) {
      const tail = (ran.stderr || ran.stdout).trim().split('\n').slice(-2).join(' ')
      $.ui.toast(
        `imagine: npm could not install Codex (${oneLine(tail)}). In a terminal: npm install -g @openai/codex`,
        { timeoutMs: 15_000 },
      )
    }
  } catch {
    $.ui.toast('imagine: npm was not found. Install Node.js, then: npm install -g @openai/codex', {
      timeoutMs: 15_000,
    })
  } finally {
    showWork($)
  }
  const after = await checkLogin($, true)
  if (after.status !== 'no-codex') $.ui.toast('imagine: Codex is installed. Now log in with ChatGPT.')
}

async function logIn($: Engine, mode: 'browser' | 'device'): Promise<void> {
  running.get('login')?.()
  const argv = mode === 'device' ? [codex, 'login', '--device-auth'] : [codex, 'login']
  await update($, login, () => ({
    status: 'logging-in',
    detail:
      mode === 'device'
        ? 'Open the link, sign in to ChatGPT, then enter the code.'
        : 'Finish signing in to ChatGPT in the browser window that opened.',
  }))
  let printed = ''
  let stop: (() => void) | undefined
  try {
    const stream = $.process.spawn({ argv })
    stop = () => void stream.return({ code: null, signal: 'SIGTERM' })
    running.set('login', stop)
    for await (const chunk of stream) {
      printed += chunk.text
      const { url, code } = loginPrompt(printed)
      await update($, login, current =>
        current.status === 'logging-in' && (current.url !== url || current.code !== code)
          ? { ...current, ...(url === undefined ? {} : { url }), ...(code === undefined ? {} : { code }) }
          : current,
      )
    }
  } catch {
    // Not started, or stopped: the check below says where that left things.
  }
  // A login that was cancelled or replaced by a newer one leaves the state to that one.
  const isCurrent = stop === undefined ? !running.has('login') : running.get('login') === stop
  if (!isCurrent) return
  running.delete('login')
  const after = await checkLogin($, true)
  if (after.status === 'logged-in') $.ui.toast(`imagine: logged in (${after.detail})`)
}

async function cancelLogin($: Engine): Promise<void> {
  running.get('login')?.()
  running.delete('login')
  await checkLogin($, true)
}

// ---- Generating ---------------------------------------------------------

function showWork($: Engine): void {
  const busy = [...running.keys()].filter(key => key !== 'login').length
  $.ui.status(busy === 0 ? undefined : `imagine: drawing ${plural(busy, 'request')}…`)
}

async function codexHome($: Engine): Promise<string> {
  const custom = await $.env.get('CODEX_HOME')
  if (custom !== undefined && custom !== '') return custom.replace(/\/+$/, '')
  return `${(await $.env.get('HOME')) ?? ''}/.codex`
}

/** The image files in one folder, oldest first; none when it does not exist (yet). */
async function imagesIn($: Engine, folder: string): Promise<string[]> {
  let entries
  try {
    entries = await $.fs.list(folder)
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.kind === 'file' && isImageFile(entry.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map(entry => `${folder}/${entry.name}`)
}

/** Images under `$CODEX_HOME/generated_images` written since `since`, oldest first. */
async function recentImages($: Engine, since: number): Promise<string[]> {
  const root = `${await codexHome($)}/generated_images`
  const found: { path: string; at: number }[] = []
  const walk = async (folder: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await $.fs.list(folder)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`
      if (entry.kind === 'dir' && depth < 3) await walk(path, depth + 1)
      else if (entry.kind === 'file' && isImageFile(entry.name) && entry.mtimeMs >= since - 5_000) {
        found.push({ path, at: entry.mtimeMs })
      }
    }
  }
  await walk(root, 0)
  return found.sort((a, b) => a.at - b.at).map(one => one.path)
}

async function saveImages($: Engine): Promise<void> {
  await $.store.set('images', await read($, images))
}

/**
 * Where the mod keeps its own copy of each image: `~/Pictures/Imagine`.
 * Codex's file can be gone by the time the person presses a button, so the
 * pane, Open, Show in folder and Add to project all use this copy.
 */
async function keptFolder($: Engine): Promise<string> {
  return `${(await $.env.get('HOME')) ?? ''}/Pictures/Imagine`
}

/** Copies Codex's file into the kept folder; the copy's path, or the original when the copy fails. */
async function keepCopy($: Engine, path: string, prompt: string, target?: string): Promise<string> {
  try {
    const folder = await keptFolder($)
    await $.process.run(['mkdir', '-p', folder])
    const copy = target ?? (await freeName($, folder, slug(prompt), extensionOf(path)))
    const ran = await $.process.run(['cp', path, copy])
    return ran.exitCode === 0 ? copy : path
  } catch {
    return path
  }
}

async function addImage($: Engine, path: string, prompt: string, threadId?: string): Promise<void> {
  const createdAt = await $.clock.now()
  const image: ImagineImage = {
    id: `img-${createdAt}-${Math.floor(Math.random() * 1e6)}`,
    path,
    name: baseName(path),
    prompt,
    createdAt,
    isSelected: false,
    ...(threadId === undefined ? {} : { threadId }),
  }
  await update($, images, list =>
    list.some(one => one.path === path) ? list : [...list, image].slice(-KEEP_IMAGES),
  )
  await saveImages($)
}

async function setJob($: Engine, id: string, change: Partial<ImagineJob>): Promise<void> {
  await update($, jobs, list => list.map(job => (job.id === id ? { ...job, ...change } : job)))
}

/**
 * Starts a Codex run: a new image from `request`, or with `base` a new version
 * of that image, `request` saying what to change, in the same Codex conversation.
 */
async function generate(
  $: Engine,
  request: string,
  base?: ImagineImage,
): Promise<{ isStarted: boolean; text: string }> {
  const { count, prompt } = base === undefined ? parseRequest(request) : { count: 1, prompt: request.trim() }
  if (prompt === '') {
    return {
      isStarted: false,
      text:
        base === undefined
          ? 'Describe the image first, e.g. /imagine a cozy cafe logo, flat style'
          : 'Say what to change first, e.g. /imagine edit make the background blue',
    }
  }
  if (base !== undefined && base.threadId === undefined) {
    return { isStarted: false, text: 'This image was made before Edit existed: generate it again to edit it.' }
  }
  const account = await checkLogin($)
  if (account.status !== 'logged-in') {
    void $.ui.open({ id: PANE, title: TITLE })
    return {
      isStarted: false,
      text:
        account.status === 'no-codex'
          ? 'Codex CLI is not installed yet: the Imagine pane has an Install button.'
          : 'Log in with ChatGPT first: the Imagine pane has the button.',
    }
  }
  const startedAt = await $.clock.now()
  const job: ImagineJob = {
    id: `job-${startedAt}-${Math.floor(Math.random() * 1e6)}`,
    prompt,
    count,
    status: 'running',
    message: 'Starting Codex…',
    startedAt,
  }
  await update($, jobs, list => [...list, job].slice(-6))
  void runJob($, job, base)
  return {
    isStarted: true,
    text:
      base === undefined
        ? `Generating ${count === 1 ? 'an image' : `${count} images`} of "${prompt}" with your ChatGPT account. They will appear in the Imagine pane.`
        : `Editing ${base.name}: "${prompt}". The new version will appear in the Imagine pane.`,
  }
}

async function runJob($: Engine, job: ImagineJob, base?: ImagineImage): Promise<void> {
  const home = await codexHome($)
  const found: string[] = []
  // An edit continues the base image's Codex run, which saves into the same
  // folder: the images already there are the earlier versions, not new ones.
  const seen = new Set(base?.threadId === undefined ? [] : await imagesIn($, imageFolder(home, base.threadId)))
  // The new version is named and described after the image it changes.
  const described = base === undefined ? job.prompt : `${base.prompt}, ${job.prompt}`
  const mentioned: string[] = []
  let threadId: string | undefined
  let failure: string | undefined
  let reply: string | undefined
  let isCancelled = false
  let isSettled = false
  let exitCode: number | null = null

  // Codex's file → the mod's own copy of it.
  const kept = new Map<string, string>()
  const claim = async (paths: readonly string[]): Promise<void> => {
    for (const path of paths) {
      if (found.includes(path) || seen.has(path)) continue
      found.push(path)
      const copy = await keepCopy($, path, described)
      kept.set(path, copy)
      await addImage($, copy, described, threadId ?? base?.threadId)
      // A look still under way when the run ended must not undo its final line.
      if (!isSettled) await setJob($, job.id, { message: `${found.length} of ${job.count} ready…` })
    }
  }
  // Codex writes each image into the run's folder as it finishes; look there
  // every few seconds so images show up while the rest are still drawing.
  const collect = async (): Promise<void> => {
    if (threadId !== undefined) await claim(await imagesIn($, imageFolder(home, threadId)))
  }
  const take = async (line: string): Promise<void> => {
    const said = readLine(line)
    if (said.threadId !== undefined && threadId === undefined) {
      threadId = said.threadId
      await setJob($, job.id, { message: 'Codex is drawing… (an image can take a minute)' })
    }
    if (said.failure !== undefined) failure = said.failure
    if (said.reply !== undefined) reply = said.reply
    for (const path of said.mentioned) if (!mentioned.includes(path)) mentioned.push(path)
  }

  const poll = $.clock.every(4_000, () => void collect())
  try {
    const options = ['--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'model_reasoning_effort="low"']
    const stream = $.process.spawn({
      argv:
        base?.threadId === undefined
          ? [codex, 'exec', ...options, '-']
          : [codex, 'exec', ...options, 'resume', base.threadId, '-'],
      input: base === undefined ? codexPrompt(job.prompt, job.count) : editPrompt(job.prompt),
    })
    running.set(job.id, () => {
      isCancelled = true
      void stream.return({ code: null, signal: 'SIGTERM' })
    })
    showWork($)
    let pending = ''
    for await (const chunk of stream) {
      if (chunk.stream !== 'stdout') continue
      pending += chunk.text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) await take(line)
    }
    if (pending.trim() !== '') await take(pending)
    exitCode = (await stream.result).code
  } catch (error) {
    if (!isCancelled && failure === undefined) {
      failure = `Could not run Codex: ${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    poll.cancel()
    running.delete(job.id)
    showWork($)
  }

  // Whatever finished before a Cancel is kept.
  await collect()
  if (found.length === 0) {
    // A Codex that saves elsewhere: the files its reply names, and with no
    // run id to go by, whatever appeared in its image folder meanwhile.
    const existing: string[] = []
    for (const path of mentioned) {
      if (path.startsWith(`${home}/generated_images/`) && (await $.fs.exists(path))) existing.push(path)
    }
    await claim(existing)
    if (found.length === 0 && (threadId === undefined || base !== undefined) && !isCancelled) {
      await claim(await recentImages($, job.startedAt))
    }
  }

  // Copy again now that Codex is done, in case a file was still being written
  // when it was first seen.
  for (const [path, copy] of kept) {
    if (copy !== path && (await $.fs.exists(path))) await keepCopy($, path, described, copy)
  }

  isSettled = true
  if (isCancelled) {
    await setJob($, job.id, {
      status: 'failed',
      message: found.length === 0 ? 'Cancelled.' : `Cancelled after ${plural(found.length, 'image')}.`,
    })
    return
  }
  if (found.length > 0) {
    await setJob($, job.id, { status: 'done', message: `${plural(found.length, 'image')} ready` })
    $.ui.toast(`imagine: ${plural(found.length, 'image')} of "${short(job.prompt)}" ready in the Imagine pane`)
    return
  }
  const why =
    failure ??
    (reply === undefined ? undefined : `Codex made no image. It said: ${reply}`) ??
    (exitCode !== null && exitCode !== 0
      ? `Codex exited with code ${exitCode}.`
      : 'Codex finished without making an image.')
  await setJob($, job.id, { status: 'failed', message: oneLine(why) })
  $.ui.toast(`imagine: no image. ${oneLine(why)}`, { timeoutMs: 12_000 })
}

// ---- Into the project ---------------------------------------------------

async function projectFolder($: Engine): Promise<string> {
  const folder = cleanFolder(await read($, dest), 'assets/images')
  if (!folder.startsWith('~/')) return folder
  return `${(await $.env.get('HOME')) ?? ''}${folder.slice(1)}`
}

async function freeName($: Engine, folder: string, base: string, extension: string): Promise<string> {
  for (let n = 1; n < 500; n++) {
    const candidate = `${folder}/${base}${n === 1 ? '' : `-${n}`}${extension}`
    if (!(await $.fs.exists(candidate))) return candidate
  }
  return `${folder}/${base}-${await $.clock.now()}${extension}`
}

async function addToProject($: Engine, chosen: readonly ImagineImage[]): Promise<void> {
  if (chosen.length === 0) {
    $.ui.toast('imagine: select an image first')
    return
  }
  const folder = await projectFolder($)
  const copied: string[] = []
  const problems: string[] = []
  try {
    await $.process.run(['mkdir', '-p', folder])
  } catch {
    // cp below says what went wrong
  }
  for (const image of chosen) {
    if (!(await $.fs.exists(image.path))) {
      problems.push(`${image.name} is no longer on disk`)
      continue
    }
    const target = await freeName($, folder, slug(image.prompt), extensionOf(image.path))
    try {
      const ran = await $.process.run(['cp', image.path, target])
      if (ran.exitCode !== 0) {
        problems.push(`${image.name}: ${oneLine(ran.stderr || `cp exited ${ran.exitCode}`)}`)
        continue
      }
    } catch (error) {
      problems.push(`${image.name}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    copied.push(target)
    await update($, images, list =>
      list.map(one => (one.id === image.id ? { ...one, addedTo: target, isSelected: false } : one)),
    )
  }
  await saveImages($)
  if (copied.length > 0) {
    await update($, lastAdded, () => copied)
    $.ui.toast(`imagine: added ${copied.join(', ')}`, { timeoutMs: 8_000 })
  }
  if (problems.length > 0) {
    $.ui.toast(`imagine: could not add ${problems.join('; ')}`, { timeoutMs: 12_000 })
  }
}

async function setFolder($: Engine, value: string): Promise<void> {
  const folder = cleanFolder(value, 'assets/images')
  await update($, dest, () => folder)
  await $.store.set(`dest:${await $.session.cwd()}`, folder)
  $.ui.toast(`imagine: images will be added to ${folder}`)
}

async function reveal($: Engine, path: string, how: 'file' | 'folder'): Promise<void> {
  let isMac = false
  try {
    isMac = (await $.process.run(['uname', '-s'])).stdout.trim() === 'Darwin'
  } catch {
    // not a POSIX host: try xdg-open below and report what happens
  }
  const argv = isMac
    ? how === 'file'
      ? ['open', path]
      : ['open', '-R', path]
    : ['xdg-open', how === 'file' ? path : dirName(path)]
  let problem: string | undefined
  try {
    const ran = await $.process.run(argv, { timeoutMs: 15_000 })
    if (ran.exitCode !== 0) problem = oneLine(ran.stderr) || `${argv[0]} exited ${ran.exitCode}`
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error)
  }
  if (problem !== undefined) {
    $.ui.toast(`imagine: could not open it on this machine (${problem}). The file is ${path}`, {
      timeoutMs: 12_000,
    })
  }
}

async function mention($: Engine): Promise<void> {
  const paths = await read($, lastAdded)
  if (paths.length === 0) return
  await $.prompt.fill({ text: `${paths.map(path => `@${path}`).join(' ')} `, mode: 'insert' })
}

async function restore($: Engine): Promise<void> {
  const saved = await $.store.get('images')
  const kept: ImagineImage[] = []
  if (Array.isArray(saved)) {
    for (const one of saved as ImagineImage[]) {
      if (typeof one?.path === 'string' && (await $.fs.exists(one.path))) kept.push({ ...one, isSelected: false })
    }
  }
  await update($, images, current => (current.length > 0 ? current : kept))

  const cwd = await $.session.cwd()
  const remembered = await $.store.get(`dest:${cwd}`)
  const folder =
    typeof remembered === 'string' && remembered !== ''
      ? remembered
      : (await $.fs.exists('public'))
        ? 'public/images'
        : (await $.fs.exists('src/assets'))
          ? 'src/assets/images'
          : 'assets/images'
  await update($, dest, current => (current === '' ? folder : current))

  const term = (await $.env.get('TERM')) ?? ''
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  const isKitty = (await $.env.get('KITTY_WINDOW_ID')) !== undefined
  const canDraw = isKitty || /kitty|ghostty/i.test(term) || /ghostty/i.test(program)
  if (canDraw) await update($, previews, () => true)
}

export const register: Register = (on, options) => {
  const configured = typeof options.codexPath === 'string' ? options.codexPath.trim() : ''
  codex = configured === '' ? 'codex' : configured

  // ---- Hooks ----------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'imagine',
      description: 'Generate images with your ChatGPT account (via Codex) and add them to the project',
      argumentHint: '[2x] <description> | edit <change> | login | login code',
    })
    await restore($)
    return next(e)
  })

  on('command.run', { command: 'imagine' }, async ($, e) => {
    const args = e.args.trim()
    await $.ui.open({ id: PANE, title: TITLE })
    if (args === '') {
      void checkLogin($)
      return { text: 'Imagine pane opened.' }
    }
    if (/^login(\s+(code|--device-auth))?$/i.test(args)) {
      const mode = /code|device/i.test(args) ? 'device' : 'browser'
      void logIn($, mode)
      return {
        text:
          mode === 'device'
            ? 'Logging in with ChatGPT: the Imagine pane shows the link and the code.'
            : 'Logging in with ChatGPT: finish in the browser window that opens.',
      }
    }
    const edit = args.match(/^edit(?:\s+([\s\S]*))?$/i)
    if (edit !== null) {
      const latest = (await read($, images)).filter(one => one.threadId !== undefined).pop()
      if (latest === undefined) return { text: 'Make an image first: /imagine edit changes the latest one.' }
      const started = await generate($, edit[1] ?? '', latest)
      return { text: started.text }
    }
    const started = await generate($, args)
    return { text: started.text }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Link } = table
    const Input = 'Input' in table ? table.Input : undefined
    const Image = 'Image' in table ? table.Image : undefined

    const account = await read($, login)
    const list = await read($, images)
    const work = await read($, jobs)
    const folder = await read($, dest)
    const added = await read($, lastAdded)
    const isPreviewing = (await read($, previews)) && Image !== undefined
    const editingId = await read($, editing)
    const typedEdit = await read($, editDraft)
    const typedPrompt = await read($, promptDraft)
    const selected = list.filter(one => one.isSelected)
    const isLoggedIn = account.status === 'logged-in'

    const accountRows = (() => {
      switch (account.status) {
        case 'unknown':
          return (
            <Box gap={1}>
              <Text dimColor>Checking your ChatGPT login…</Text>
              <Button key="recheck" label="Check again" onPress={() => void checkLogin($, true)} />
            </Box>
          )
        case 'no-codex':
          return (
            <Box flexDirection="column">
              <Text>
                This mod signs in with ChatGPT through OpenAI's free Codex CLI, which is not installed here yet.
              </Text>
              <Text dimColor>{account.detail}</Text>
              <Box gap={1} flexWrap="wrap">
                <Button key="install" variant="primary" label="Install Codex (npm)" onPress={() => void installCodex($)} />
                <Button key="recheck" label="Check again" onPress={() => void checkLogin($, true)} />
              </Box>
              <Text dimColor>Or in a terminal: npm install -g @openai/codex</Text>
              <Text dimColor>
                Installed but still not found? Run `which codex` in a terminal and put that path in this plugin's
                "Codex command" option.
              </Text>
            </Box>
          )
        case 'logged-out':
          return (
            <Box flexDirection="column">
              <Text>{account.detail}</Text>
              <Box gap={1} flexWrap="wrap">
                <Button key="login" variant="primary" label="Log in with ChatGPT" onPress={() => void logIn($, 'browser')} />
                <Button key="login-code" label="Use a code instead" onPress={() => void logIn($, 'device')} />
              </Box>
              <Text dimColor>
                Use a code when Claude Code runs over SSH or no browser opens. Making images needs ChatGPT Plus or higher.
              </Text>
            </Box>
          )
        case 'logging-in':
          return (
            <Box flexDirection="column">
              <Text>{account.detail}</Text>
              {account.url !== undefined && (
                <Box gap={1}>
                  <Text>Sign-in page:</Text>
                  <Link href={account.url} label={account.code === undefined ? 'open it' : account.url} />
                </Box>
              )}
              {account.code !== undefined && (
                <Box gap={1}>
                  <Text>Code:</Text>
                  <Text bold color="claude">
                    {account.code}
                  </Text>
                  <Button
                    key="copy-code"
                    label="Copy"
                    onPress={press => void $.ui.copy({ text: account.code ?? '', surface: press.surface })}
                  />
                </Box>
              )}
              <Box>
                <Button key="cancel-login" label="Cancel" onPress={() => void cancelLogin($)} />
              </Box>
            </Box>
          )
        case 'logged-in':
          return (
            <Box gap={1}>
              <Text color="success">● ChatGPT</Text>
              <Text dimColor>{account.detail}</Text>
            </Box>
          )
      }
    })()

    const promptRow = !isLoggedIn ? null : Input !== undefined ? (
      <Box flexDirection="column">
        <Text bold>Describe an image:</Text>
        <Input
          key="prompt"
          placeholder="a cozy cafe logo, flat style  (start with 2x for two)"
          value={typedPrompt}
          submitLabel="generate"
          onInput={value => void update($, promptDraft, () => value)}
          onSubmit={value => {
            void update($, promptDraft, () => '')
            void generate($, value).then(result => {
              if (!result.isStarted) $.ui.toast(`imagine: ${result.text}`)
            })
          }}
        />
      </Box>
    ) : (
      <Text dimColor>Type /imagine and a description to make an image.</Text>
    )

    const jobRows =
      work.length === 0 ? null : (
        <Box flexDirection="column">
          {work
            .slice()
            .reverse()
            .map(job => (
              <Box key={job.id} flexDirection="column">
                <Box gap={1}>
                  <Text color={job.status === 'failed' ? 'error' : job.status === 'done' ? 'success' : 'warning'}>
                    {job.status === 'running' ? '…' : job.status === 'done' ? '✓' : '✗'}
                  </Text>
                  <Text wrap="truncate-end">
                    "{short(job.prompt, 36)}"{job.count > 1 ? ` ×${job.count}` : ''}
                  </Text>
                  {job.status === 'running' && (
                    <Button key={`cancel-${job.id}`} label="Cancel" onPress={() => running.get(job.id)?.()} />
                  )}
                </Box>
                <Text dimColor>  {job.message}</Text>
              </Box>
            ))}
        </Box>
      )

    const imageRows =
      list.length === 0 ? (
        isLoggedIn ? <Text dimColor>No images yet. Describe one above, or type /imagine and a description.</Text> : null
      ) : (
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <Text bold>Images</Text>
            <Text dimColor>({list.length})</Text>
            {Image !== undefined && (
              <Button
                key="previews"
                label={isPreviewing ? 'Hide previews' : 'Show previews'}
                onPress={() => void update($, previews, value => !value)}
              />
            )}
          </Box>
          {list
            .slice()
            .reverse()
            .slice(0, SHOWN_IMAGES)
            .map(image => (
              <Box key={image.id} flexDirection="column">
              <Box gap={1}>
                {isPreviewing && Image !== undefined && image.path.startsWith('/') && /\.png$/i.test(image.path) && (
                  <Image source={{ file: image.path, format: 'png' }} columns={16} rows={8} alt={image.name} />
                )}
                <Box flexDirection="column" flexShrink={1}>
                  <Text wrap="truncate-middle">
                    {image.isSelected ? '☑ ' : '☐ '}
                    {image.name}
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    "{short(image.prompt, 60)}"
                  </Text>
                  {image.addedTo !== undefined && (
                    <Text color="success" wrap="truncate-middle">
                      ✓ in project: {image.addedTo}
                    </Text>
                  )}
                  <Box gap={1} flexWrap="wrap">
                    <Button
                      key={`select-${image.id}`}
                      label={image.isSelected ? 'Unselect' : 'Select'}
                      onPress={() =>
                        void update($, images, current =>
                          current.map(one => (one.id === image.id ? { ...one, isSelected: !one.isSelected } : one)),
                        )
                      }
                    />
                    <Button key={`add-${image.id}`} label="Add to project" onPress={() => void addToProject($, [image])} />
                    <Button key={`open-${image.id}`} label="Open" onPress={() => void reveal($, image.path, 'file')} />
                    <Button
                      key={`show-${image.id}`}
                      label="Show in folder"
                      onPress={() => void reveal($, image.path, 'folder')}
                    />
                    {Input !== undefined && image.threadId !== undefined && (
                      <Button
                        key={`edit-${image.id}`}
                        label={editingId === image.id ? 'Cancel edit' : 'Edit'}
                        onPress={async () => {
                          await update($, editDraft, () => '')
                          await update($, editing, current => (current === image.id ? '' : image.id))
                        }}
                      />
                    )}
                  </Box>
                </Box>
              </Box>
              {Input !== undefined && editingId === image.id && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold>What to change:</Text>
                  <Input
                    key={`change-${image.id}`}
                    placeholder="make the background blue, bigger title"
                    value={typedEdit}
                    submitLabel="edit"
                    onInput={value => void update($, editDraft, () => value)}
                    onSubmit={value => {
                      void generate($, value, image).then(async result => {
                        if (!result.isStarted) $.ui.toast(`imagine: ${result.text}`)
                        else {
                          await update($, editDraft, () => '')
                          await update($, editing, () => '')
                        }
                      })
                    }}
                  />
                </Box>
              )}
              </Box>
            ))}
          {list.length > SHOWN_IMAGES && (
            <Text dimColor>…and {plural(list.length - SHOWN_IMAGES, 'older image')} (Clear list to tidy up).</Text>
          )}
        </Box>
      )

    const projectRows =
      list.length === 0 ? null : (
        <Box flexDirection="column">
          {Input !== undefined ? (
            <Input
              key="dest"
              label="Project folder"
              value={folder}
              submitLabel="save"
              onInput={value => void update($, dest, () => value)}
              onSubmit={value => void setFolder($, value)}
            />
          ) : (
            <Text dimColor>Project folder: {folder}</Text>
          )}
          <Box gap={1} flexWrap="wrap">
            {selected.length > 0 && (
              <Button
                key="add-selected"
                variant="primary"
                label={`Add ${plural(selected.length, 'selected image')} to project`}
                onPress={async () => addToProject($, (await read($, images)).filter(one => one.isSelected))}
              />
            )}
            {added.length > 0 && (
              <Button
                key="mention"
                label={added.length === 1 ? 'Mention it in my prompt' : 'Mention them in my prompt'}
                onPress={() => void mention($)}
              />
            )}
            <Button
              key="clear"
              label="Clear list"
              dimColor
              onPress={async () => {
                await update($, images, () => [])
                await saveImages($)
              }}
            />
          </Box>
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {accountRows}
        {promptRow}
        {jobRows}
        {imageRows}
        {projectRows}
      </Box>
    )
  })
}

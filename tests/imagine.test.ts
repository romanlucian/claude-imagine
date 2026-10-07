import { describe, expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On, ProcessRunResult } from 'claude-code'

import { imageFolder, loginPrompt, parseRequest, readLine, readLoginStatus, slug } from '../hooks/codex'

const HOME = '/home/test'
// What Codex 0.160 does: `thread.started` names the run, and its image tool
// saves each picture as `$CODEX_HOME/generated_images/<thread id>/<call id>.png`.
const THREAD = '01a112d7-cabb-7ae1-8e22-13f511f18243'
const RUN = `${HOME}/.codex/generated_images/${THREAD}`
const FIRST = `${RUN}/call_img1.png`
const SECOND = `${RUN}/call_img2.png`
// The mod's own copies, named from the description.
const KEPT = `${HOME}/Pictures/Imagine`
const KEPT_FIRST = `${KEPT}/a-red-fox-logo.png`
const KEPT_SECOND = `${KEPT}/a-red-fox-logo-2.png`
const EDITED = `${RUN}/call_edit1.png`

const PANE = {
  plugin: 'imagine',
  component: 'Pane',
  requestId: 'imagine',
  props: {
    title: 'Imagine',
    isFocused: true,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

const failed = (stderr: string): ProcessRunResult => ({ ...ok(''), exitCode: 1, stderr })

const file = (name: string, mtimeMs: number): FsEntry => ({ name, kind: 'file', size: 1_500_000, mtimeMs, isLink: false })

type World = {
  login: 'chatgpt' | 'api-key' | 'none'
  hasCodex: boolean
  /** Whether Codex's image tool runs (a ChatGPT Plus login) or Codex only replies. */
  makesImages: boolean
  reply: string
  files: Set<string>
  folders: Map<string, FsEntry[]>
}

const world = (change: Partial<World> = {}): World => ({
  login: 'chatgpt',
  hasCodex: true,
  makesImages: true,
  reply: 'Here are two fox logos.',
  files: new Set(),
  folders: new Map(),
  ...change,
})

/** Answers what Codex, cp and the file system would, and records the commands run. */
function fakeHost(on: On, state: World) {
  const ran: string[][] = []
  const spawned: { argv: string[]; input?: string }[] = []
  let releaseLogin: () => void = () => {}
  const loginDone = new Promise<void>(resolve => {
    releaseLogin = resolve
  })

  mock.env(on, { HOME })
  mock.store(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const [command, ...rest] = argv
    if (command === 'codex') {
      if (!state.hasCodex) return { deny: 'spawn codex ENOENT' }
      if (rest.join(' ') === 'login status') {
        if (state.login === 'chatgpt') return { value: ok('Logged in using ChatGPT\n') }
        if (state.login === 'api-key') return { value: ok('Logged in using an API key - ***\n') }
        return { value: failed('Not logged in\n') }
      }
    }
    if (command === 'cp' && rest[1] !== undefined) state.files.add(rest[1])
    if (command === 'uname') return { value: ok('Darwin\n') }
    return { value: ok('') }
  })

  on('process.spawn', async function* ($, e) {
    const argv = [...e.argv]
    spawned.push({ argv, input: e.input })
    if (argv[1] === 'login') {
      yield {
        stream: 'stdout' as const,
        text:
          '1. Open this link in your browser and sign in to your account\n' +
          '   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n' +
          '2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n' +
          '   \u001b[94mABCD-12345\u001b[0m\n',
      }
      await loginDone
      state.login = 'chatgpt'
      return { value: { code: 0, signal: null } }
    }
    // `codex exec --json` as Codex prints it: no line names an image file.
    yield { stream: 'stdout' as const, text: `{"type":"thread.started","thread_id":"${THREAD}"}\n{"type":"turn.started"}\n` }
    if (argv.includes('resume')) {
      // A resumed run saves its new version next to the earlier ones.
      const earlier = state.folders.get(RUN) ?? []
      state.folders.set(RUN, [...earlier, file('call_edit1.png', 1_700_000_003_000)])
      state.files.add(EDITED)
      return { value: { code: 0, signal: null } }
    }
    if (state.makesImages) {
      state.folders.set(RUN, [file('call_img1.png', 1_700_000_001_000), file('call_img2.png', 1_700_000_002_000)])
      state.files.add(FIRST).add(SECOND)
    }
    const reply = JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: state.reply } })
    yield { stream: 'stdout' as const, text: reply.slice(0, 30) }
    yield {
      stream: 'stdout' as const,
      text: `${reply.slice(30)}\n{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}\n`,
    }
    return { value: { code: 0, signal: null } }
  })

  // The engine hands fs hooks absolute paths, resolved against the working
  // directory; `files` lists project files relative to it.
  const exists = (path: string): boolean =>
    state.files.has(path) || [...state.files].some(one => !one.startsWith('/') && path.endsWith(`/${one}`))
  on('fs.exists', ($, e) => ({ value: exists(e.path) }))
  on('fs.list', ($, e) => {
    const entries = state.folders.get(e.path)
    return entries === undefined ? { deny: `ENOENT: no such directory ${e.path}` } : { value: entries }
  })

  // The session and the screen, as far as the mod reaches them.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true as const } }))
  on('prompt.fill', () => ({ isFilled: true }))

  return { ran, spawned, clock, releaseLogin }
}

const command = (args: string) => ({
  command: 'imagine',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

const start = { cwd: '/work/app', surface: 'terminal', isInteractive: true } as const

describe('reading Codex', () => {
  test('requests, file names and login prompts', () => {
    expect(parseRequest('3x a red fox')).toEqual({ count: 3, prompt: 'a red fox' })
    expect(parseRequest('x2 cafe logo')).toEqual({ count: 2, prompt: 'cafe logo' })
    expect(parseRequest('9x too many')).toEqual({ count: 4, prompt: 'too many' })
    expect(parseRequest('3 cats on a sofa')).toEqual({ count: 1, prompt: '3 cats on a sofa' })
    expect(slug('A red fox, flat LOGO! (v2)')).toBe('a-red-fox-flat-logo-v2')
    expect(slug('???')).toBe('image')
    expect(loginPrompt('code \u001b[94mWXYZ-1234\u001b[0m at \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m')).toEqual({
      url: 'https://auth.openai.com/codex/device',
      code: 'WXYZ-1234',
    })
  })

  test('exec --json lines, the run folder and login status', () => {
    expect(readLine(`{"type":"thread.started","thread_id":"${THREAD}"}`).threadId).toBe(THREAD)
    expect(imageFolder(`${HOME}/.codex`, THREAD)).toBe(RUN)
    expect(imageFolder('/c', 'a/b c')).toBe('/c/generated_images/a_b_c')
    expect(readLine('{"type":"turn.failed","error":{"message":"usage limit reached"}}').failure).toBe(
      'usage limit reached',
    )
    const said = readLine(
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: `Saved to ${FIRST}. Enjoy!` } }),
    )
    expect(said.reply).toBe(`Saved to ${FIRST}. Enjoy!`)
    expect(said.mentioned).toEqual([FIRST])
    expect(readLine('not json')).toEqual({ mentioned: [] })

    expect(readLoginStatus(0, 'Logged in using ChatGPT')).toEqual({ status: 'logged-in', detail: 'ChatGPT account' })
    expect(readLoginStatus(0, 'Logged in using an API key - ***').status).toBe('logged-out')
    expect(readLoginStatus(1, 'Not logged in').status).toBe('logged-out')
  })
})

describe('the mod', () => {
  test('generates two images and adds the selected ones to the project', async ($, on) => {
    const state = world({ files: new Set(['public']) })
    const host = fakeHost(on, state)
    await $.session.start(start)

    const answer = await $.command.run(command('2x a red fox logo'))
    expect(answer.text).toContain('Generating 2 images of "a red fox logo"')
    await host.clock.settle()

    // Each image is copied to ~/Pictures/Imagine as soon as it is seen.
    expect(host.ran).toContainEqual(['mkdir', '-p', KEPT])
    expect(host.ran).toContainEqual(['cp', FIRST, KEPT_FIRST])
    expect(host.ran).toContainEqual(['cp', SECOND, KEPT_SECOND])
    // Codex's own files can disappear afterwards; the buttons use the copies.
    state.files.delete(FIRST)
    state.files.delete(SECOND)

    const exec = host.spawned.find(one => one.argv[1] === 'exec')
    expect(exec?.argv).toEqual(expect.arrayContaining(['--json', '--sandbox', 'read-only', '-']))
    expect(exec?.input).toContain('Use $imagegen to generate 2 different variations')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '● ChatGPT' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 images ready' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'a-red-fox-logo.png' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'a-red-fox-logo-2.png' })).toBeDefined()
    expect((await ui.find({ key: 'dest' }))?.props.value).toBe('public/images')

    const selects = await ui.findAll({ type: 'Button', text: 'Select' })
    expect(selects.length).toBe(2)
    for (const button of selects) await ui.press({ key: button.key ?? '' })
    const addSelected = await ui.find({ key: 'add-selected' })
    expect(addSelected?.props.label).toBe('Add 2 selected images to project')
    await ui.press({ key: 'add-selected' })

    expect(host.ran).toContainEqual(['mkdir', '-p', 'public/images'])
    expect(host.ran).toContainEqual(['cp', KEPT_FIRST, 'public/images/a-red-fox-logo.png'])
    expect(host.ran).toContainEqual(['cp', KEPT_SECOND, 'public/images/a-red-fox-logo-2.png'])
    expect(await ui.find({ type: 'Text', text: 'in project: public/images/a-red-fox-logo-2.png' })).toBeDefined()
    expect(await ui.find({ key: 'mention' })).toBeDefined()
    expect(await ui.find({ key: 'add-selected' })).toBeUndefined()

    const show = (await ui.findAll({ type: 'Button', text: 'Show in folder' }))[0]
    await ui.press({ key: show?.key ?? '' })
    expect(host.ran).toContainEqual(['open', '-R', KEPT_SECOND])
    await ui.unmount()

    // Every surface draws the same pane: no Image or Input where the table has none.
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const other = await $.ui.mount({ ...PANE, surface })
      expect(await other.find({ type: 'Text', text: 'a-red-fox-logo.png' })).toBeDefined()
      expect(await other.find({ type: 'Image' })).toBeUndefined()
      await other.unmount()
    }
  })

  test('Edit continues the same Codex conversation and adds only the new version', async ($, on) => {
    const host = fakeHost(on, world())
    await $.session.start(start)
    await $.command.run(command('a red fox logo'))
    await host.clock.settle()

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const edit = (await ui.findAll({ type: 'Button', text: 'Edit' }))[0]
    await ui.press({ key: edit?.key ?? '' })
    const changeBox = async () => (await ui.findAll({ type: 'Input' })).find(one => one.key?.startsWith('change-'))
    const box = await changeBox()
    expect(box).toBeDefined()
    await ui.input({ key: box?.key ?? '', text: 'make it blue' })
    await host.clock.settle()

    const resumed = host.spawned.find(one => one.argv.includes('resume'))
    expect(resumed?.argv.slice(-3)).toEqual(['resume', THREAD, '-'])
    expect(resumed?.input).toContain('new version of the last image you generated, with this change: make it blue')
    // The earlier images in the run's folder are not added again; the new one is.
    expect(host.ran.filter(argv => argv[0] === 'cp' && argv[1] === FIRST).length).toBe(2)
    expect(host.ran).toContainEqual(['cp', EDITED, `${KEPT}/a-red-fox-logo-make-it.png`])
    expect(await ui.find({ type: 'Text', text: 'a-red-fox-logo-make-it.png' })).toBeDefined()
    expect(await changeBox()).toBeUndefined()
    await ui.unmount()

    // /imagine edit changes the latest image.
    const answer = await $.command.run(command('edit add a hat'))
    expect(answer.text).toContain('Editing a-red-fox-logo-make-it.png: "add a hat"')
  })

  test("shows Codex's own words when it makes no image", async ($, on) => {
    const state = world({ makesImages: false, reply: "I can't generate images here: image generation is not available." })
    const host = fakeHost(on, state)
    await $.session.start(start)

    await $.command.run(command('a red fox logo'))
    await host.clock.settle()

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "Codex made no image. It said: I can't generate images here" })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No images yet' })).toBeDefined()
    await ui.unmount()
  })

  test('logs in with a code, shown in the pane, when not logged in yet', { timeoutMs: 20_000 }, async ($, on) => {
    const host = fakeHost(on, world({ login: 'none' }))
    await $.session.start(start)

    const refused = await $.command.run(command('a red fox'))
    expect(refused.text).toContain('Log in with ChatGPT first')
    expect(host.spawned).toEqual([])

    await $.command.run(command('login code'))
    await host.clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'ABCD-12345' })).toBeDefined()
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://auth.openai.com/codex/device')
    expect(await ui.find({ key: 'copy-code' })).toBeDefined()
    expect(await ui.find({ key: 'prompt' })).toBeUndefined()

    host.releaseLogin()
    await host.clock.settle()
    expect(await ui.find({ type: 'Text', text: 'ChatGPT account' })).toBeDefined()
    expect(await ui.find({ key: 'prompt' })).toBeDefined()
    await ui.unmount()
  })

  test('asks for a ChatGPT login when Codex is logged in with an API key', async ($, on) => {
    const host = fakeHost(on, world({ login: 'api-key' }))
    await $.session.start(start)

    const refused = await $.command.run(command('a red fox'))
    expect(refused.text).toContain('Log in with ChatGPT first')
    expect(host.spawned).toEqual([])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'makes images only with a ChatGPT login' })).toBeDefined()
    expect(await ui.find({ key: 'login' })).toBeDefined()
    await ui.unmount()
  })

  test('offers to install Codex when it is missing', async ($, on) => {
    fakeHost(on, world({ login: 'none', hasCodex: false }))
    await $.session.start(start)

    const answer = await $.command.run(command('a red fox'))
    expect(answer.text).toContain('Codex CLI is not installed yet')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ key: 'install' })).toBeDefined()
    await ui.unmount()
  })
})

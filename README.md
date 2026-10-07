# imagine: ChatGPT images inside Claude Code

A [Claude Code](https://code.claude.com) mod that adds an **Imagine** pane and an `/imagine` command:

1. **Log in with ChatGPT.** It uses OpenAI's own Codex CLI, so your ChatGPT plan pays and you need no API key.
2. **Generate images** from a description: one, or up to 4 variations at once.
3. **Put them in your project.** Select one or more, and they are copied into a project folder (`public/images` by default).

An unofficial community mod by Lucian Roman, not made or supported by Anthropic or OpenAI. Mods are an early-access Claude Code feature, so keep Claude Code up to date (`claude update`).

## What you need

- **Claude Code** in a terminal (Ghostty, kitty, iTerm2, Terminal.app, VS Code's terminal…).
- **Codex CLI**: `npm install -g @openai/codex`. The pane also has an **Install Codex** button.
- **A ChatGPT login, on Plus or higher.** Codex only offers its image tool when it's logged in with ChatGPT. It doesn't offer it with an API key login or on the Free plan. Images count against your plan's Codex usage limits, and they use those limits faster than text does.

## Step by step: install it and make your first image

New to the terminal? Follow these steps in order. Every command is something you copy, paste, and press **Enter**.

### 1. Get the things it needs

1. **Node.js.** Go to [nodejs.org](https://nodejs.org), download the **LTS** version, and run the installer like any other app.
2. **Claude Code.** If you don't have it yet, follow [Anthropic's install page](https://code.claude.com/docs/en/setup).
3. **ChatGPT Plus (or higher).** Making images doesn't work on the Free plan.

### 2. Open a terminal

- **Mac:** press `Cmd + Space`, type **Terminal**, press Enter.
- **Ubuntu:** press `Ctrl + Alt + T`.

### 3. Install the mod (only once)

Type `claude` and press Enter to start Claude Code. Then type this inside Claude Code:

```
/plugin install imagine --marketplace romanlucian/claude-imagine
```

Answer `y` to add the marketplace, then press Enter for the **user** scope (it then works in all your projects). A settings screen with an empty **Codex command** field may appear. Leave it empty (the mod then uses `codex`) and choose **Save configuration**. Type `/exit` to quit Claude Code.

**Getting updates later.** In a terminal, type these two lines (press Enter after each), then start Claude Code again:

```
claude plugin marketplace update imagine
claude plugin update imagine@imagine
```

### 4. Open your project in Claude Code

"Your project" is the app you want images for. Images are saved into the folder Claude Code was started in, so start it there.

- **In the terminal:** type `cd` and a space, but don't press Enter yet. **Drag your project's folder from Finder (or Files) into the terminal window**: its path appears by itself. Now press Enter, then type `claude`.
- **In VS Code:** open your project's folder, open the terminal (`Ctrl + backtick`), and type `claude`.

### 5. Open the pane and log in

1. Type `/imagine` and press Enter. The **Imagine** pane opens.
2. If it says Codex is not installed, press **Install Codex (npm)** and wait for the "Codex is installed" message.
3. Press **Log in with ChatGPT**. Your browser opens. Sign in to ChatGPT and allow access, then come back to the terminal.

### 6. Make your first image

Type this and press Enter:

```
/imagine a cozy cafe logo, flat style
```

Wait about a minute. When it's ready, a message says the image is ready in the Imagine pane.

### 7. Where is my image?

- **In the pane.** Ghostty and kitty show a small preview. Terminal.app and VS Code's terminal **only show the file name**: that's normal, the image is there. Press **Open** to see it.
- **In your Pictures folder.** The mod keeps a copy of every image in **Pictures → Imagine**, named after your description (for example `a-cozy-cafe-logo.png`). **Open** and **Show in folder** use this copy.
- **Not in your project yet.** The image goes into your project only when you press **Add to project**. That copies it into the folder shown as **Project folder** in the pane (for example `public/images`).
- **To drag it somewhere** (VS Code, Figma, CapCut): press **Show in folder**. Finder (or Files) opens with the image selected, and you drag it from there.

After **Add to project**, press **Mention it in my prompt** and ask Claude something like "put this image in the hero section".

### If something goes wrong

| You see | What to do |
| --- | --- |
| `/imagine` is an unknown command | The mod isn't loaded. Type `/plugin`, open **imagine**, and look at its **Errors** tab. If imagine isn't listed, do step 3 again. Then quit Claude Code (`/exit`) and start it again. |
| "npm was not found" | Install Node.js (step 1), close the terminal, open a new one, and start Claude Code again. |
| "Codex CLI is not installed yet" | Open the pane with `/imagine` and press **Install Codex (npm)**. Then press **Check again**. |
| "Claude Code could not run codex" | Codex is installed, but Claude Code can't find it. In a normal terminal type `which codex` and copy the line it prints. In Claude Code, type `/plugin`, open **imagine**, paste that line into the **Codex command** field, and choose **Save configuration**. Then quit and start Claude Code again. |
| No browser window opens when you log in (for example over SSH) | Type `/imagine login code`. Open the link the pane shows, sign in, and type the code it shows. |
| "Codex is logged in with an API key…" | Images only work with a ChatGPT login. In a terminal type `codex logout`, then press **Log in with ChatGPT** in the pane. |
| "no image" or "Codex finished without making an image" | Check that your ChatGPT plan is Plus or higher. If you made many images today, you may have hit your plan's limit: wait and try later. |
| "is no longer on disk" when you press **Add to project** or **Open** | You have an older version of the mod. Get the update (end of step 3). |
| The pane shows a file name but no picture | Your terminal can't show images (only Ghostty and kitty can). Press **Open** to see it. |
| "could not add …" | The project folder may be wrong or not writable. Change **Project folder** in the pane, for example to `public/images`. |

## Install

In Claude Code, from any folder, type:

```
/plugin install imagine --marketplace romanlucian/claude-imagine
```

Answer `y` to add the marketplace, then press Enter for the user scope. If it asks for **Codex command**, keep `codex` and press Enter. The mod then works in every project.

This works because this repo is also a plugin marketplace: `.claude-plugin/marketplace.json` lists the mod.

To get a newer version later:

```bash
claude plugin marketplace update imagine
claude plugin update imagine@imagine
```

**Developing the mod:** clone this repo and run `claude --plugin-dir .` inside it to load your working copy instead.

## Use it

| Type | What happens |
| --- | --- |
| `/imagine` | Opens the Imagine pane |
| `/imagine login` | Logs in with ChatGPT in your browser |
| `/imagine login code` | Logs in with a link and a one-time code. Use this when Claude Code runs over SSH or no browser opens. |
| `/imagine a cozy cafe logo, flat style` | Generates one image |
| `/imagine 3x a cozy cafe logo, flat style` | Generates 3 variations (up to 4) |
| `/imagine edit make the background blue` | Makes a new version of the latest image with that change |

You can also type the description straight into the pane's **Describe an image** field.

Images are added to the project Claude Code was started in. In VS Code: open your app's folder, open the terminal (Ctrl + `), and type `claude`.

Each image in the pane has these buttons:

- **Select**: tick several, then press **Add N selected images to project**.
- **Add to project**: copies just this one. The file gets a name from your description, such as `cozy-cafe-logo.png`, and existing files are never overwritten (`-2`, `-3`…).
- **Open**: opens the image in your image viewer.
- **Show in folder**: opens Finder (Mac) or Files (Ubuntu) with the image selected. **Drag and drop it from there** into VS Code, Figma, CapCut, anywhere.
- **Edit**: type what to change ("make the background blue") and press Enter. Codex continues the same conversation that drew the image, like asking ChatGPT for changes, and the new version appears in the list next to the old one. You can edit the new version again.

**Project folder** sets where images go. It's remembered per project.

After adding, **Mention it in my prompt** puts `@public/images/…` in your prompt, so you can ask Claude to use the image ("put this in the hero section").

**Previews:** in Ghostty and kitty the pane shows thumbnails. Other terminals show just the file name, so use **Open** to look.

## Good to know

- Every image is also saved in **`~/Pictures/Imagine`** (Finder: Pictures → Imagine), named from your description. The buttons use this copy, because Codex's own file in `~/.codex/generated_images/` can disappear. **Clear list** only empties the pane.
- A terminal can't drag files out of itself. That's why **Show in folder** exists: drag from Finder/Files instead.
- Over SSH (for example VS Code Remote-SSH), **Open** and **Show in folder** open on the machine Claude Code runs on.
- **"Claude Code could not run codex"** even though Codex is installed: Claude Code didn't get the same `PATH` as your terminal. Run `which codex` in a terminal, then put that full path in this plugin's **Codex command** option.

## How it works

- Login: `codex login` or `codex login --device-auth`. Codex keeps the login in `~/.codex/`. This mod never sees your password or tokens.
- Generating: `codex exec --json --sandbox read-only -`, asking Codex's built-in `$imagegen` skill for the image(s). The sandbox stops Codex from changing any files; its image tool still saves each picture. Codex's JSON output doesn't list the images, so the mod reads the request's id from it (`thread.started`) and watches that request's folder, `~/.codex/generated_images/<id>/`. Each image shows up in the pane as soon as it's saved, and the mod copies it to `~/Pictures/Imagine` right away (and again when Codex finishes).
- Editing: `codex exec ... resume <id> -` continues the image's own Codex run, so Codex still has the image and the conversation. The new version lands in the same run folder; the mod skips the files that were already there.
- Adding: `mkdir -p` and `cp` into the project folder.

## Developing

```bash
claude plugin validate .   # what the engine will load, and anything it would refuse
claude plugin test .       # tests/imagine.test.ts, with Codex faked
```

## License

MIT, see [LICENSE](LICENSE).

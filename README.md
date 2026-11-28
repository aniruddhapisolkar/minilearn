# minilearn

A quiet, local-first AI learning workspace. Make your own curriculum, build understanding one step at a time, and keep control of everything you create.

minilearn is derived from [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist. It retains the original project's pedagogical principles while replacing its desktop-oriented application with a small browser interface and independent learning projects. LearnHarness and minilearn are licensed under the [AGPL-3.0](LICENSE).

## Get started

Download the native macOS desktop app (macOS 11 or later, no terminal or Node.js required). Builds are published automatically whenever `main` passes its checks:

- **[Download for Mac — Apple Silicon (M1 / M2 / M3 / M4+)](https://github.com/aniruddhapisolkar/minilearn/releases/latest/download/minilearn-mac-apple-silicon.dmg)**
- **[Download for Mac — Intel](https://github.com/aniruddhapisolkar/minilearn/releases/latest/download/minilearn-mac-intel.dmg)**

1. Open the downloaded `.dmg` file.
2. Drag **minilearn** into **Applications**.
3. Open **minilearn** from Applications.

> **First-launch Gatekeeper note:** Because these open-source macOS releases are unsigned, macOS Gatekeeper may block the first launch. Control-click (or right-click) **minilearn** in Applications and choose **Open → Open**; on newer macOS versions, if macOS still blocks it after trying to open, go to **System Settings → Privacy & Security** and click **Open Anyway**. Later launches open normally.

minilearn runs locally on your computer; no account or app subscription is required:

1. Click **Add a provider key** in the bottom dock, or open **Settings → Providers**. Choose OpenAI, Anthropic, Google Gemini, OpenCode, or an OpenAI-compatible endpoint. Paste a key if needed, find or enter a model, and test the connection. For local servers, minilearn provides Ollama, LM Studio, and llama.cpp presets.
2. Create a learning project from the sidebar. Add modules and lessons yourself, paste an outline, or chat with the curriculum planner using the Curriculum button in the project toolbar. Review proposed changes before applying them.
3. Open any lesson, or start a teaching or practice session directly from the graph home's bottom composer. New topics can be inserted into any module. The tutor adapts to your understanding and records demonstrated concepts in the project's knowledge graph.

**OpenCode:** Select **OpenCode Go** for a Go subscription or **OpenCode (pay-as-you-go)** for workspace credits. Paste your Console API key and click **Find models**, then **Test & connect**. minilearn uses the official [Console inference endpoints](https://opencode.ai/docs/console/api/inference/) and sends its own user agent and stable, opaque conversation routing IDs. No header or URL configuration is needed. Go is intended for [coding-agent workloads](https://opencode.ai/docs/console/go/#where-can-i-use-it); general tutoring may be restricted, and successful requests are subject to your plan and provider's terms. Free chat models available only in OpenCode are not unlocked by minilearn.

### Run from source / other platforms

**[Download minilearn.zip](https://github.com/aniruddhapisolkar/minilearn/releases/latest/download/minilearn.zip)** — the latest tested source archive, which extracts to a folder named `minilearn`.

Install [Node.js](https://nodejs.org/) 22 or later, open a terminal in the extracted `minilearn` folder, and run:

```sh
npm start
```

The first launch automatically installs the runtime dependencies (internet access is needed once). Later launches reuse them without downloading anything unless an update requires new dependencies. Open **http://127.0.0.1:3210** in your browser. The server listens on your computer only.

## Your workspace

- **Curriculum:** Add, edit, reorder, move, or delete any topic within a module. AI can propose precise edits anywhere in the existing curriculum without changing unrelated lessons. Existing lesson IDs carry their sessions and progress when moved.
- **Learn and practice:** Learner-paced teaching, reasoning checks, problems, feedback, and hints. Predictions and checks can appear in dedicated answer cards with choices, a confidence slider, and a thinking field. Keep separate sessions for each lesson, delete individual exchanges, and save useful replies as editable study notes.
- **Web search:** Turn on Web search beside the composer to let your connected model request a search during teaching, practice, or curriculum planning. Exa's [keyless MCP service](https://exa.ai/mcp) is used first; if unavailable, rate-limited, or empty, minilearn tries [Purili's public search API](https://puri.li/developer). No separate account, search API key, dependency, or configuration is needed. Search is off by default, resets on reload, and sends a short model-generated query to these external services when enabled. Retrieved excerpts are sent to your connected AI model for the answer; its ordinary token charges still apply. Expand web sources to inspect clickable references or see any search failure. Query and source links are stored with that conversation and included in history exports; clearing the conversation also clears them locally. Search coverage and availability depend on the free services; results may be indexed rather than live page contents.
- **Study materials:** Upload local files; they are copied into the project. Select which files the tutor receives. Text, images, and PDFs are supported as model inputs when the selected provider/model accepts them.
- **Knowledge map:** Inspect claims and their dependencies using a calm, layered graph. Pan, zoom, fit, search, filter by lesson, switch to a list, and inspect or delete individual concepts.
- **Data & export:** See how much data is stored, selectively clear four independent categories, export `.learn` files, and permanently delete projects.

## Data belongs to you

Where minilearn stores your data depends on how you run it:

- **Mac desktop app:** Settings and projects are stored in `~/Library/Application Support/minilearn/` by default, outside the `.app` bundle, so replacing `minilearn` in Applications to update the app keeps all of your data intact. Set `MINILEARN_DATA_DIR` before launching if you want a custom directory.
- **Source / Node.js install (`npm start`):** Data is portable inside `./data/` under the extracted `minilearn/` directory (`./data/.npm-cache/`, `settings.json`, and `projects/`). Set `MINILEARN_DATA_DIR` to store data elsewhere, or `PORT` to change the local server port (`3210` by default).

```text
~/Library/Application Support/minilearn/   # Mac desktop app default (or ./data/ for source installs)
├── settings.json                          # model credentials and settings
└── projects/                              # independent learning projects
```

Each project is a local, human-readable directory:

```text
projects/<project-id>/
├── project.json
├── curriculum.json
├── materials/          # source files and their index
├── generated/          # saved study notes
├── learning-history/   # sessions, progress, map, planner conversation
└── cache/              # disposable local data
```

The application itself is shared, but no project depends on another project's data. The server sends only your current project's relevant context and explicitly selected source files to the configured model. Model keys are stored in local `settings.json`, outside every project, and never included in an export. Remove a connection to remove its stored key.

**Migrating existing data:** Earlier installs used `~/.minilearn/`, and source installs default to `./data/`. Neither folder is moved or deleted automatically. Quit minilearn (or stop the Node server), confirm the destination data folder (`~/Library/Application Support/minilearn/` for the Mac app, or `./data/` for source installs) has no learning projects or settings you want to keep, and copy `projects/` and `settings.json` (if present) into it without overwriting existing data. Reopen minilearn and verify your projects and model connections before removing the old folder. Alternatively, set `MINILEARN_DATA_DIR` to point directly at your existing folder.

**Uninstalling cleanly:**
- **Mac desktop app:** Quit minilearn and move **minilearn** from Applications to Trash. To also erase all locally stored projects, caches, and model credentials, delete `~/Library/Application Support/minilearn/`.
- **Source install:** Stop the server and delete the entire `minilearn/` folder (and any custom `MINILEARN_DATA_DIR`, if set).

Node.js itself, browser history or caches from earlier browser sessions, shell history, manually exported `.learn` files, and data retained by AI providers remain outside minilearn's folders.

Export a full project, or select just the categories you want to share. A `.learn` file is a versioned JSON container with embedded project files; it contains no executable application or external file references and can be imported as a new independent project. The current version supports projects up to 100 MB of data per export/import and individual uploads up to 20 MB.

Clearing data is permanent. Export a backup first if needed. Deleting a project removes its entire directory. There is no background sync or hidden trash. Clearing local data cannot erase information retained independently by your AI provider. Provider requests are billed and processed according to that provider's policies, including the small connection-test request. Local endpoints can be used without a cloud provider.

## Development

JavaScript / Node.js checks and source server:

```sh
npm ci          # install development dependencies
npm run dev     # watch Node server source
npm test        # storage, import/export, search, UI, and provider/tutor API tests
npm run check   # syntax checks
```

Mac desktop app (requires Rust stable via `rustup`, `tauri-cli` v2, and Node.js 22+):

```sh
node scripts/prepare-tauri-assets.mjs            # bundle frontend vendor assets into src-tauri/vendor/
cargo test --manifest-path src-tauri/Cargo.toml  # Rust storage, AI/search, and HTTP server tests
cargo tauri dev                                  # run the Mac desktop app in development mode
cargo tauri build                                # build minilearn.app and .dmg bundle
```

For the Mac desktop app, a native Rust + Tauri v2 shell (`src-tauri/`) embeds a local Axum HTTP/AI engine alongside the bundled static UI (`web/` and prepared vendor assets) and opens it inside a native macOS window. For source and cross-platform installs, the Node HTTP server (`server/`) serves the same browser UI (`web/`) and `/vendor/*` assets.

The interface follows LearnHarness's original application layout: a session sidebar with search and filters, full-bleed knowledge graph, bottom composer dock, split-pane provider settings, and teaching answer cards. It retains the original dark palette and uses JetBrains Mono throughout the text interface, including titles, reading text, and controls. The font is bundled locally with its open font license in `web/fonts/`; no font service or additional runtime dependency is needed. Provider requests run server-side. Markdown is sanitized before rendering, and KaTeX renders mathematical notation locally with its mathematical fonts. The runtime has no Electron, plugin system, desktop subscription integration, or external frontend service.

The original LearnHarness teaching and practice doctrine files are retained in `src/agent/prompts/` and adapted to the minilearn tutor's provider-neutral conversational contract.

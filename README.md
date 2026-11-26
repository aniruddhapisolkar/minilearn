# minilearn

A quiet, local-first AI learning workspace. Make your own curriculum, build understanding one step at a time, and keep control of everything you create.

minilearn is derived from [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist. It retains the original project's pedagogical principles while replacing its desktop-oriented application with a small browser interface and independent learning projects. LearnHarness and minilearn are licensed under the [AGPL-3.0](LICENSE).

## Get started

Install [Node.js](https://nodejs.org/) 22 or later, then run:

```sh
npm ci --omit=dev
npm start
```

Open **http://127.0.0.1:3210** in your browser. The server listens on your computer only; no account or app subscription is required.

1. Click **Connect model**. Choose OpenAI, Anthropic, Google Gemini, or an OpenAI-compatible endpoint. Paste a key if needed, find or enter a model, and test the connection. For local servers, minilearn provides Ollama, LM Studio, and llama.cpp presets.
2. Create a learning project. Add modules and lessons yourself, paste an outline, or chat with the curriculum planner. Review proposed changes before applying them.
3. Open any lesson to learn or practice. The tutor adapts to your understanding and records demonstrated concepts in an optional knowledge map.

## Your workspace

- **Curriculum:** Add, edit, reorder, move, or delete any topic within a module. AI can propose precise edits anywhere in the existing curriculum without changing unrelated lessons. Existing lesson IDs carry their sessions and progress when moved.
- **Learn and practice:** Learner-paced teaching, reasoning checks, problems, feedback, and hints. Keep separate sessions for each lesson, delete individual exchanges, and save useful replies as editable study notes.
- **Study materials:** Upload local files; they are copied into the project. Select which files the tutor receives. Text, images, and PDFs are supported as model inputs when the selected provider/model accepts them.
- **Knowledge map:** Inspect claims and their dependencies using a calm, layered graph. Pan, zoom, fit, search, filter by lesson, switch to a list, and inspect or delete individual concepts.
- **Data & export:** See how much data is stored, selectively clear four independent categories, export `.learn` files, and permanently delete projects.

## Data belongs to you

By default, minilearn is fully portable: its code, installed dependencies, npm cache and logs, model credentials, and learning data stay under the application directory. Run `npm ci` and `npm start` from the installation directory. Set `MINILEARN_DATA_DIR` only if you deliberately want a different data location; set `PORT` to change the local server port.

```text
minilearn/
├── server/             # application server
├── web/                # browser interface
├── node_modules/       # installed dependencies
└── data/
    ├── .npm-cache/     # local npm cache and logs
    ├── settings.json   # model credentials and settings
    └── projects/      # independent learning projects
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

The application itself is shared, but no project depends on another project's data. The server sends only your current project's relevant context and explicitly selected source files to the configured model. Model keys are stored in the installation's local `settings.json`, outside every project, and never included in an export. Remove a connection to remove its stored key.

To uninstall, stop the server and delete the entire minilearn folder. This removes all files managed by this installation, including project caches and locally stored credentials. Node.js itself, browser history or caches from earlier versions, shell history, manually exported `.learn` files, and data retained by AI providers remain outside that folder.

**Migrating from the previous storage layout:** Older minilearn installs used `~/.minilearn/`. That directory is never moved or deleted automatically. Stop the server, check that the new `data/` folder has no learning projects or settings, then copy the old `projects/` and `settings.json` (if present) into the new `data/` folder without overwriting existing data. Restart and verify your projects and model connections before removing the old folder. Alternatively, set `MINILEARN_DATA_DIR` to the original directory to keep using it.

Export a full project, or select just the categories you want to share. A `.learn` file is a versioned JSON container with embedded project files; it contains no executable application or external file references and can be imported as a new independent project. The current version supports projects up to 100 MB of data per export/import and individual uploads up to 20 MB.

Clearing data is permanent. Export a backup first if needed. Deleting a project removes its entire directory. There is no background sync or hidden trash. Clearing local data cannot erase information retained independently by your AI provider. Provider requests are billed and processed according to that provider's policies, including the small connection-test request. Local endpoints can be used without a cloud provider.

## Development

```sh
npm ci         # install development dependencies
npm run dev   # watch server source
npm test      # storage, import/export, and provider/tutor API tests
npm run check # syntax checks
```

The app consists of a small Node HTTP server (`server/`) and a static browser UI (`web/`). Provider requests run server-side. Markdown is sanitized before rendering, and KaTeX renders mathematical notation locally. The runtime has no Electron, plugin system, desktop subscription integration, or external frontend service.

The original LearnHarness teaching and practice doctrine files are retained in `src/agent/prompts/` and adapted to the minilearn tutor's provider-neutral conversational contract.

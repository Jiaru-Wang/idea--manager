# IdeaMiner

IdeaMiner is a local-first research idea manager built with React, TypeScript, FastAPI, SQLite FTS5, and Cytoscape.js. It captures ideas without rewriting the original text, organizes them into projects, and visualizes how they develop and connect.

Your SQLite database is the canonical source of truth. The core application runs locally and does not require an account, cloud database, or API key.

## Features

- Idea CRUD with immutable original captures and editable Markdown/LaTeX notes
- Projects, project groups, recycle bin, move/copy actions, and bulk cleanup
- Tags, tag groups, deterministic group colors, co-occurrence Tag Map, and bulk tag management
- FTS5 keyword search, filters, related-idea suggestions, graph view, and lineage tracking
- Local-file references that store paths and metadata without embedding file contents
- JSON import/export and Markdown export
- Weekly review, local semantic discovery, and cross-project Dream synthesis
- Optional Agent workspace for OpenAI, DeepSeek, or compatible Responses APIs
- Optional MCP bridge for using the same library from Codex

## Quick start on Windows

### Requirements

Install these once:

- [Python 3.11 or newer](https://www.python.org/downloads/windows/) — enable **Add Python to PATH** during installation
- [Node.js LTS](https://nodejs.org/) — includes npm

Then:

1. Download and extract this repository, or clone it with Git.
2. Double-click **`start-ideaminer.bat`**.
3. On the first run, allow the setup window to create `.venv` and install the locked dependencies.
4. Keep the IdeaMiner command window open while using the app.

The browser normally opens at [http://127.0.0.1:5173](http://127.0.0.1:5173). If another IdeaMiner copy is running, the launcher automatically chooses free web/API ports and connects only to this folder's backend. The command window prints the exact database and addresses. Later starts skip installation and open much faster. To stop cleanly, use **Quit** in IdeaMiner or press `Ctrl+C` in its command window.

## Manual setup on Windows, macOS, or Linux

From a terminal in the repository:

```bash
python -m venv .venv
```

Activate the environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS or Linux
source .venv/bin/activate
```

Install and run:

```bash
python -m pip install -r backend/requirements.txt
npm ci
python launcher.py
```

The coordinated launcher starts FastAPI on port 8000 and Vite on port 5173, opens the browser, and shuts both services down together.

## First launch and storage

IdeaMiner automatically creates `data/ideaminer.db` on first launch, including the built-in `random_chat` and `recycle` projects. That database, its backups, `.env` files, dependencies, and build artifacts are ignored by Git.

Never commit the `data` directory contents: they can contain idea text, agent history, file paths, and other private research material. The repository intentionally includes only `data/.gitkeep`.

For backups, stop IdeaMiner and copy `data/ideaminer.db` somewhere safe. For sharing selected knowledge with another IdeaMiner user, use **Export → JSON** and let the recipient use **Import**.

## Agent connections

The application works fully without an LLM. To use the optional Agent or Dream tools, open **Agent** and enter the provider, key, model, and base URL. Session credentials remain only in the backend process memory and disappear when IdeaMiner quits.

OpenAI and DeepSeek presets are included. A custom provider must expose an OpenAI-compatible Responses API. The included `.env.example` is a reference list only; IdeaMiner does not automatically load it. Set persistent values in your shell or operating-system environment, or continue using the safer in-app session form.

Original `raw_text` captures are excluded from online Agent context. Selected working notes and explicitly selected compatible local files may be sent to the configured provider for a run.

## Everyday workflow

- Create a project, or use `random_chat` for temporary captures.
- Write notes with Markdown and KaTeX (`$...$` inline and `$$...$$` for display equations).
- Use `develops-into` relations and the **Lineage** view to follow an idea track.
- Open **Tags → settings → Tag map** to see tag co-occurrence in the selected scope.
- Deleted ideas first move to **Recycle**. Deleting them there is permanent.
- Agent and Dream results remain reviewable proposals until you apply them.

## Import and export

**Export → JSON** produces a versioned library file containing groups, projects, ideas, original captures, tags, timestamps, and typed relations. Import previews conflicts and can skip, copy, or update matching ideas inside one SQLite transaction.

Markdown export is intended for reading. Local attachment contents are never bundled; exports contain only library records and references.

## Optional Codex integration

`ideaminer_mcp.py` is the stable stdio entry point for the included MCP server. The reusable Codex skill source is under `integrations/codex/ideaminer`. Point your local MCP configuration at this repository's Python interpreter and `ideaminer_mcp.py`, with the working directory set to the repository root.

The MCP bridge reads and writes the same SQLite database and supports projects, search, capture, editing with optimistic concurrency, typed relations, move/copy, attachments, and review checkpoints. It does not expose permanent deletion.

## Development

With the environment and packages installed:

```bash
# Backend tests
python -m pytest backend/tests -q

# Frontend development server only
npm run dev

# Type-check and production build
npm run build
```

Useful local addresses:

- Web interface: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- API documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

## Architecture

- `src/` — React + TypeScript interface
- `backend/app/` — FastAPI routes, SQLite schema/migrations, search, agents, and MCP tools
- `backend/tests/` — API and MCP protocol tests
- `data/` — ignored local library state
- `launcher.py` — coordinated API/frontend lifecycle and in-app Quit support
- `integrations/` — optional Codex skill source

`ideas.raw_text` preserves the original capture. Editable content and revisions live separately. FTS5 indexes searchable text, while `idea_embeddings` is isolated so a different semantic-vector implementation can be added without changing idea records.

## Troubleshooting

- **Python was not found:** install Python 3.11+ and enable its PATH option, then reopen the launcher.
- **npm was not found:** install Node.js LTS and reopen the launcher.
- **PowerShell blocks activation:** activation is unnecessary when using `start-ideaminer.bat`; it calls the environment's Python directly.
- **Dependency installation failed:** confirm internet access, delete the incomplete `.venv` or `node_modules`, and run the launcher again.
- **A port is already in use:** quit any older IdeaMiner process using ports 8000 or 5173.
- **The browser did not open:** wait for the launcher to report readiness, then visit `http://127.0.0.1:5173` manually.

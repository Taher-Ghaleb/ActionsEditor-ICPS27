# Actions Editor

Actions Editor is a web-based editor for GitHub Actions workflows. It provides YAML editing, a visual workflow designer, graph views, project and file management, GitHub integration, and local session persistence.

The frontend uses React and Vite. An optional Python backend provides API endpoints and SQLite storage.

## Live Demo

https://actions-editor.vercel.app

## Run with Docker

### 1. Pull the Docker image

```bash
docker pull elizabetvie/actions-editor:latest
```

### 2. Run the application

```bash
docker run -p 3000:80 elizabetvie/actions-editor
```

### 3. Open the application

Visit http://localhost:3000.

### Using Docker Compose

Alternatively, run:

```bash
docker compose up --build
```

To stop the application:

```bash
docker compose down
```

## Features

- Multi-project workspace with multiple workflow files
- File explorer with rename, close, collapse, and delete operations
- Workflow explorer showing jobs, structure, and lint results
- Syntax-highlighted YAML editor with line navigation
- Form-based editor for workflow fields, jobs, and steps
- Visual workflow graph and split editing views
- GitHub Actions, CircleCI, and Travis CI previews
- Built-in workflow templates
- Diff view and live linting
- Per-file undo/redo history
- Automatic session persistence and restoration
- File download and save support
- GitHub repository import and save using a Personal Access Token
- Confirmation dialogs for destructive operations
- AI assistant with Gemini and OpenAI-compatible provider support
- Feedback form
- Optional Python backend with SQLite storage

## Current Capabilities

### Workflow Editing

Actions Editor supports two editing modes:

- **YAML Editor:** Edit workflow YAML directly.
- **Design Editor:** Configure workflows using forms for triggers, permissions, jobs, and steps.

Both modes use the same workflow state, allowing users to switch between views.

### Workspace Management

Users can:

- Manage multiple projects and workflow files
- Rename projects and files
- Expand or collapse projects in the file explorer
- Close files
- Delete projects

The workspace is saved in browser storage, including:

- Projects and files
- Active project and file
- Workflow contents
- Undo/redo history
- Active view and split mode
- Zoom and graph layout

Sessions are restored automatically after refreshing or reopening the application.

### Data Protection

The editor includes:

- Unsaved-change prompts
- Confirmation dialogs for destructive operations
- Automatic session persistence
- Linting for syntax and workflow configuration issues

### Preview and Export

The preview system supports:

- GitHub Actions YAML
- CircleCI configuration
- Travis CI configuration

Preview output can be copied or saved separately from the main workflow file.

### GitHub Integration

GitHub integration uses a Personal Access Token and supports:

- Importing workflows from public repositories
- Importing workflows from private repositories with authentication
- Saving workflows to repositories
- Checking token permissions and warning about missing scopes

### AI Assistant

The AI assistant supports user-provided API keys and a limited Gemini demo.

Provider settings, including the API key and selected model, are stored in the browser's `localStorage`. API keys, prompts, and responses are not stored in the application's SQLite database.

Supported providers:

- **Google Gemini:** Requests are sent directly from the browser. Create an API key at [Google AI Studio](https://aistudio.google.com/app/apikey). Restrict the key by HTTP referrer to the application's domain. This option works with the Vercel deployment and local frontend.
- **Custom (OpenAI-compatible):** Requests are sent through the local backend at `POST /api/ai/chat`. The endpoint forwards requests without storing their contents in SQLite. This option requires the local backend (`npm run backend` or `npm run dev:full`) and is unavailable on the static Vercel deployment.

#### Gemini Demo

When Gemini is selected without an API key, the assistant can use a rate-limited demo endpoint at `/api/ai-demo`.

The endpoint is implemented as a Vercel serverless function (`api/ai-demo.js`) and uses a server-side `GEMINI_API_KEY` environment variable.

- Limit: 20 requests per hour per IP (best-effort)
- No API key required from the user
- A `Demo` badge indicates when demo mode is active
- Requires `GEMINI_API_KEY` to be configured in Vercel environment variables

If the demo key is not configured, the endpoint returns HTTP 503.

### Feedback

The `Rate` button opens a [Google feedback form](https://forms.gle/WM27fEbjykeKfkK49) in a new browser tab.

## Architecture

### High-Level Design

The application uses a React frontend with an optional Python backend.

```text
+---------------------------+
| React + Vite Frontend     |
|---------------------------|
| Workspace management      |
| YAML generation/parsing   |
| Visual editor             |
| Preview and diff views    |
| GitHub API integration    |
| Local session persistence |
+-------------+-------------+
              |
              | /api (local dev proxy)
              v
+---------------------------+
| Python Backend            |
|---------------------------|
| HTTP endpoints            |
| SQLite database access    |
| AI request proxy          |
+-------------+-------------+
              |
              v
+---------------------------+
| SQLite                    |
|---------------------------|
| ratings table             |
+---------------------------+
```

### Frontend State Model

The frontend maintains the workspace in memory and saves it to browser storage.

The main state categories are:

- **Workspace:** Projects, files, active project, and active file
- **Contents:** Workflow objects for each file
- **History:** Per-file undo and redo stacks
- **Views:** Active view, split mode, zoom, and graph layout
- **Interface:** Dialogs, confirmations, line selection, and focus

### Data Flow

1. A workflow file is selected.
2. The application loads its workflow object.
3. The editor, designer, graph, and preview render from the workflow state.
4. Changes update the workflow and mark the file as modified.
5. Undo/redo history is updated.
6. The workspace is saved to browser storage.

### Backend

The optional backend:

- Uses Python's standard library HTTP server
- Stores data in SQLite
- Initializes the database schema on startup
- Exposes JSON API endpoints
- Proxies OpenAI-compatible AI requests

The SQLite schema includes a `ratings` table.

### Persistence

The application uses two storage mechanisms:

- **Browser `localStorage`:** Workspace contents, editing history, and session restoration
- **SQLite:** Backend data stored at `backend/data/actions-editor.sqlite`

## Repository Structure

```text
.
├── api/
│   ├── ai-demo.js
│   └── _lib/
│       └── geminiDemo.js
├── backend/
│   ├── data/
│   │   └── .gitkeep
│   └── server.py
├── dist/
├── docs/
│   └── project_paper_pack.md
├── scripts/
│   └── dev.mjs
├── src/
│   ├── components/
│   │   ├── AIPanel.jsx
│   │   ├── DesignPanel.jsx
│   │   ├── EditorView.jsx
│   │   ├── FileSidebar.jsx
│   │   ├── Modals.jsx
│   │   ├── ProjectBar.jsx
│   │   ├── Sidebar.jsx
│   │   ├── StatusBar.jsx
│   │   ├── TabBar.jsx
│   │   ├── Toast.jsx
│   │   ├── Toolbar.jsx
│   │   ├── TopBar.jsx
│   │   ├── Views.jsx
│   │   └── VisualGraph.jsx
│   ├── data/
│   │   ├── constants.js
│   │   └── templates.js
│   ├── hooks/
│   │   └── index.js
│   ├── styles/
│   │   ├── components.css
│   │   └── global.css
│   ├── utils/
│   │   ├── ciPreviewGenerator.js
│   │   ├── highlighter.jsx
│   │   ├── lineNavigation.js
│   │   ├── linter.js
│   │   ├── yamlGenerator.js
│   │   └── yamlParser.js
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Technology Stack

### Frontend

- React 18
- Vite 5
- js-yaml

### Backend

- Python 3
- SQLite 3
- Python standard library HTTP server

### External Services

- GitHub REST API
- Google Forms
- Google Gemini API
- OpenAI-compatible APIs

## Testing

Run the JavaScript unit tests:

```bash
npm test
```

The test suite contains 81 cases covering YAML generation, linting, AI providers, the Gemini demo, and workflow corpus regressions.

Run the Python backend tests:

```bash
npm run test:backend
```

The backend suite contains 8 cases covering the AI proxy endpoint.

Test files include comments describing inputs and expected outcomes.

### Evaluation with Real-World Workflows

The `tests/fixtures/corpus/` directory contains 10 workflow files from two open-source repositories:

- `checkstyle/checkstyle`
- `pytorch/pytorch`

The corpus covers:

- Matrix builds
- Multi-job dependency chains using `needs`
- Workflow permissions
- Reusable workflow definitions and calls
- Scheduled triggers
- Typed `workflow_dispatch` and `workflow_call` inputs

The `tests/fixtures/corpus/manifest.json` file records the source and selection rationale for each workflow.

Run the linter evaluation:

```bash
node scripts/evalLinter.mjs
```

Results are written to `tests/fixtures/linter-report.json`.

Run the YAML round-trip evaluation:

```bash
node scripts/evalRoundTrip.mjs
```

This checks parse → generate → parse consistency and writes results to `tests/fixtures/roundtrip-report.json`.

## Getting Started

### Prerequisites

- Node.js 20+ (recommended)
- npm
- Python 3 (for the backend)
- SQLite 3 CLI (optional, for database inspection)

### Install Dependencies

```bash
npm install
```

## Running the App

### Frontend Only

```bash
npm run dev
```

Open http://localhost:3000.

### Backend Only

```bash
npm run backend
```

The backend runs at http://127.0.0.1:8787.

### Frontend and Backend

```bash
npm run dev:full
```

This starts both servers. Vite proxies `/api/*` requests to the Python backend.

## Building for Production

```bash
npm run build
```

The production build is generated in `dist/`.

## Backend API

### Health Check

`GET /api/health`

Example response:

```json
{
  "ok": true,
  "database": "/absolute/path/to/backend/data/actions-editor.sqlite"
}
```

### Ratings

`POST /api/ratings`

Request:

```json
{
  "rating": 5,
  "feedback": "Very helpful editor"
}
```

Response:

```json
{
  "ok": true,
  "id": 1
}
```

The endpoint stores ratings in SQLite. The application's `Rate` button opens a Google Form.

### AI Chat Proxy

`POST /api/ai/chat`

Forwards requests to an OpenAI-compatible provider. Requires the local Python backend.

### Gemini Demo

`POST /api/ai-demo`

Provides rate-limited Gemini access through a Vercel serverless function. Requires the `GEMINI_API_KEY` environment variable.

## SQLite Database

Database path:

```text
backend/data/actions-editor.sqlite
```

The `ratings` table contains:

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Primary key |
| `rating` | INTEGER | Rating from 1 to 5 |
| `feedback` | TEXT | Feedback content |
| `source` | TEXT | Feedback source |
| `created_at` | TEXT | ISO timestamp |

Inspect the schema with:

```bash
sqlite3 backend/data/actions-editor.sqlite ".schema ratings"
```

## GitHub Authentication

For private repositories or repository writes, configure a GitHub Personal Access Token with the required permissions:

- `repo`
- `workflow`

The application verifies the token, displays the authenticated GitHub user, and warns about missing scopes.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Citation

```bibtex
@inproceedings{villas2027actionseditor,
  title     = {Actions Editor: Multi-View Navigation and Editing for GitHub Actions Workflows},
  author    = {Villas, Elizabet and Ghaleb, Taher A.},
  booktitle = {Submitted to ICPC 2027},
  year      = {2027}
}
```
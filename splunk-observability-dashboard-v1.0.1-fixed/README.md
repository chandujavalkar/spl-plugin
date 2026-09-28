# AI-Powered Splunk Observability Dashboard Generator

A VS Code extension implementing the requested flow:

`Selected repositories → deterministic evidence extraction → Copilot/VS Code Language Model analysis → telemetry model → operational questions → SPL → Dashboard model → Dashboard Studio JSON → visual designer → copy/export`

## Run

```bash
npm install
npm run compile
```

Open the folder in VS Code and press **F5**. In the Extension Development Host, open a workspace containing the repository you want to analyze. Use **SPLUNK OBSERVABILITY** in the Activity Bar.

Commands include Select Repositories, Analyze Repository, Generate Dashboard, Open Dashboard Designer, Show/Copy/Validate Dashboard JSON, Refresh Analysis, and Import Existing Dashboard.

## AI

The extension uses the official VS Code Language Model API through `vscode.lm.selectChatModels({vendor:'copilot'})`. AI calls are made from user-initiated commands. If no model is available, deterministic evidence-based fallback generation is used so the extension remains usable.

## Safety / telemetry rule

The LLM receives structured repository context, not the whole repository. Common secret files are ignored and source content is redacted before AI context construction. Unsupported telemetry is not promoted to dashboard panels. CPU/memory/disk/tracing/security panels are only generated when evidence exists.

## Cache and incremental analysis

Repository fingerprints are cached under `.vscode/splunk-observability/analysis`. Unchanged repositories reuse the cached analysis; changed files are reported. Cache is ignored by Git.

## Dashboard Studio

The serializer emits the current Dashboard Studio definition structure: `title`, `description`, `inputs`, `defaults`, `visualizations`, `dataSources`, `layout`, `expressions`, and `applicationProperties`. Absolute layout is used so drag/resize maps directly to Dashboard Studio positions.

## Designer

The Webview is the visual editing surface. Extension state is the source of truth. It supports drag/move, resize, delete, duplicate, edit title/SPL, add panels from the library, live JSON, copy, save, and JSON preview.

## Tests and packaging

```bash
npm test
npm run package
```

The sample Java payment service is under `sample-repository/`.

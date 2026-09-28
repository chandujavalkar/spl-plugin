# Architecture

Repository Selector → Repository Analyzer → Dependency/API/Logging/Telemetry analyzers → structured RepositoryAnalysis → AI provider → Operational Questions → SPL Generator → DashboardPanel model → Dashboard Studio serializer/validator → Webview Designer.

The LLM never owns the canonical dashboard JSON. The extension owns a typed intermediate model. Every panel carries source-file evidence, telemetry evidence, the operational question, and reason.

VS Code Webview messages mutate the extension-side dashboard state. Each mutation regenerates Dashboard Studio JSON.

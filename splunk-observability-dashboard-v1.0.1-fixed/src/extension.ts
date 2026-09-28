import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

import { RepositoryAnalyzer } from "./analyzer/repositoryAnalyzer";
import {
    RepositoryAnalysis,
    DashboardDefinition,
    DashboardPanel,
    OperationalQuestion,
    SplQuery
} from "./models";

import { CopilotProvider } from "./ai";

import {
    fallbackQuestions,
    spl,
    panels,
    dashboard,
    studioJson,
    validateJson,
    importStudio
} from "./splunk";


let analyses: RepositoryAnalysis[] = [];
let qs: OperationalQuestion[] = [];
let queries: SplQuery[] = [];

let current: DashboardDefinition | undefined;
let designer: vscode.WebviewPanel | undefined;

let selected = new Set<string>();


/* -------------------------------------------------------------------------- */
/* Repository Tree Provider                                                   */
/* -------------------------------------------------------------------------- */

class RepoProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private readonly eventEmitter =
        new vscode.EventEmitter<void>();

    readonly onDidChangeTreeData =
        this.eventEmitter.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {

        const folders =
            vscode.workspace.workspaceFolders || [];

        return folders.map(folder => {

            const item = new vscode.TreeItem(
                path.basename(folder.uri.fsPath) || folder.name
            );

            item.description =
                folder.uri.fsPath;

            item.iconPath =
                new vscode.ThemeIcon(
                    selected.has(folder.uri.fsPath)
                        ? "check"
                        : "folder"
                );

            item.command = {
                command: "splunkObservability.toggleRepo",
                title: "Toggle Repository",
                arguments: [folder.uri.fsPath]
            };

            return item;
        });
    }

    refresh(): void {
        this.eventEmitter.fire();
    }
}


const repos = new RepoProvider();


/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

export function activate(
    context: vscode.ExtensionContext
): void {

    console.log(
        "[Splunk Observability] Extension activation started"
    );

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            "splunkObservability.repositories",
            repos
        )
    );


    const registerCommand = (
        id: string,
        handler: (...args: any[]) => any
    ): void => {

        context.subscriptions.push(
            vscode.commands.registerCommand(
                id,
                handler
            )
        );
    };


    registerCommand(
        "splunkObservability.selectRepositories",
        select
    );

    registerCommand(
        "splunkObservability.toggleRepo",
        (repoPath: string) => {

            if (selected.has(repoPath)) {
                selected.delete(repoPath);
            } else {
                selected.add(repoPath);
            }

            repos.refresh();
        }
    );

    registerCommand(
        "splunkObservability.analyzeRepositories",
        () => analyze(false)
    );

    registerCommand(
        "splunkObservability.refreshAnalysis",
        () => analyze(true)
    );

    registerCommand(
        "splunkObservability.generateDashboard",
        generate
    );

    registerCommand(
        "splunkObservability.openDesigner",
        openDesigner
    );

    registerCommand(
        "splunkObservability.showDashboardJson",
        showJson
    );

    registerCommand(
        "splunkObservability.copyDashboardJson",
        copyJson
    );

    registerCommand(
        "splunkObservability.validateDashboard",
        validate
    );

    registerCommand(
        "splunkObservability.importDashboard",
        importDashboard
    );


    console.log(
        "[Splunk Observability] Extension activation completed"
    );
}


/* -------------------------------------------------------------------------- */
/* Deactivation                                                               */
/* -------------------------------------------------------------------------- */

export function deactivate(): void {

    if (designer) {
        designer.dispose();
        designer = undefined;
    }

    console.log(
        "[Splunk Observability] Extension deactivated"
    );
}


/* -------------------------------------------------------------------------- */
/* Repository Selection                                                       */
/* -------------------------------------------------------------------------- */

async function select(): Promise<void> {

    const folders =
        vscode.workspace.workspaceFolders || [];

    if (!folders.length) {

        await vscode.window.showErrorMessage(
            "Open a workspace first."
        );

        return;
    }


    const picks = folders.map(folder => ({
        label:
            path.basename(folder.uri.fsPath) ||
            folder.name,

        description:
            folder.uri.fsPath,

        fsPath:
            folder.uri.fsPath,

        picked:
            selected.has(folder.uri.fsPath)
    }));


    const result =
        await vscode.window.showQuickPick(
            picks,
            {
                canPickMany: true,
                title: "Select repositories to analyze"
            }
        );


    if (!result) {
        return;
    }


    selected =
        new Set(
            result.map(item => item.fsPath)
        );


    repos.refresh();
}


/* -------------------------------------------------------------------------- */
/* Repository Analysis                                                        */
/* -------------------------------------------------------------------------- */

async function analyze(
    force: boolean
): Promise<void> {

    if (!selected.size) {

        await select();

        if (!selected.size) {
            return;
        }
    }


    const config =
        vscode.workspace.getConfiguration(
            "splunkObservability"
        );


    try {

        await vscode.window.withProgress(
            {
                location:
                    vscode.ProgressLocation.Notification,

                cancellable: true,

                title:
                    "Splunk Observability"
            },

            async (progress, token) => {

                analyses = [];


                for (const root of selected) {

                    if (token.isCancellationRequested) {
                        return;
                    }


                    const repositoryName =
                        path.basename(root);


                    progress.report({
                        message:
                            "Analyzing " +
                            repositoryName +
                            " — discovering files"
                    });


                    let previous:
                        RepositoryAnalysis | undefined;


                    if (!force) {

                        try {

                            const cacheDirectory =
                                config.get<string>(
                                    "cacheDirectory",
                                    ".vscode/splunk-observability"
                                );


                            const cacheFile =
                                path.join(
                                    root,
                                    cacheDirectory,
                                    "analysis.json"
                                );


                            previous =
                                JSON.parse(
                                    await fs.readFile(
                                        cacheFile,
                                        "utf8"
                                    )
                                );

                        } catch {
                            previous = undefined;
                        }
                    }


                    const analyzer =
                        new RepositoryAnalyzer(
                            config.get<number>(
                                "maxFiles",
                                1500
                            ),

                            config.get<number>(
                                "maxFileBytes",
                                200000
                            ),

                            config.get<string[]>(
                                "excludeDirectories",
                                []
                            )
                        );


                    const analysis =
                        await analyzer.analyze(
                            root,
                            repositoryName,
                            previous
                        );


                    let enriched =
                        analysis;


                    if (
                        token.isCancellationRequested
                    ) {
                        return;
                    }


                    try {

                        progress.report({
                            message:
                                "AI understanding " +
                                repositoryName
                        });


                        const ai =
                            new CopilotProvider();


                        const aiContext = {
                            ...analysis,

                            files:
                                analysis.files
                                    .filter(
                                        file =>
                                            Boolean(file.content)
                                    )
                                    .slice(0, 80)
                                    .map(file => ({
                                        ...file,

                                        content:
                                            String(
                                                file.content
                                            ).slice(
                                                0,
                                                5000
                                            )
                                    }))
                        };


                        const aiAnalysis =
                            await ai.analyzeRepository(
                                aiContext,
                                token
                            );


                        enriched = {
                            ...analysis,
                            ...aiAnalysis,
                            aiGenerated: true
                        };

                    } catch (error) {

                        enriched = {
                            ...analysis,

                            aiGenerated: false,

                            uncertainty: [
                                ...(analysis.uncertainty || []),

                                "AI unavailable: " +
                                (
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                                )
                            ]
                        };
                    }


                    analyses.push(enriched);


                    const cacheDirectory =
                        config.get<string>(
                            "cacheDirectory",
                            ".vscode/splunk-observability"
                        );


                    const cachePath =
                        path.join(
                            root,
                            cacheDirectory
                        );


                    await fs.mkdir(
                        cachePath,
                        {
                            recursive: true
                        }
                    );


                    await fs.writeFile(
                        path.join(
                            cachePath,
                            "analysis.json"
                        ),

                        JSON.stringify(
                            enriched,
                            null,
                            2
                        ),

                        "utf8"
                    );
                }


                if (
                    !token.isCancellationRequested
                ) {

                    await showAnalysis();

                    vscode.window.showInformationMessage(
                        "Analysis complete: " +
                        analyses.length +
                        " repository/repositories."
                    );
                }
            }
        );

    } catch (error) {

        vscode.window.showErrorMessage(
            "Analysis failed: " +
            (
                error instanceof Error
                    ? error.message
                    : String(error)
            )
        );
    }
}


/* -------------------------------------------------------------------------- */
/* Show Repository Analysis                                                  */
/* -------------------------------------------------------------------------- */

async function showAnalysis(): Promise<void> {

    const markdown =
        analyses
            .map(analysis => {

                const technology =
                    analysis.technology || {
                        languages: [],
                        frameworks: []
                    };


                const telemetry =
                    analysis.telemetry || [];


                const uncertainty =
                    analysis.uncertainty || [];


                const strongEvidence =
                    telemetry.filter(
                        item =>
                            item.confidence === "strong"
                    );


                return [
                    "## " + analysis.repository,
                    "",

                    "**Technology:** " +
                    technology.languages.join(", ") +
                    " · " +
                    technology.frameworks.join(", "),

                    "",

                    "**Summary:** " +
                    analysis.applicationSummary,

                    "",

                    "**APIs:** " +
                    analysis.apis.length +
                    "  **Dependencies:** " +
                    analysis.dependencies.length +
                    "  **Logs:** " +
                    analysis.logs.length +
                    "  **Telemetry:** " +
                    (
                        telemetry
                            .map(item => item.name)
                            .join(", ") ||
                        "None detected"
                    ),

                    "",

                    "**Strong evidence:** " +
                    (
                        strongEvidence
                            .map(item => item.name)
                            .join(", ") ||
                        "None"
                    ),

                    "",

                    "**Uncertainty:** " +
                    (
                        uncertainty.join("; ") ||
                        "None"
                    )
                ].join("\n");

            })
            .join("\n\n---\n\n");


    const document =
        await vscode.workspace.openTextDocument({
            language: "markdown",

            content:
                "# Repository Analysis\n\n" +
                markdown
        });


    await vscode.window.showTextDocument(
        document
    );
}


/* -------------------------------------------------------------------------- */
/* Dashboard Generation                                                       */
/* -------------------------------------------------------------------------- */

async function generate(): Promise<void> {

    if (!analyses.length) {

        await vscode.window.showWarningMessage(
            "Analyze a repository first."
        );

        return;
    }


    const config =
        vscode.workspace.getConfiguration(
            "splunkObservability"
        );


    try {

        await vscode.window.withProgress(
            {
                location:
                    vscode.ProgressLocation.Notification,

                cancellable: true,

                title:
                    "Generating dashboard"
            },

            async (progress, token) => {

                qs = [];
                queries = [];


                /* ---------------------------------------------------------- */
                /* Generate operational questions                             */
                /* ---------------------------------------------------------- */

                for (const analysis of analyses) {

                    if (
                        token.isCancellationRequested
                    ) {
                        return;
                    }


                    progress.report({
                        message:
                            "Operational questions — " +
                            analysis.repository
                    });


                    try {

                        const provider =
                            new CopilotProvider();


                        const generatedQuestions =
                            await provider.questions(
                                analysis,
                                token
                            );


                        qs.push(
                            ...generatedQuestions
                        );

                    } catch {

                        qs.push(
                            ...fallbackQuestions(
                                analysis
                            )
                        );
                    }
                }


                /* ---------------------------------------------------------- */
                /* SPL configuration                                          */
                /* ---------------------------------------------------------- */

                const splunkConfig = {

                    index:
                        config.get<string>(
                            "defaultIndex",
                            "application"
                        ),

                    serviceField:
                        config.get<string>(
                            "serviceField",
                            "service"
                        ),

                    levelField:
                        config.get<string>(
                            "logLevelField",
                            "level"
                        )
                };


                /* ---------------------------------------------------------- */
                /* Generate SPL                                                */
                /* ---------------------------------------------------------- */

                for (const analysis of analyses) {

                    if (
                        token.isCancellationRequested
                    ) {
                        return;
                    }


                    progress.report({
                        message:
                            "SPL and panels — " +
                            analysis.repository
                    });


                    let generatedSpl: SplQuery[] = [];


                    try {

                        const provider =
                            new CopilotProvider();


                        generatedSpl =
                            await provider.spl(
                                analysis,
                                qs,
                                token
                            );

                    } catch {

                        generatedSpl = [];
                    }


                    const generatedQueries: SplQuery[] =
    generatedSpl.length > 0
        ? generatedSpl
        : spl(
            analysis,
            qs,
            splunkConfig
        );

const normalizedQueries: SplQuery[] =
    generatedQueries.map((q: any) => ({
        ...q,

        evidence:
            Array.isArray(q.evidence)
                ? q.evidence
                : q.evidence
                    ? [q.evidence]
                    : []
    }));

queries.push(...normalizedQueries);
                }


                /* ---------------------------------------------------------- */
                /* Generate dashboard panels                                   */
                /* ---------------------------------------------------------- */

                let dashboardPanels:
                    DashboardPanel[] = [];


                for (const analysis of analyses) {

                    dashboardPanels.push(
                        ...panels(
                            analysis,
                            queries
                        )
                    );
                }


                /* ---------------------------------------------------------- */
                /* Remove duplicate panels                                     */
                /* ---------------------------------------------------------- */

                dashboardPanels =
                    dashboardPanels.filter(
                        (panel, index, array) =>
                            array.findIndex(
                                candidate =>
                                    candidate.id === panel.id
                            ) === index
                    );


                /* ---------------------------------------------------------- */
                /* Dashboard definition                                         */
                /* ---------------------------------------------------------- */

                const title =
                    analyses.length === 1

                        ? analyses[0].repository +
                          " Observability"

                        : "Service Ecosystem Observability";


                const repositories =
                    analyses.map(
                        analysis =>
                            analysis.repository
                    );


                const frameworks =
                    [
                        ...new Set(
                            analyses.flatMap(
                                analysis =>
                                    analysis
                                        .technology
                                        .frameworks
                            )
                        )
                    ].join(", ");


                current =
                    dashboard(
                        title,
                        repositories,
                        dashboardPanels,
                        frameworks,
                        config.get<string>(
                            "analysisVersion",
                            "1.0"
                        )
                    );


                if (
                    token.isCancellationRequested
                ) {
                    return;
                }


                await openDesigner();

                await saveCacheDashboard();


                vscode.window.showInformationMessage(
                    "Generated " +
                    dashboardPanels.length +
                    " evidence-backed panels."
                );
            }
        );

    } catch (error) {

        vscode.window.showErrorMessage(
            "Dashboard generation failed: " +
            (
                error instanceof Error
                    ? error.message
                    : String(error)
            )
        );
    }
}


/* -------------------------------------------------------------------------- */
/* Dashboard Cache                                                            */
/* -------------------------------------------------------------------------- */

async function saveCacheDashboard(): Promise<void> {

    if (!current) {
        return;
    }


    const root =
        vscode.workspace.workspaceFolders?.[0]
            ?.uri.fsPath;


    if (!root) {
        return;
    }


    const directory =
        path.join(
            root,
            ".vscode",
            "splunk-observability",
            "dashboards"
        );


    await fs.mkdir(
        directory,
        {
            recursive: true
        }
    );


    await fs.writeFile(
        path.join(
            directory,
            "dashboard.json"
        ),

        JSON.stringify(
            current,
            null,
            2
        ),

        "utf8"
    );


    await fs.writeFile(
        path.join(
            directory,
            "dashboard-studio.json"
        ),

        studioJson(current),

        "utf8"
    );


    await fs.writeFile(
        path.join(
            directory,
            "questions.json"
        ),

        JSON.stringify(
            qs,
            null,
            2
        ),

        "utf8"
    );


    await fs.writeFile(
        path.join(
            directory,
            "queries.json"
        ),

        JSON.stringify(
            queries,
            null,
            2
        ),

        "utf8"
    );
}


/* -------------------------------------------------------------------------- */
/* Dashboard Designer                                                         */
/* -------------------------------------------------------------------------- */

async function openDesigner(): Promise<void> {

    if (!current) {

        await vscode.window.showWarningMessage(
            "Generate or import a dashboard first."
        );

        return;
    }


    if (designer) {

        designer.reveal(
            vscode.ViewColumn.One
        );

        send();

        return;
    }


    designer =
        vscode.window.createWebviewPanel(
            "splunkObservability.dashboardDesigner",

            "Dashboard Designer",

            vscode.ViewColumn.One,

            {
                enableScripts: true,

                retainContextWhenHidden: true
            }
        );


    designer.webview.html =
        html();


    const messageDisposable =
        designer.webview.onDidReceiveMessage(
            async message => {

                if (!current) {
                    return;
                }


                try {

                    switch (message.type) {

                        case "move": {

                            const panel =
                                current.panels.find(
                                    item =>
                                        item.id === message.id
                                );


                            if (panel) {

                                panel.position = {
                                    ...panel.position,
                                    ...message.value
                                };
                            }

                            break;
                        }


                        case "resize": {

                            const panel =
                                current.panels.find(
                                    item =>
                                        item.id === message.id
                                );


                            if (panel) {

                                panel.position = {
                                    ...panel.position,
                                    ...message.value
                                };
                            }

                            break;
                        }


                        case "delete": {

                            current.panels =
                                current.panels.filter(
                                    panel =>
                                        panel.id !== message.id
                                );

                            break;
                        }


                        case "duplicate": {

                            const panel =
                                current.panels.find(
                                    item =>
                                        item.id === message.id
                                );


                            if (panel) {

                                const copy =
                                    JSON.parse(
                                        JSON.stringify(panel)
                                    ) as DashboardPanel;


                                copy.id =
                                    panel.id +
                                    "_copy_" +
                                    Date.now();


                                copy.title =
                                    panel.title +
                                    " (Copy)";


                                copy.position = {
                                    ...panel.position,

                                    x:
                                        panel.position.x +
                                        30,

                                    y:
                                        panel.position.y +
                                        30
                                };


                                current.panels.push(
                                    copy
                                );
                            }

                            break;
                        }


                        case "edit": {

                            const panel =
                                current.panels.find(
                                    item =>
                                        item.id === message.id
                                );


                            if (panel) {

                                const title =
                                    await vscode.window.showInputBox({
                                        prompt:
                                            "Panel title",

                                        value:
                                            panel.title
                                    });


                                if (
                                    title !== undefined
                                ) {
                                    panel.title =
                                        title;
                                }


                                const query =
                                    await vscode.window.showInputBox({
                                        prompt:
                                            "SPL query",

                                        value:
                                            panel.splQuery
                                    });


                                if (
                                    query !== undefined
                                ) {
                                    panel.splQuery =
                                        query;
                                }
                            }

                            break;
                        }


                        case "copy": {

                            await vscode.env.clipboard.writeText(
                                studioJson(current)
                            );


                            vscode.window.showInformationMessage(
                                "Dashboard Studio JSON copied."
                            );

                            break;
                        }


                        case "save": {

                            await saveDashboard();

                            break;
                        }


                        case "preview": {

                            const document =
                                await vscode.workspace.openTextDocument({
                                    language: "json",

                                    content:
                                        studioJson(current)
                                });


                            await vscode.window.showTextDocument(
                                document,
                                vscode.ViewColumn.Two
                            );

                            break;
                        }


                        case "add": {

                            if (message.panel) {

                                current.panels.push(
                                    message.panel as DashboardPanel
                                );
                            }

                            break;
                        }
                    }


                    send();

                } catch (error) {

                    vscode.window.showErrorMessage(
                        "Dashboard Designer error: " +
                        (
                            error instanceof Error
                                ? error.message
                                : String(error)
                        )
                    );
                }
            }
        );


    designer.onDidDispose(
        () => {

            messageDisposable.dispose();

            designer = undefined;
        }
    );


    send();
}


/* -------------------------------------------------------------------------- */
/* Send Dashboard State to Webview                                            */
/* -------------------------------------------------------------------------- */

function send(): void {

    if (!current || !designer) {
        return;
    }


    try {

        designer.webview.postMessage({
            type: "state",

            dashboard:
                current,

            json:
                studioJson(current)
        });

    } catch {
        // Webview may already be disposed.
    }
}


/* -------------------------------------------------------------------------- */
/* Show Dashboard JSON                                                        */
/* -------------------------------------------------------------------------- */

async function showJson(): Promise<void> {

    if (!current) {

        await vscode.window.showWarningMessage(
            "No dashboard."
        );

        return;
    }


    const document =
        await vscode.workspace.openTextDocument({

            language: "json",

            content:
                studioJson(current)
        });


    await vscode.window.showTextDocument(
        document,
        vscode.ViewColumn.Two
    );
}


/* -------------------------------------------------------------------------- */
/* Copy Dashboard JSON                                                        */
/* -------------------------------------------------------------------------- */

async function copyJson(): Promise<void> {

    if (!current) {

        await vscode.window.showWarningMessage(
            "No dashboard."
        );

        return;
    }


    await vscode.env.clipboard.writeText(
        studioJson(current)
    );


    vscode.window.showInformationMessage(
        "Dashboard Studio JSON copied to clipboard."
    );
}


/* -------------------------------------------------------------------------- */
/* Validate Dashboard                                                         */
/* -------------------------------------------------------------------------- */

function validate(): void {

    if (!current) {

        vscode.window.showWarningMessage(
            "No dashboard."
        );

        return;
    }


    try {

        validateJson(
            studioJson(current)
        );


        vscode.window.showInformationMessage(
            "Dashboard Validation ✓ JSON ✓ visualizations ✓ data sources ✓ layout"
        );

    } catch (error) {

        vscode.window.showErrorMessage(
            String(error)
        );
    }
}


/* -------------------------------------------------------------------------- */
/* Save Dashboard                                                             */
/* -------------------------------------------------------------------------- */

async function saveDashboard(): Promise<void> {

    if (!current) {
        return;
    }


    const root =
        vscode.workspace.workspaceFolders?.[0]
            ?.uri.fsPath;


    if (!root) {

        await vscode.window.showErrorMessage(
            "Open a workspace first."
        );

        return;
    }


    const directory =
        path.join(
            root,
            "splunk-dashboards"
        );


    await fs.mkdir(
        directory,
        {
            recursive: true
        }
    );


    const filePath =
        path.join(
            directory,
            `${current.id}.json`
        );


    await fs.writeFile(
        filePath,

        studioJson(current),

        "utf8"
    );


    vscode.window.showInformationMessage(
        "Saved " +
        path.relative(
            root,
            filePath
        )
    );
}


/* -------------------------------------------------------------------------- */
/* Import Dashboard                                                           */
/* -------------------------------------------------------------------------- */

async function importDashboard(): Promise<void> {

    const files =
        await vscode.window.showOpenDialog({

            canSelectMany: false,

            filters: {
                JSON: ["json"]
            }
        });


    if (!files?.length) {
        return;
    }


    try {

        const content =
            await fs.readFile(
                files[0].fsPath,
                "utf8"
            );


        current =
            importStudio(content);


        await openDesigner();


        vscode.window.showInformationMessage(
            "Dashboard imported and validated."
        );

    } catch (error) {

        vscode.window.showErrorMessage(
            "Import failed: " +
            (
                error instanceof Error
                    ? error.message
                    : String(error)
            )
        );
    }
}


/* -------------------------------------------------------------------------- */
/* Webview HTML                                                               */
/* -------------------------------------------------------------------------- */

function html(): string {

    const nonce =
        createNonce();


    const clientScript =
        client();


    return [
        "<!doctype html>",

        "<html>",

        "<head>",

        "<meta charset=\"utf-8\">",

        "<meta http-equiv=\"Content-Security-Policy\" " +
        "content=\"default-src 'none'; " +
        "style-src 'unsafe-inline'; " +
        "script-src 'nonce-" +
        nonce +
        "'\">",

        "<style>",

        "body {",
        "font-family: var(--vscode-font-family);",
        "margin: 0;",
        "color: var(--vscode-foreground);",
        "background: var(--vscode-editor-background);",
        "}",

        ".bar {",
        "height: 44px;",
        "padding: 0 12px;",
        "display: flex;",
        "gap: 8px;",
        "align-items: center;",
        "border-bottom: 1px solid var(--vscode-panel-border);",
        "}",

        "button {",
        "background: var(--vscode-button-background);",
        "color: var(--vscode-button-foreground);",
        "border: 0;",
        "padding: 6px 9px;",
        "border-radius: 3px;",
        "cursor: pointer;",
        "}",

        "button:hover {",
        "background: var(--vscode-button-hoverBackground);",
        "}",

        ".grid {",
        "display: grid;",
        "grid-template-columns: 190px 1fr 420px;",
        "height: calc(100vh - 45px);",
        "}",

        "aside {",
        "padding: 10px;",
        "overflow: auto;",
        "border-right: 1px solid var(--vscode-panel-border);",
        "}",

        ".right {",
        "border-right: 0;",
        "border-left: 1px solid var(--vscode-panel-border);",
        "}",

        "main {",
        "overflow: auto;",
        "background:",
        "repeating-linear-gradient(",
        "0deg,",
        "transparent 0 39px,",
        "var(--vscode-panel-border) 40px",
        "),",
        "repeating-linear-gradient(",
        "90deg,",
        "transparent 0 39px,",
        "var(--vscode-panel-border) 40px",
        ");",
        "}",

        ".canvas {",
        "position: relative;",
        "width: 1200px;",
        "min-height: 1200px;",
        "}",

        ".p {",
        "position: absolute;",
        "box-sizing: border-box;",
        "border: 1px solid var(--vscode-focusBorder);",
        "background: var(--vscode-editorWidget-background);",
        "border-radius: 5px;",
        "overflow: hidden;",
        "}",

        ".h {",
        "height: 32px;",
        "padding: 0 6px;",
        "display: flex;",
        "justify-content: space-between;",
        "align-items: center;",
        "background: var(--vscode-titleBar-activeBackground);",
        "cursor: move;",
        "}",

        ".b {",
        "padding: 8px;",
        "font-size: 12px;",
        "}",

        ".r {",
        "position: absolute;",
        "right: 0;",
        "bottom: 0;",
        "width: 13px;",
        "height: 13px;",
        "background: var(--vscode-focusBorder);",
        "cursor: nwse-resize;",
        "}",

        ".item {",
        "padding: 7px;",
        "border: 1px solid var(--vscode-panel-border);",
        "margin: 5px 0;",
        "cursor: pointer;",
        "border-radius: 3px;",
        "}",

        ".item:hover {",
        "background: var(--vscode-list-hoverBackground);",
        "}",

        "pre {",
        "font-size: 10px;",
        "white-space: pre-wrap;",
        "word-break: break-word;",
        "}",

        "</style>",

        "</head>",

        "<body>",

        "<div id=\"a\"></div>",

        "<script nonce=\"" +
        nonce +
        "\">",

        clientScript,

        "</script>",

        "</body>",

        "</html>"
    ].join("\n");
}


/* -------------------------------------------------------------------------- */
/* Webview Client                                                              */
/* -------------------------------------------------------------------------- */

function client(): string {

    return [
        "const api = acquireVsCodeApi();",

        "let s;",

        "",

        "function esc(x) {",
        "    return String(x ?? '').replace(/[&<>]/g, function(c) {",
        "        return {",
        "            '&': '&amp;',",
        "            '<': '&lt;',",
        "            '>': '&gt;'",
        "        }[c];",
        "    });",
        "}",

        "",

        "const lib = [",
        "    'Request Volume',",
        "    'Error Rate',",
        "    'Latency',",
        "    'Requests by Endpoint',",
        "    'Top Application Errors',",
        "    'Retries',",
        "    'Timeouts',",
        "    'Database Errors',",
        "    'Messaging / Kafka Events',",
        "    'Authentication / Authorization Failures'",
        "];",

        "",

        "function render() {",

        "    if (!s) return;",

        "",

        "    const panels = s.dashboard.panels.map(function(p) {",

        "        const evidence =",
        "            p.evidence && p.evidence.sourceFiles",
        "                ? p.evidence.sourceFiles.join(', ')",
        "                : 'repository analysis';",

        "",

        "        return '<div class=\"p\" id=\"p_' +",
        "            esc(p.id) +",
        "            '\" style=\"left:' +",
        "            p.position.x +",
        "            'px;top:' +",
        "            p.position.y +",
        "            'px;width:' +",
        "            p.position.w +",
        "            'px;height:' +",
        "            p.position.h +",
        "            'px\">' +",

        "            '<div class=\"h\" onpointerdown=\"drag(event, \\'' +",
        "            p.id +",
        "            '\\')\">' +",

        "                '<span>' +",
        "                esc(p.title) +",
        "                '</span>' +",

        "                '<span>' +",

        "                    '<button onclick=\"event.stopPropagation();edit(\\'' +",
        "                    p.id +",
        "                    '\\')\">✎</button>' +",

        "                    '<button onclick=\"event.stopPropagation();duplicatePanel(\\'' +",
        "                    p.id +",
        "                    '\\')\">⧉</button>' +",

        "                    '<button onclick=\"event.stopPropagation();deletePanel(\\'' +",
        "                    p.id +",
        "                    '\\')\">×</button>' +",

        "                '</span>' +",

        "            '</div>' +",

        "            '<div class=\"b\">' +",

        "                esc(p.description || '') +",

        "                '<br>' +",

        "                '<small>Type: ' +",
        "                esc(p.type) +",
        "                ' · ' +",
        "                esc(p.category) +",
        "                '<br>Evidence: ' +",
        "                esc(evidence) +",
        "                '</small>' +",

        "            '</div>' +",

        "            '<div class=\"r\" onpointerdown=\"resize(event, \\'' +",
        "            p.id +",
        "            '\\')\"></div>' +",

        "        '</div>';",

        "    }).join('');",

        "",

        "    const library = lib.map(function(x) {",

        "        return '<div class=\"item\" onclick=\"addPanel(\\'' +",
        "            x.replace(/'/g, \"\\\\'\") +",
        "            '\\')\">' +",
        "            esc(x) +",
        "            '</div>';",

        "    }).join('');",

        "",

        "    document.querySelector('#a').innerHTML =",

        "        '<div class=\"bar\">' +",

        "            '<b>Dashboard Designer</b>' +",

        "            '<span>' +",
        "            esc(s.dashboard.title) +",
        "            '</span>' +",

        "            '<span style=\"flex:1\"></span>' +",

        "            '<button onclick=\"copyJson()\">Copy JSON</button>' +",

        "            '<button onclick=\"previewJson()\">JSON Preview</button>' +",

        "            '<button onclick=\"saveDashboard()\">Save</button>' +",

        "        '</div>' +",

        "        '<div class=\"grid\">' +",

        "            '<aside>' +",
        "                '<b>Panel Library</b>' +",
        "                library +",
        "            '</aside>' +",

        "            '<main>' +",
        "                '<div class=\"canvas\">' +",
        "                panels +",
        "                '</div>' +",
        "            '</main>' +",

        "            '<aside class=\"right\">' +",
        "                '<b>Live Dashboard Studio JSON</b>' +",
        "                '<pre>' +",
        "                esc(s.json) +",
        "                '</pre>' +",
        "            '</aside>' +",

        "        '</div>';",
        "}",

        "",

        "function drag(e, id) {",

        "    if (e.target.closest('button')) return;",

        "    e.preventDefault();",

        "    const p = s.dashboard.panels.find(function(x) {",
        "        return x.id === id;",
        "    });",

        "    if (!p) return;",

        "    const sx = e.clientX;",
        "    const sy = e.clientY;",
        "    const ox = p.position.x;",
        "    const oy = p.position.y;",

        "    function move(ev) {",

        "        p.position.x = Math.max(",
        "            0,",
        "            Math.round(",
        "                (ox + ev.clientX - sx) / 20",
        "            ) * 20",
        "        );",

        "        p.position.y = Math.max(",
        "            0,",
        "            Math.round(",
        "                (oy + ev.clientY - sy) / 20",
        "            ) * 20",
        "        );",

        "        render();",
        "    }",

        "    function up() {",

        "        api.postMessage({",
        "            type: 'move',",
        "            id: id,",
        "            value: p.position",
        "        });",

        "        document.removeEventListener(",
        "            'pointermove',",
        "            move",
        "        );",

        "        document.removeEventListener(",
        "            'pointerup',",
        "            up",
        "        );",
        "    }",

        "    document.addEventListener(",
        "        'pointermove',",
        "        move",
        "    );",

        "    document.addEventListener(",
        "        'pointerup',",
        "        up",
        "    );",
        "}",

        "",

        "function resize(e, id) {",

        "    e.stopPropagation();",
        "    e.preventDefault();",

        "    const p = s.dashboard.panels.find(function(x) {",
        "        return x.id === id;",
        "    });",

        "    if (!p) return;",

        "    const sx = e.clientX;",
        "    const sy = e.clientY;",
        "    const ow = p.position.w;",
        "    const oh = p.position.h;",

        "    function move(ev) {",

        "        p.position.w = Math.max(",
        "            160,",
        "            Math.round(",
        "                (ow + ev.clientX - sx) / 20",
        "            ) * 20",
        "        );",

        "        p.position.h = Math.max(",
        "            90,",
        "            Math.round(",
        "                (oh + ev.clientY - sy) / 20",
        "            ) * 20",
        "        );",

        "        render();",
        "    }",

        "    function up() {",

        "        api.postMessage({",
        "            type: 'resize',",
        "            id: id,",
        "            value: {",
        "                w: p.position.w,",
        "                h: p.position.h",
        "            }",
        "        });",

        "        document.removeEventListener(",
        "            'pointermove',",
        "            move",
        "        );",

        "        document.removeEventListener(",
        "            'pointerup',",
        "            up",
        "        );",
        "    }",

        "    document.addEventListener(",
        "        'pointermove',",
        "        move",
        "    );",

        "    document.addEventListener(",
        "        'pointerup',",
        "        up",
        "    );",
        "}",

        "",

        "function edit(id) {",

        "    api.postMessage({",
        "        type: 'edit',",
        "        id: id",
        "    });",
        "}",

        "",

        "function duplicatePanel(id) {",

        "    api.postMessage({",
        "        type: 'duplicate',",
        "        id: id",
        "    });",
        "}",

        "",

        "function deletePanel(id) {",

        "    api.postMessage({",
        "        type: 'delete',",
        "        id: id",
        "    });",
        "}",

        "",

        "function copyJson() {",

        "    api.postMessage({",
        "        type: 'copy'",
        "    });",
        "}",

        "",

        "function previewJson() {",

        "    api.postMessage({",
        "        type: 'preview'",
        "    });",
        "}",

        "",

        "function saveDashboard() {",

        "    api.postMessage({",
        "        type: 'save'",
        "    });",
        "}",

        "",

        "function addPanel(title) {",

        "    const id =",
        "        'custom_' + Date.now();",

        "    api.postMessage({",

        "        type: 'add',",

        "        panel: {",

        "            id: id,",

        "            title: title,",

        "            description:",
        "                'Manually added from panel library',",

        "            type:",
        "                title.indexOf('Volume') >= 0 ||",
        "                title.indexOf('Rate') >= 0",
        "                    ? 'singleValue'",
        "                    : 'table',",

        "            category: 'application',",

        "            splQuery:",
        "                'index=application | stats count',",

        "            requiredFields: [],",

        "            position: {",
        "                x: 40,",
        "                y: 40,",
        "                w: 360,",
        "                h: 160",
        "            },",

        "            evidence: {",
        "                sourceFiles: [],",
        "                telemetryEvidence: [],",
        "                generatedQuestion:",
        "                    'Manually added',",
        "                reason:",
        "                    'Added from panel library'",
        "            }",

        "        }",

        "    });",
        "}",

        "",

        "window.addEventListener(",
        "    'message',",
        "    function(e) {",

        "        if (e.data.type === 'state') {",

        "            s = e.data;",

        "            render();",
        "        }",
        "    }",
        ");",

        "",

        "render();"

    ].join("\n");
}


/* -------------------------------------------------------------------------- */
/* Nonce                                                                       */
/* -------------------------------------------------------------------------- */

function createNonce(): string {

    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
        "abcdefghijklmnopqrstuvwxyz" +
        "0123456789";


    let result = "";


    for (let i = 0; i < 32; i++) {

        result +=
            characters.charAt(
                Math.floor(
                    Math.random() *
                    characters.length
                )
            );
    }


    return result;
}
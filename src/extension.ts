import * as vscode from 'vscode';
import { spawn } from 'child_process';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext): void {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('python-ta');
    const cmd = vscode.commands.registerCommand('pythonta.check', runPythonTA);
    context.subscriptions.push(cmd, diagnosticCollection);
}

export function deactivate(): void {}

async function getPythonPath(): Promise<string> {
    const pythonExt = vscode.extensions.getExtension('ms-python.python');
    if (pythonExt) {
        if (!pythonExt.isActive) {
            await pythonExt.activate();
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = pythonExt.exports as any;

        // Current API (ms-python >= 2022.2): resolves the active environment's executable,
        // including virtual environments and conda envs.
        if (typeof api?.environments?.getActiveEnvironmentPath === 'function') {
            const envPath = api.environments.getActiveEnvironmentPath();
            const resolved = await api.environments.resolveEnvironment(envPath);
            const execPath: string | undefined = resolved?.executable?.uri?.fsPath;
            if (execPath) {
                return execPath;
            }
        }

        // Legacy API fallback (ms-python < 2022.2)
        const execCommand: string[] | undefined =
            api?.settings?.getExecutionDetails?.()?.execCommand;
        if (execCommand && execCommand.length > 0) {
            return execCommand[0];
        }
    }

    const setting = vscode.workspace.getConfiguration('pythonta').get<string>('pythonPath');
    return setting || 'python';
}

function lspSeverityToVscode(severity: number): vscode.DiagnosticSeverity {
    switch (severity) {
        case 1: return vscode.DiagnosticSeverity.Error;
        case 3: return vscode.DiagnosticSeverity.Information;
        case 4: return vscode.DiagnosticSeverity.Hint;
        default: return vscode.DiagnosticSeverity.Warning;
    }
}

interface LspRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

interface LspDiagnostic {
    range: LspRange;
    message: string;
    severity: number;
    code?: string;
    source?: string;
}

interface PublishDiagnosticsParams {
    uri: string;
    diagnostics: LspDiagnostic[];
}

async function runPythonTA(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
        vscode.window.showWarningMessage('PythonTA: Open a Python file first.');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    const python = await getPythonPath();

    const config = vscode.workspace.getConfiguration('pythonta');
    const configPath = config.get<string>('configPath');

    const args = ['-m', 'python_ta', '--output-format', 'pyta-lsp', filePath];
    // if (configPath) {
    //     args.push('--config', configPath);
    // }

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    status.text = '$(loading~spin) Running PythonTA...';
    status.show();

    let stdout = '';
    let stderr = '';

    const proc = spawn(python, args);
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err: Error) => {
        status.dispose();
        vscode.window.showErrorMessage(`PythonTA: Failed to start process: ${err.message}`);
    });

    proc.on('close', (code: number | null) => {
        status.dispose();

        if (stdout.trim() === '') {
            const detail = stderr.trim() ? ` ${stderr.trim()}` : '';
            vscode.window.showErrorMessage(`PythonTA: No output (exit ${code}).${detail}`);
            return;
        }

        let results: PublishDiagnosticsParams[];
        try {
            results = JSON.parse(stdout) as PublishDiagnosticsParams[];
        } catch {
            vscode.window.showErrorMessage('PythonTA: Could not parse output as JSON.');
            return;
        }

        diagnosticCollection.clear();
        for (const { uri, diagnostics } of results) {
            const vscodeDiags = diagnostics.map((d) => {
                const diag = new vscode.Diagnostic(
                    new vscode.Range(
                        d.range.start.line,
                        d.range.start.character,
                        d.range.end.line,
                        d.range.end.character
                    ),
                    d.message,
                    lspSeverityToVscode(d.severity)
                );
                diag.code = d.code;
                diag.source = d.source ?? 'python-ta';
                return diag;
            });
            diagnosticCollection.set(vscode.Uri.parse(uri), vscodeDiags);
        }
    });
}

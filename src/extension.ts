import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('python-ta');
    const cmd = vscode.commands.registerCommand('pythonta.check', runPythonTA);
    context.subscriptions.push(cmd, diagnosticCollection);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {}

async function getPythonExecutionDetails(resource: vscode.Uri): Promise<{ python: string; env: NodeJS.ProcessEnv }> {
    let python = 'python';

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
            const envPath = api.environments.getActiveEnvironmentPath(resource);
            const resolved = await api.environments.resolveEnvironment(envPath);
            if (resolved?.executable?.uri?.fsPath) {
                python = resolved.executable.uri.fsPath;
            }
        } else {
            const execCommand: string[] | undefined =
                api?.settings?.getExecutionDetails?.(resource)?.execCommand;
            if (execCommand && execCommand.length > 0) {
                python = execCommand[0];
            }
        }
    }

    if (python === 'python') {
        const setting = vscode.workspace.getConfiguration('pythonta').get<string>('pythonPath');
        if (setting) {
            python = setting;
        }
    }

    const env = Object.assign({}, process.env);
    if (python !== 'python') {
        const pythonDir = path.dirname(python);
        const venvDir = path.dirname(pythonDir);
        
        env.PATH = `${pythonDir}${path.delimiter}${env.PATH || ''}`;
        env.VIRTUAL_ENV = venvDir;
        delete env.PYTHONHOME;
    }

    return { python, env };
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

    if (editor.document.isUntitled) {
        vscode.window.showWarningMessage('PythonTA: Please save the file before running the linter.');
        return;
    }

    const filePath = editor.document.uri.fsPath;
    
    const { python, env } = await getPythonExecutionDetails(editor.document.uri);

    const config = vscode.workspace.getConfiguration('pythonta');
    const configPath = config.get<string>('configPath');

    const args = ['-m', 'python_ta'];

    if (configPath && configPath.trim() !== '') {
        args.push('--config', configPath.trim());
    }

    args.push('--output-format', 'pyta-lsp');

    args.push(filePath);

    statusBarItem.text = '$(loading~spin) Running PythonTA...';
    statusBarItem.show();

    let stdout = '';
    let stderr = '';

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : undefined;

    const proc = spawn(python, args, {
        cwd: cwd,
        env: env
    });
    
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err: Error) => {
        statusBarItem.hide()
        vscode.window.showErrorMessage(`PythonTA: Failed to start process: ${err.message}`);
    });

    proc.on('close', (code: number | null) => {
        statusBarItem.hide()

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

        diagnosticCollection.set(editor.document.uri, []);
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

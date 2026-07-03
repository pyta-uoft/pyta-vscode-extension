# vscode-python-ta

A VS Code extension that runs [PythonTA](https://github.com/pyta-uoft/pyta) on demand and displays its diagnostics as squiggles and Problems panel entries.

## How it works

Pressing `Ctrl+Shift+T` (or running **Run PythonTA** from the Command Palette) spawns `python -m python_ta --output-format pyta-lsp` on the active file. The extension reads the JSON output from stdout and populates a named `DiagnosticCollection`, so PythonTA's annotations appear in the editor.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [VS Code](https://code.visualstudio.com/) (v1.100+)
- A Python environment with PythonTA installed (`pip install python-ta`)

## Developer setup

```bash
# Install dependencies
pnpm install

# Compile TypeScript once
pnpm run compile

# Or watch for changes (recompiles on save)
pnpm run watch
```

Press **F5** to open an Extension Development Host window with the extension loaded. In that window, open any `.py` file and press `Ctrl+Shift+T` to trigger a check.

After editing `src/extension.ts`, press `Ctrl+Shift+F5` in the Extension Development Host window to reload the extension without restarting.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `pythonta.pythonPath` | *(ms-python interpreter)* | Path to the Python executable that has PythonTA installed. Falls back to `python` if neither this nor the ms-python extension is available. |
| `pythonta.configPath` | *(none)* | Path to a PythonTA config file (`.pylintrc`). Passed to the subprocess via `--config`. |

## Project structure

```
src/
└── extension.ts     # activate(), runPythonTA(), getPythonPath()
.vscode/
├── launch.json      # F5 debug configuration
└── tasks.json       # compile / watch build tasks
package.json         # extension manifest (commands, keybindings, configuration)
tsconfig.json
```

## Packaging

```bash
# Install the vsce tool if you don't have it
pnpm add -g @vscode/vsce

# Build a .vsix for local installation
vsce package --no-dependencies
```

Install the resulting `.vsix` via **Extensions: Install from VSIX…** in the Command Palette.

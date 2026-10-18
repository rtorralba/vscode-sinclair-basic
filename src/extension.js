/**
 * Sinclair BASIC (Unofficial) - VS Code Extension Entry Point
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { renumberProgram } = require('./core/renumber');
const { compileJBas, transpileJBasAllVersions } = require('./core/jbas2bas');
const { generateTapFile } = require('./core/tapGenerator');

/**
 * Resolves the target document from an optional command URI parameter or active text editor.
 * @param {vscode.Uri} [uri]
 * @returns {Promise<vscode.TextDocument|null>}
 */
async function getTargetDocument(uri) {
  if (uri && uri.fsPath) {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch {
      // Fall back to active editor
    }
  }
  if (vscode.window.activeTextEditor) {
    return vscode.window.activeTextEditor.document;
  }
  return null;
}

/**
 * Builds a .tap tape image from a .bas file using native JavaScript TAP generator
 * (with automatic fallback to external bas2tap if explicitly configured).
 * @param {string} basPath Path to source .bas file
 * @param {string} distDir Output directory for .tap file
 * @returns {Promise<{ tapPath: string, autoStartLine: number }>}
 */
async function buildTapFromBas(basPath, distDir) {
  const config = vscode.workspace.getConfiguration('sinclairBasic');
  const configuredAutoStart = config.get('autoStartLine', 0);
  const useExternalBas2Tap = config.get('useExternalBas2Tap', false);

  const baseName = path.basename(basPath, path.extname(basPath));
  const outputDir = distDir || path.dirname(basPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const tapPath = path.join(outputDir, `${baseName}.tap`);

  let autoStartLine = configuredAutoStart;
  if (autoStartLine <= 0) {
    const basContent = fs.readFileSync(basPath, 'utf-8');
    const match = basContent.match(/^\s*(\d+)/m);
    autoStartLine = match ? parseInt(match[1], 10) : 10;
  }

  // If user explicitly configured external bas2tap executable
  if (useExternalBas2Tap) {
    const bas2tapPath = config.get('bas2tapPath', 'bas2tap');
    const args = [`-a${autoStartLine}`, basPath, tapPath];

    await new Promise((resolve, reject) => {
      execFile(bas2tapPath, args, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
        } else {
          resolve(stdout);
        }
      });
    });

    return { tapPath, autoStartLine };
  }

  // Native Pure JavaScript TAP generator (zero external dependencies!)
  const basicCode = fs.readFileSync(basPath, 'utf-8');
  const result = generateTapFile(basicCode, tapPath, {
    filename: baseName,
    autostart: autoStartLine
  });

  return { tapPath: result.tapPath, autoStartLine: result.autoStartLine };
}



/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

  // Command: Renumber Lines in .bas file
  async function handleRenumber(uri) {
    let editor = vscode.window.activeTextEditor;
    if (uri && uri.fsPath && (!editor || editor.document.uri.toString() !== uri.toString())) {
      const doc = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(doc);
    }

    if (!editor) {
      vscode.window.showInformationMessage('No active Sinclair BASIC (.bas) editor found.');
      return;
    }

    const doc = editor.document;
    if (doc.fileName.endsWith('.jbas')) {
      vscode.window.showWarningMessage('Cannot renumber a .jbas file. .jbas uses labels (@label) without line numbers. Use "Compile JBAS" to generate numbered BASIC.');
      return;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const defaultStart = config.get('renumberStart', 10);
    const defaultStep = config.get('renumberStep', 10);

    const fullText = doc.getText();

    try {
      const result = renumberProgram(fullText, { start: defaultStart, step: defaultStep });

      if (!result.success) {
        vscode.window.showErrorMessage('Sinclair BASIC Renumber failed: Program has no valid statements.');
        return;
      }

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(fullText.length)
      );

      await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, result.text);
      });

      if (result.warnings && result.warnings.length > 0) {
        vscode.window.showWarningMessage(
          `Renumbered ${result.linesCount} lines with ${result.warnings.length} warning(s). Check output for details.`
        );
      } else {
        vscode.window.showInformationMessage(`Successfully renumbered ${result.linesCount} lines (start ${defaultStart}, step ${defaultStep}).`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Renumber error: ${err.message}`);
    }
  }

  // Command: Transpile JBAS to BAS (generates 3 versions: compact 1x1, step10 10x10, and comments 10x10+REM)
  async function handleTranspileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage('No active editor or .jbas file selected.');
      return null;
    }

    const filePath = doc.fileName;
    if (!filePath.endsWith('.jbas')) {
      vscode.window.showWarningMessage('Selected file is not a .jbas file.');
      return null;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const outDirName = config.get('outputDirectory', 'dist');

    const sourceText = doc.getText();
    const all = transpileJBasAllVersions(sourceText);

    if (!all.success) {
      const errorMsg = all.errors.join('\n');
      vscode.window.showErrorMessage(`Transpilation failed:\n${errorMsg}`);
      return null;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const rootDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
    const distDir = path.isAbsolute(outDirName) ? outDirName : path.join(rootDir, outDirName);

    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    const baseName = path.basename(filePath, '.jbas');
    const compactPath = path.join(distDir, `${baseName}.bas`);
    const step10Path = path.join(distDir, `${baseName}-step10.bas`);
    const commentsPath = path.join(distDir, `${baseName}-comments.bas`);

    fs.writeFileSync(compactPath, all.compact.text, 'utf-8');
    fs.writeFileSync(step10Path, all.step10.text, 'utf-8');
    fs.writeFileSync(commentsPath, all.comments.text, 'utf-8');

    const openDoc = await vscode.workspace.openTextDocument(step10Path);
    await vscode.window.showTextDocument(openDoc, { preview: false });

    vscode.window.showInformationMessage(
      `Transpiled 3 versions to dist/: ${baseName}.bas (1x1 optimal), ${baseName}-step10.bas (10x10), ${baseName}-comments.bas (10x10 + REM)`
    );
    return step10Path;
  }

  // Command: Compile JBAS to TAP (generates all 3 versions, builds .tap strictly from optimal 1x1 no-comments version)
  async function handleCompileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage('No active editor or .jbas file selected.');
      return null;
    }

    const filePath = doc.fileName;
    if (!filePath.endsWith('.jbas')) {
      vscode.window.showWarningMessage('Selected file is not a .jbas file.');
      return null;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const outDirName = config.get('outputDirectory', 'dist');

    const sourceText = doc.getText();
    const all = transpileJBasAllVersions(sourceText);

    if (!all.success) {
      const errorMsg = all.errors.join('\n');
      vscode.window.showErrorMessage(`Compilation failed:\n${errorMsg}`);
      return null;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const rootDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
    const distDir = path.isAbsolute(outDirName) ? outDirName : path.join(rootDir, outDirName);

    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    const baseName = path.basename(filePath, '.jbas');
    const compactPath = path.join(distDir, `${baseName}.bas`);
    const step10Path = path.join(distDir, `${baseName}-step10.bas`);
    const commentsPath = path.join(distDir, `${baseName}-comments.bas`);

    // Write all 3 versions so dist is always complete and synchronized
    fs.writeFileSync(compactPath, all.compact.text, 'utf-8');
    fs.writeFileSync(step10Path, all.step10.text, 'utf-8');
    fs.writeFileSync(commentsPath, all.comments.text, 'utf-8');

    // Build .tap strictly from the most optimal version: lines 1 by 1 and without comments (compactPath)
    try {
      const { tapPath, autoStartLine } = await buildTapFromBas(compactPath, distDir);
      vscode.window.showInformationMessage(
        `Compiled ${baseName}.jbas → dist/${baseName}.tap (using optimal 1x1 no-comments version) & updated all 3 .bas versions (Autostart line ${autoStartLine})`
      );
      return tapPath;
    } catch (err) {
      vscode.window.showErrorMessage(`Generated .bas versions, but TAP build failed: ${err.message}`);
      return null;
    }
  }

  // Command: Compile .bas or .jbas to .tap using bas2tap
  async function handleCompileBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage('No active editor or file selected.');
      return null;
    }

    const filePath = doc.fileName;
    if (filePath.endsWith('.jbas')) {
      return await handleCompileJBas(uri);
    }

    if (!filePath.endsWith('.bas')) {
      vscode.window.showWarningMessage('Please select a Sinclair BASIC (.bas) or .jbas file.');
      return null;
    }

    try {
      const config = vscode.workspace.getConfiguration('sinclairBasic');
      const outDirName = config.get('outputDirectory', 'dist');
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
      const rootDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
      const distDir = path.isAbsolute(outDirName) ? outDirName : path.join(rootDir, outDirName);

      const { tapPath, autoStartLine } = await buildTapFromBas(filePath, distDir);

      vscode.window.showInformationMessage(`Successfully built TAP: ${path.basename(tapPath)} (Autostart line ${autoStartLine})`);
      return tapPath;
    } catch (err) {
      vscode.window.showErrorMessage(`Compile BAS to TAP error: ${err.message}`);
      return null;
    }
  }

  // Webview panel reference for Turbo80
  let currentTurbo80Panel = null;

  function getTurbo80Html() {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline' https://turbo80.com;
    frame-src https://turbo80.com;
    style-src 'unsafe-inline';
    img-src https: data:;
    connect-src https://turbo80.com;
  ">
  <title>Turbo80 - ZX Spectrum</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0c0c11;
      color: #e9e9f2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    #emulator-wrap {
      flex: 1;
      width: 100%;
      height: calc(100% - 34px);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    #spectrum {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #spectrum iframe {
      border: 0;
      width: 100%;
      height: 100%;
      max-width: 100vw;
      max-height: 100vh;
    }
    #footer {
      height: 34px;
      background: #14141e;
      border-top: 1px solid #28283a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.2rem;
      font-size: 12px;
      color: #9b9bb0;
      user-select: none;
      flex-shrink: 0;
    }
    #footer a {
      color: #37d0ff;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s ease;
    }
    #footer a:hover {
      color: #57ef9e;
      text-decoration: underline;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      font-size: 12px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #57ef9e;
      box-shadow: 0 0 8px rgba(87, 239, 158, 0.7);
    }
    .attribution {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
    }
  </style>
</head>
<body>
  <div id="emulator-wrap">
    <div id="spectrum"></div>
  </div>
  <footer id="footer">
    <div class="status-badge">
      <span class="status-dot"></span>
      <span id="game-title">Iniciando ZX Spectrum...</span>
    </div>
    <div class="attribution">
      Emulado con <a href="https://turbo80.com" target="_blank" rel="noopener">Turbo80</a> &bull; Emulador de ZX Spectrum por Jos&eacute; Enrique Garc&iacute;a (Incinerator)
    </div>
  </footer>

  <script src="https://turbo80.com/turbo80.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    let emulator = null;
    let pendingData = null;

    function focusEmulator() {
      try {
        if (emulator && typeof emulator.focus === 'function') {
          emulator.focus();
        }
      } catch (e) {}
      try {
        const iframe = document.querySelector('#spectrum iframe') || (emulator && emulator.iframe);
        if (iframe) {
          if (!iframe.hasAttribute('tabindex')) {
            iframe.setAttribute('tabindex', '0');
          }
          iframe.focus();
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
          }
          if (typeof iframe.click === 'function') {
            iframe.click();
          }
        }
      } catch (e) {}
    }

    function attachIframeListeners() {
      try {
        const iframe = document.querySelector('#spectrum iframe') || (emulator && emulator.iframe);
        if (iframe && !iframe._hasLoadedListener) {
          iframe._hasLoadedListener = true;
          iframe.addEventListener('load', () => {
            scheduleFocus();
          });
        }
      } catch (e) {}
    }

    function scheduleFocus() {
      focusEmulator();
      attachIframeListeners();
      [50, 150, 300, 500, 800, 1200, 1800].forEach(delay => {
        setTimeout(focusEmulator, delay);
      });
    }

    function applyTap(data) {
      try {
        const binaryString = atob(data.base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const currentModel = data.model || '48k';
        document.getElementById('game-title').textContent = (data.filename || 'game.tap') + ' (' + currentModel.toUpperCase() + ')';

        if (typeof Turbo80 === 'undefined') {
          document.getElementById('game-title').textContent = 'Error cargando Turbo80 (comprueba tu conexi\u00f3n a internet)';
          return;
        }

        if (!emulator) {
          emulator = Turbo80(document.getElementById('spectrum'), {
            load: bytes,
            name: data.filename || 'game.tap',
            model: currentModel,
            crt: data.crt ? 'on' : 'off',
            iframe: true
          });
          if (emulator && typeof emulator.on === 'function') {
            emulator.on('ready', scheduleFocus);
            emulator.on('loaded', scheduleFocus);
          }
          attachIframeListeners();
        } else {
          const doLoad = () => emulator.load(bytes, data.filename || 'game.tap');
          if (emulator.setModel) {
            Promise.resolve(emulator.setModel(currentModel))
              .then(() => {
                if (emulator.reset) emulator.reset();
                return doLoad();
              })
              .then(() => { scheduleFocus(); })
              .catch(() => {
                doLoad();
                scheduleFocus();
              });
          } else {
            doLoad();
            scheduleFocus();
          }
        }
        scheduleFocus();
      } catch (err) {
        console.error('Error loading TAP into Turbo80:', err);
        document.getElementById('game-title').textContent = 'Error al cargar TAP: ' + err.message;
      }
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadTap') {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          applyTap(msg);
        } else {
          pendingData = msg;
        }
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      if (pendingData) {
        applyTap(pendingData);
        pendingData = null;
      }
      vscode.postMessage({ command: 'ready' });
    });

    window.addEventListener('focus', focusEmulator);
    window.addEventListener('pointerdown', focusEmulator);
    window.addEventListener('click', focusEmulator);
    window.addEventListener('keydown', focusEmulator);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleFocus();
      }
    });
  </script>
</body>
</html>`;
  }

  function runTurbo80Webview(tapPath) {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const model = config.get('turbo80Model', '48k') || '48k';
    const crt = config.get('turbo80Crt', true);
    const filename = path.basename(tapPath);
    const tapBuffer = fs.readFileSync(tapPath);
    const base64 = tapBuffer.toString('base64');

    const payload = {
      command: 'loadTap',
      base64,
      filename,
      model,
      crt
    };

    if (currentTurbo80Panel) {
      currentTurbo80Panel.reveal(vscode.ViewColumn.Beside, false);
      currentTurbo80Panel.title = `ZX: ${filename}`;
      currentTurbo80Panel.webview.postMessage(payload);
    } else {
      currentTurbo80Panel = vscode.window.createWebviewPanel(
        'sinclairBasicTurbo80',
        `ZX: ${filename}`,
        {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      currentTurbo80Panel.webview.html = getTurbo80Html();

      currentTurbo80Panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'ready') {
          currentTurbo80Panel.webview.postMessage(payload);
        }
      });

      currentTurbo80Panel.onDidDispose(() => {
        currentTurbo80Panel = null;
      });
    }
  }

  function launchExternalEmulator(tapPath) {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const emulatorPath = config.get('emulatorPath', 'fuse');
    const emulatorArgs = config.get('emulatorArgs', []);
    const allArgs = [...emulatorArgs, tapPath];

    execFile(emulatorPath, allArgs, (error) => {
      if (error && error.code !== 0) {
        vscode.window.showErrorMessage(`Failed to launch external emulator (${emulatorPath}): ${error.message}`);
      }
    });
  }

  // Command: Run in Emulator (Turbo80 Web by default, or External if configured)
  async function handleRunEmulator(uri) {
    const tapPath = await handleCompileBas(uri);
    if (!tapPath) return;

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const emulatorType = config.get('emulatorType', 'turbo80');

    if (emulatorType === 'external') {
      launchExternalEmulator(tapPath);
    } else {
      runTurbo80Webview(tapPath);
    }
  }

  // Command: Explicitly Run in Turbo80 Web Emulator
  async function handleRunTurbo80(uri) {
    const tapPath = await handleCompileBas(uri);
    if (!tapPath) return;
    runTurbo80Webview(tapPath);
  }

  // Command: Explicitly Run in External Emulator
  async function handleRunExternalEmulator(uri) {
    const tapPath = await handleCompileBas(uri);
    if (!tapPath) return;
    launchExternalEmulator(tapPath);
  }

  // Command: Browse and select bas2tap executable
  async function handleSelectBas2tap() {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const currentPath = config.get('bas2tapPath', '');

    let defaultUri;
    if (currentPath && fs.existsSync(currentPath)) {
      defaultUri = vscode.Uri.file(path.dirname(currentPath));
    } else {
      const defaultBin = path.join(os.homedir(), 'bin');
      if (fs.existsSync(defaultBin)) {
        defaultUri = vscode.Uri.file(defaultBin);
      }
    }

    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri,
      openLabel: 'Select bas2tap executable',
      filters: process.platform === 'win32'
        ? { 'Executables (*.exe)': ['exe'], 'All Files (*.*)': ['*'] }
        : { 'All Files': ['*'] }
    });

    if (fileUris && fileUris[0]) {
      const selectedPath = fileUris[0].fsPath;
      await config.update('bas2tapPath', selectedPath, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`bas2tap path updated: ${selectedPath}`);
    }
  }

  // Command: Browse and select emulator executable
  async function handleSelectEmulator() {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const currentPath = config.get('emulatorPath', '');

    let defaultUri;
    if (currentPath && fs.existsSync(currentPath)) {
      defaultUri = vscode.Uri.file(path.dirname(currentPath));
    }

    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri,
      openLabel: 'Select emulator executable',
      filters: process.platform === 'win32'
        ? { 'Executables (*.exe)': ['exe'], 'All Files (*.*)': ['*'] }
        : { 'All Files': ['*'] }
    });

    if (fileUris && fileUris[0]) {
      const selectedPath = fileUris[0].fsPath;
      await config.update('emulatorPath', selectedPath, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Emulator path updated: ${selectedPath}`);
    }
  }

  // Definition Provider: Ctrl+Click on @label navigates to @label:
  const definitionProvider = vscode.languages.registerDefinitionProvider('jbas', {
    provideDefinition(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return null;

      const rawWord = document.getText(range);
      const labelName = rawWord.startsWith('@') ? rawWord.slice(1) : rawWord;
      if (!labelName) return null;

      const defRegex = new RegExp(`^\\s*@${labelName}\\s*:`, 'i');
      const lineCount = document.lineCount;

      for (let i = 0; i < lineCount; i++) {
        const line = document.lineAt(i);
        const match = line.text.match(defRegex);
        if (match) {
          const col = line.text.indexOf('@' + labelName);
          const targetPos = new vscode.Position(i, col >= 0 ? col : 0);
          return new vscode.Location(document.uri, targetPos);
        }
      }

      return null;
    }
  });

  // Reference Provider: Find all references of @label in .jbas (Shift+F12)
  const referenceProvider = vscode.languages.registerReferenceProvider('jbas', {
    provideReferences(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return null;

      const rawWord = document.getText(range);
      const labelName = rawWord.startsWith('@') ? rawWord.slice(1) : rawWord;
      if (!labelName) return null;

      const refRegex = new RegExp(`@${labelName}\\b`, 'gi');
      const lineCount = document.lineCount;
      const locations = [];

      for (let i = 0; i < lineCount; i++) {
        const text = document.lineAt(i).text;
        let match;
        while ((match = refRegex.exec(text)) !== null) {
          locations.push(new vscode.Location(
            document.uri,
            new vscode.Position(i, match.index)
          ));
        }
      }

      return locations;
    }
  });

  // Document Symbol Provider: Shows labels in Outline / Breadcrumbs
  const symbolProvider = vscode.languages.registerDocumentSymbolProvider('jbas', {
    provideDocumentSymbols(document) {
      const symbols = [];
      const lineCount = document.lineCount;
      const labelRegex = /^\s*@([a-zA-Z0-9_]+)\s*:/;

      for (let i = 0; i < lineCount; i++) {
        const line = document.lineAt(i);
        const match = line.text.match(labelRegex);
        if (match) {
          const labelName = match[1];
          const col = line.text.indexOf('@' + labelName);
          const selRange = new vscode.Range(i, col, i, col + labelName.length + 1);
          symbols.push(new vscode.DocumentSymbol(
            '@' + labelName,
            'Label target',
            vscode.SymbolKind.Key,
            line.range,
            selRange
          ));
        }
      }
      return symbols;
    }
  });

  // Language configuration for jbas: auto-indent after typing a label and pressing Enter
  const jbasLanguageConfig = vscode.languages.setLanguageConfiguration('jbas', {
    indentationRules: {
      increaseIndentPattern: /^\s*@[a-zA-Z0-9_]+\s*:.*$/,
      decreaseIndentPattern: /^\b$/
    },
    onEnterRules: [
      {
        beforeText: /^\s*@[a-zA-Z0-9_]+\s*:.*$/,
        action: {
          indentAction: vscode.IndentAction.Indent
        }
      }
    ]
  });

  // Real-time diagnostics for duplicate labels in .jbas
  const jbasDiagnostics = vscode.languages.createDiagnosticCollection('jbas');

  function validateJBasDocument(document) {
    if (!document || !document.fileName.endsWith('.jbas')) return;

    const diagnostics = [];
    const seenLabels = new Map(); // labelName -> { line, col, length }
    const labelRegex = /^\s*@([a-zA-Z0-9_]+)\s*:/;

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const match = line.text.match(labelRegex);
      if (match) {
        const labelName = match[1];
        const col = line.text.indexOf('@' + labelName);
        const range = new vscode.Range(i, col, i, col + labelName.length + 1);

        if (seenLabels.has(labelName)) {
          const first = seenLabels.get(labelName);
          const diagnostic = new vscode.Diagnostic(
            range,
            `Duplicate label definition '@${labelName}' (previously defined on line ${first.line + 1})`,
            vscode.DiagnosticSeverity.Error
          );
          diagnostics.push(diagnostic);
        } else {
          seenLabels.set(labelName, { line: i, col, length: labelName.length + 1 });
        }
      }
    }

    jbasDiagnostics.set(document.uri, diagnostics);
  }

  // Rename Provider: F2 on @label renames all references and definition outside strings
  const renameProvider = vscode.languages.registerRenameProvider('jbas', {
    prepareRename(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) {
        throw new Error('Please place the cursor on a @label to rename it.');
      }
      const rawText = document.getText(range);
      const labelName = rawText.startsWith('@') ? rawText.slice(1) : rawText;
      return {
        range,
        placeholder: labelName
      };
    },

    provideRenameEdits(document, position, newName) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return null;

      const rawOldName = document.getText(range);
      const oldLabel = rawOldName.startsWith('@') ? rawOldName.slice(1) : rawOldName;
      let cleanNewName = newName.trim();
      if (cleanNewName.startsWith('@')) {
        cleanNewName = cleanNewName.slice(1);
      }

      if (!cleanNewName || !/^[a-zA-Z0-9_]+$/.test(cleanNewName)) {
        throw new Error('Invalid label name. Labels must contain only letters, numbers, and underscores.');
      }

      const workspaceEdit = new vscode.WorkspaceEdit();

      for (let lineIdx = 0; lineIdx < document.lineCount; lineIdx++) {
        const lineText = document.lineAt(lineIdx).text;
        let inString = false;
        let i = 0;
        const n = lineText.length;

        while (i < n) {
          const c = lineText[i];
          if (c === '"') {
            inString = !inString;
            i++;
            continue;
          }

          if (!inString && c === '@') {
            const match = lineText.slice(i).match(/^@([a-zA-Z0-9_]+)/);
            if (match && match[1] === oldLabel) {
              const editRange = new vscode.Range(
                lineIdx,
                i,
                lineIdx,
                i + match[0].length
              );
              workspaceEdit.replace(document.uri, editRange, '@' + cleanNewName);
              i += match[0].length;
              continue;
            }
          }
          i++;
        }
      }

      return workspaceEdit;
    }
  });

  // Register commands and language providers
  context.subscriptions.push(
    // Renumber commands (sinclairBasic.renumber & sinclairBasic.renumberBas)
    vscode.commands.registerCommand('sinclairBasic.renumber', handleRenumber),
    vscode.commands.registerCommand('sinclairBasic.renumberBas', handleRenumber),

    // Transpile JBAS to BAS (numbers 10 by 10)
    vscode.commands.registerCommand('sinclairBasic.transpileJBas', handleTranspileJBas),

    // Compile JBAS to TAP (numbers 1 by 1)
    vscode.commands.registerCommand('sinclairBasic.compileJBas', handleCompileJBas),
    vscode.commands.registerCommand('sinclairBasic.compileJBasToTap', handleCompileJBas),

    // Compile BAS (and buildTap alias)
    vscode.commands.registerCommand('sinclairBasic.compileBas', handleCompileBas),
    vscode.commands.registerCommand('sinclairBasic.buildTap', handleCompileBas),

    // Run in Emulator
    vscode.commands.registerCommand('sinclairBasic.runEmulator', handleRunEmulator),
    vscode.commands.registerCommand('sinclairBasic.runTurbo80', handleRunTurbo80),
    vscode.commands.registerCommand('sinclairBasic.runExternalEmulator', handleRunExternalEmulator),

    // Select Executables (Browse dialogs for Settings UI)
    vscode.commands.registerCommand('sinclairBasic.selectBas2tap', handleSelectBas2tap),
    vscode.commands.registerCommand('sinclairBasic.selectEmulator', handleSelectEmulator),

    // Language configuration (auto-indent)
    jbasLanguageConfig,

    // Language providers for .jbas (Ctrl+Click Go to Definition, References, Outline symbols, F2 Rename)
    definitionProvider,
    referenceProvider,
    symbolProvider,
    renameProvider,

    // Diagnostics for duplicate labels
    jbasDiagnostics,
    vscode.workspace.onDidOpenTextDocument(validateJBasDocument),
    vscode.workspace.onDidChangeTextDocument(e => validateJBasDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => jbasDiagnostics.delete(doc.uri))
  );

  // Validate any currently open .jbas documents
  vscode.workspace.textDocuments.forEach(validateJBasDocument);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};

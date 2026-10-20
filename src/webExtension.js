/**
 * Sinclair BASIC - VS Code Web Extension Entry Point
 * Designed for vscode.dev, github.dev, and browser-based VS Code environments.
 */

const vscode = require('vscode');
const { renumberProgram } = require('./core/renumber');
const { compileJBas, transpileJBasAllVersions } = require('./core/jbas2bas');
const { bas2tap, tap2buffer } = require('./core/tapGenerator');
const { formatKeywordsToUpper } = require('./core/formatter');
const { createSinclairCompletionProvider } = require('./core/completions');
const { translateWildcardsToChr } = require('./core/wildcards');

/**
 * Returns the basename of a Uri, optionally stripping an extension.
 * @param {vscode.Uri} uri
 * @param {string} [extToRemove]
 * @returns {string}
 */
function getBaseName(uri, extToRemove = '') {
  const segments = uri.path.split('/');
  const last = segments[segments.length - 1] || 'program';
  if (extToRemove && last.endsWith(extToRemove)) {
    return last.slice(0, -extToRemove.length);
  }
  return last;
}

/**
 * Resolves the destination directory Uri.
 * @param {vscode.Uri} docUri
 * @param {string} outDirName
 * @returns {vscode.Uri}
 */
function getDistUri(docUri, outDirName = 'dist') {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(docUri);
  const rootUri = workspaceFolder ? workspaceFolder.uri : vscode.Uri.joinPath(docUri, '..');
  return vscode.Uri.joinPath(rootUri, outDirName);
}

/**
 * Converts a Uint8Array into a Base64 string in browser environments.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

/**
 * Resolves the target document from an optional command URI parameter or active text editor.
 * @param {vscode.Uri} [uri]
 * @returns {Promise<vscode.TextDocument|null>}
 */
async function getTargetDocument(uri) {
  if (uri) {
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
 * Builds a .tap tape image from a .bas or .jbas file in the browser using native JS.
 * @param {vscode.TextDocument} doc
 * @returns {Promise<{ tapUri: vscode.Uri, autoStartLine: number, tapBytes: Uint8Array, filename: string }>}
 */
async function buildTapFromDocument(doc) {
  const config = vscode.workspace.getConfiguration('sinclairBasic');
  const configuredAutoStart = config.get('autoStartLine', 0);
  const outDirName = config.get('outputDirectory', 'dist');
  const distUri = getDistUri(doc.uri, outDirName);

  await vscode.workspace.fs.createDirectory(distUri);

  let basicCode = doc.getText();
  let baseName = '';

  if (doc.fileName.endsWith('.jbas')) {
    baseName = getBaseName(doc.uri, '.jbas');
    const all = transpileJBasAllVersions(basicCode);

    if (!all.success) {
      throw new Error('Compilation failed:\n' + all.errors.join('\n'));
    }

    const compactUri = vscode.Uri.joinPath(distUri, `${baseName}.bas`);
    const step10Uri = vscode.Uri.joinPath(distUri, `${baseName}-step10.bas`);
    const commentsUri = vscode.Uri.joinPath(distUri, `${baseName}-comments.bas`);
    const sinclairUri = vscode.Uri.joinPath(distUri, `${baseName}.sinclair.bas`);

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(compactUri, encoder.encode(all.compact.text));
    await vscode.workspace.fs.writeFile(step10Uri, encoder.encode(all.step10.text));
    await vscode.workspace.fs.writeFile(commentsUri, encoder.encode(all.comments.text));
    await vscode.workspace.fs.writeFile(sinclairUri, encoder.encode(all.sinclair.text));

    // ALWAYS use the most optimal version (lines 1 by 1, without comments) for TAP generation
    basicCode = all.compact.text;
  } else {
    baseName = getBaseName(doc.uri, '.bas');
    if (!baseName.endsWith('.sinclair')) {
      const sinclairUri = vscode.Uri.joinPath(distUri, `${baseName}.sinclair.bas`);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(sinclairUri, encoder.encode(translateWildcardsToChr(basicCode)));
    }
  }

  let autoStartLine = configuredAutoStart;
  if (autoStartLine <= 0) {
    const match = basicCode.match(/^\s*(\d+)/m);
    autoStartLine = match ? parseInt(match[1], 10) : 10;
  }

  const blocks = bas2tap(basicCode, baseName, autoStartLine);
  const tapBytes = tap2buffer(blocks);

  const targetTapUri = vscode.Uri.joinPath(distUri, `${baseName}.tap`);
  await vscode.workspace.fs.writeFile(targetTapUri, tapBytes);

  return {
    tapUri: targetTapUri,
    autoStartLine,
    tapBytes,
    filename: `${baseName}.tap`
  };
}

/**
 * HTML content for Turbo80 Webview
 */
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

/**
 * Activates the Web Extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  let currentTurbo80Panel = null;

  function runTurbo80Webview(tapBytes, filename) {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const model = config.get('turbo80Model', '48k') || '48k';
    const crt = config.get('turbo80Crt', true);
    const base64 = uint8ArrayToBase64(tapBytes);

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

  // Command: Renumber Lines
  async function handleRenumber(uri) {
    let editor = vscode.window.activeTextEditor;
    if (uri && (!editor || editor.document.uri.toString() !== uri.toString())) {
      const doc = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(doc);
    }

    if (!editor) {
      vscode.window.showInformationMessage('No active Sinclair BASIC (.bas) editor found.');
      return;
    }

    const doc = editor.document;
    if (doc.fileName.endsWith('.jbas')) {
      vscode.window.showWarningMessage('Cannot renumber a .jbas file. .jbas uses labels (@label) without line numbers.');
      return;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const defaultStart = config.get('renumberStart', 10);
    const defaultStep = config.get('renumberStep', 10);

    const startInput = await vscode.window.showInputBox({
      prompt: 'Enter starting line number',
      value: String(defaultStart),
      validateInput: val => (/^\d+$/.test(val) && parseInt(val, 10) > 0 ? null : 'Please enter a positive integer.')
    });
    if (startInput === undefined) return;

    const stepInput = await vscode.window.showInputBox({
      prompt: 'Enter step increment',
      value: String(defaultStep),
      validateInput: val => (/^\d+$/.test(val) && parseInt(val, 10) > 0 ? null : 'Please enter a positive integer.')
    });
    if (stepInput === undefined) return;

    const start = parseInt(startInput, 10);
    const step = parseInt(stepInput, 10);

    try {
      const text = doc.getText();
      const renumbered = renumberProgram(text, { start, step });

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(text.length)
      );

      await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, renumbered);
      });

      vscode.window.showInformationMessage(`Renumbered lines (start: ${start}, step: ${step}).`);
    } catch (err) {
      vscode.window.showErrorMessage(`Renumber error: ${err.message}`);
    }
  }

  // Command: Transpile JBAS to 3 versions
  async function handleTranspileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc || !doc.fileName.endsWith('.jbas')) {
      vscode.window.showInformationMessage('Please select a .jbas file to transpile.');
      return;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const outDirName = config.get('outputDirectory', 'dist');

    const all = transpileJBasAllVersions(doc.getText());
    if (!all.success) {
      vscode.window.showErrorMessage(`Compilation failed:\n${all.errors.join('\n')}`);
      return;
    }

    const distUri = getDistUri(doc.uri, outDirName);
    await vscode.workspace.fs.createDirectory(distUri);

    const baseName = getBaseName(doc.uri, '.jbas');
    const compactUri = vscode.Uri.joinPath(distUri, `${baseName}.bas`);
    const step10Uri = vscode.Uri.joinPath(distUri, `${baseName}-step10.bas`);
    const commentsUri = vscode.Uri.joinPath(distUri, `${baseName}-comments.bas`);
    const sinclairUri = vscode.Uri.joinPath(distUri, `${baseName}.sinclair.bas`);

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(compactUri, encoder.encode(all.compact.text));
    await vscode.workspace.fs.writeFile(step10Uri, encoder.encode(all.step10.text));
    await vscode.workspace.fs.writeFile(commentsUri, encoder.encode(all.comments.text));
    await vscode.workspace.fs.writeFile(sinclairUri, encoder.encode(all.sinclair.text));

    const openedDoc = await vscode.workspace.openTextDocument(step10Uri);
    await vscode.window.showTextDocument(openedDoc);

    vscode.window.showInformationMessage(
      `Transpiled versions to dist/: ${baseName}.bas (1x1), ${baseName}-step10.bas, ${baseName}-comments.bas, ${baseName}.sinclair.bas (standard CHR$)`
    );
  }

  // Command: Compile JBAS to TAP
  async function handleCompileJBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc || !doc.fileName.endsWith('.jbas')) {
      vscode.window.showInformationMessage('Please select a .jbas file to compile.');
      return null;
    }

    try {
      const { tapBytes, autoStartLine, filename } = await buildTapFromDocument(doc);
      vscode.window.showInformationMessage(`Compiled ${filename} (Autostart line ${autoStartLine})`);
      return { tapBytes, filename };
    } catch (err) {
      vscode.window.showErrorMessage(`Compile JBAS error: ${err.message}`);
      return null;
    }
  }

  // Command: Compile BAS to TAP
  async function handleCompileBas(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage('No active editor or file selected.');
      return null;
    }

    if (doc.fileName.endsWith('.jbas')) {
      return await handleCompileJBas(uri);
    }

    try {
      const { tapBytes, autoStartLine, filename } = await buildTapFromDocument(doc);
      vscode.window.showInformationMessage(`Successfully built TAP: ${filename} (Autostart line ${autoStartLine})`);
      return { tapBytes, filename };
    } catch (err) {
      vscode.window.showErrorMessage(`Compile BAS error: ${err.message}`);
      return null;
    }
  }

  // Command: Run in Emulator
  async function handleRunEmulator(uri) {
    const result = await handleCompileBas(uri);
    if (!result) return;
    runTurbo80Webview(result.tapBytes, result.filename);
  }

  // Command: Run in Turbo80 Webview
  async function handleRunTurbo80(uri) {
    const result = await handleCompileBas(uri);
    if (!result) return;
    runTurbo80Webview(result.tapBytes, result.filename);
  }

  // Command: External Emulator notice in web
  async function handleRunExternalEmulator() {
    vscode.window.showInformationMessage('External desktop emulators (e.g. Fuse) require VS Code Desktop. In VS Code Web, the built-in Turbo80 web emulator is used.');
  }

  // Language configuration (auto-indent)
  const jbasLanguageConfig = vscode.languages.setLanguageConfiguration('jbas', {
    onEnterRules: [
      {
        beforeText: /^\s*@[a-zA-Z0-9_]+:\s*$/,
        action: { indentAction: vscode.IndentAction.Indent }
      }
    ]
  });

  // Diagnostics for duplicate labels
  const jbasDiagnostics = vscode.languages.createDiagnosticCollection('jbas');

  function validateJBasDocument(document) {
    if (!document || !document.fileName.endsWith('.jbas')) return;
    const diagnostics = [];
    const seenLabels = new Map();
    const lineCount = document.lineCount;

    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
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
        if (!inString && c === "'") break;

        if (!inString && c === '@') {
          const match = lineText.slice(i).match(/^@([a-zA-Z0-9_]+):/);
          if (match) {
            const labelName = match[1];
            const startCol = i;
            const endCol = i + match[0].length;
            const range = new vscode.Range(lineIdx, startCol, lineIdx, endCol);

            if (seenLabels.has(labelName)) {
              const prev = seenLabels.get(labelName);
              diagnostics.push(new vscode.Diagnostic(
                range,
                `Duplicate label definition: '@${labelName}:' was already defined at line ${prev.line + 1}.`,
                vscode.DiagnosticSeverity.Error
              ));
            } else {
              seenLabels.set(labelName, { line: lineIdx, startCol, endCol });
            }
            i += match[0].length;
            continue;
          }
        }
        i++;
      }
    }
    jbasDiagnostics.set(document.uri, diagnostics);
  }

  // Language providers for .jbas (Ctrl+Click, Outline, References, Rename)
  const definitionProvider = vscode.languages.registerDefinitionProvider('jbas', {
    provideDefinition(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return null;
      const word = document.getText(range);
      const labelName = word.startsWith('@') ? word.slice(1) : word;
      const targetRegex = new RegExp(`^\\s*@${labelName}:`);

      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (targetRegex.test(line.text)) {
          const col = line.text.indexOf(`@${labelName}:`);
          return new vscode.Location(document.uri, new vscode.Position(i, col));
        }
      }
      return null;
    }
  });

  const referenceProvider = vscode.languages.registerReferenceProvider('jbas', {
    provideReferences(document, position) {
      const range = document.getWordRangeAtPosition(position, /@[a-zA-Z0-9_]+/);
      if (!range) return [];
      const word = document.getText(range);
      const labelName = word.startsWith('@') ? word.slice(1) : word;
      const locations = [];

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
          if (!inString && c === "'") break;

          if (!inString && c === '@') {
            const match = lineText.slice(i).match(/^@([a-zA-Z0-9_]+)/);
            if (match && match[1] === labelName) {
              locations.push(new vscode.Location(
                document.uri,
                new vscode.Range(lineIdx, i, lineIdx, i + match[0].length)
              ));
              i += match[0].length;
              continue;
            }
          }
          i++;
        }
      }
      return locations;
    }
  });

  const symbolProvider = vscode.languages.registerDocumentSymbolProvider('jbas', {
    provideDocumentSymbols(document) {
      const symbols = [];
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const match = line.text.match(/^\s*@([a-zA-Z0-9_]+):/);
        if (match) {
          const labelName = match[1];
          const col = line.text.indexOf(`@${labelName}:`);
          const range = new vscode.Range(i, col, i, col + match[0].length);
          symbols.push(new vscode.DocumentSymbol(
            `@${labelName}`,
            'Jump Label',
            vscode.SymbolKind.Function,
            line.range,
            range
          ));
        }
      }
      return symbols;
    }
  });

  const renameProvider = vscode.languages.registerRenameProvider('jbas', {
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
              const editRange = new vscode.Range(lineIdx, i, lineIdx, i + match[0].length);
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

  // Command: Format Keywords to Uppercase in Sinclair BASIC (.bas or .jbas)
  async function handleFormatKeywords(uri) {
    let editor = vscode.window.activeTextEditor;
    if (uri && (!editor || editor.document.uri.toString() !== uri.toString())) {
      const doc = await vscode.workspace.openTextDocument(uri);
      editor = await vscode.window.showTextDocument(doc);
    }

    if (!editor) {
      vscode.window.showInformationMessage('No active Sinclair BASIC (.bas or .jbas) editor found.');
      return;
    }

    const doc = editor.document;
    const isJBas = doc.languageId === 'jbas' || doc.fileName.endsWith('.jbas');

    if (editor.selection && !editor.selection.isEmpty) {
      const sel = editor.selection;
      const fullRange = new vscode.Range(
        new vscode.Position(sel.start.line, 0),
        doc.lineAt(sel.end.line).range.end
      );
      const text = doc.getText(fullRange);
      const formatted = formatKeywordsToUpper(text, { isJBas });
      if (formatted !== text) {
        await editor.edit(editBuilder => {
          editBuilder.replace(fullRange, formatted);
        });
      }
    } else {
      const fullText = doc.getText();
      const formatted = formatKeywordsToUpper(fullText, { isJBas });
      if (formatted !== fullText) {
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(fullText.length)
        );
        await editor.edit(editBuilder => {
          editBuilder.replace(fullRange, formatted);
        });
      }
    }
  }

  // Completion Provider: Sinclair BASIC keywords, functions, attributes, snippets, and @labels
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    ['sinclair-basic', 'jbas'],
    createSinclairCompletionProvider(vscode),
    '@', '{'
  );

  // Document Formatting Provider: Shift+Alt+F or Format Document
  const documentFormattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    ['sinclair-basic', 'jbas'],
    {
      provideDocumentFormattingEdits(document) {
        const isJBas = document.languageId === 'jbas' || document.fileName.endsWith('.jbas');
        const fullText = document.getText();
        const formatted = formatKeywordsToUpper(fullText, { isJBas });
        if (formatted === fullText) return [];
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(fullText.length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    }
  );

  // Document Range Formatting Provider: Format Selection
  const rangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    ['sinclair-basic', 'jbas'],
    {
      provideDocumentRangeFormattingEdits(document, range) {
        const isJBas = document.languageId === 'jbas' || document.fileName.endsWith('.jbas');
        const startLine = range.start.line;
        const endLine = range.end.line;
        const fullRange = new vscode.Range(
          new vscode.Position(startLine, 0),
          document.lineAt(endLine).range.end
        );
        const text = document.getText(fullRange);
        const formatted = formatKeywordsToUpper(text, { isJBas });
        if (formatted === text) return [];
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    }
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sinclairBasic.renumber', handleRenumber),
    vscode.commands.registerCommand('sinclairBasic.renumberBas', handleRenumber),
    vscode.commands.registerCommand('sinclairBasic.formatKeywords', handleFormatKeywords),
    vscode.commands.registerCommand('sinclairBasic.transpileJBas', handleTranspileJBas),
    vscode.commands.registerCommand('sinclairBasic.compileJBas', handleCompileJBas),
    vscode.commands.registerCommand('sinclairBasic.compileJBasToTap', handleCompileJBas),
    vscode.commands.registerCommand('sinclairBasic.compileBas', handleCompileBas),
    vscode.commands.registerCommand('sinclairBasic.buildTap', handleCompileBas),
    vscode.commands.registerCommand('sinclairBasic.runEmulator', handleRunEmulator),
    vscode.commands.registerCommand('sinclairBasic.runTurbo80', handleRunTurbo80),
    vscode.commands.registerCommand('sinclairBasic.runExternalEmulator', handleRunExternalEmulator),
    vscode.commands.registerCommand('sinclairBasic.selectBas2tap', () => vscode.window.showInformationMessage('Executable path selection is only available on desktop.')),
    vscode.commands.registerCommand('sinclairBasic.selectEmulator', () => vscode.window.showInformationMessage('Executable path selection is only available on desktop.')),
    jbasLanguageConfig,
    definitionProvider,
    referenceProvider,
    symbolProvider,
    renameProvider,
    completionProvider,
    documentFormattingProvider,
    rangeFormattingProvider,
    jbasDiagnostics,
    vscode.workspace.onDidOpenTextDocument(validateJBasDocument),
    vscode.workspace.onDidChangeTextDocument(e => validateJBasDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => jbasDiagnostics.delete(doc.uri))
  );

  vscode.workspace.textDocuments.forEach(validateJBasDocument);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};

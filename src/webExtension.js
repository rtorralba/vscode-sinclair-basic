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
const { getBasFoldingRanges } = require('./core/folding');
const { findBasJumpTargetAtPosition, findBasLineIndex } = require('./core/definitions');
const { uploadTapToHost, buildTurbo80ShareUrl } = require('./core/share');
const {
  findDocumentLine,
  findStatementRange,
  SinclairBasicDebugAdapterCore,
  mapSourceLineToBasic,
  mapBasicToSourceLine
} = require('./core/debugger');
const { getTurbo80Html } = require('./core/turbo80Html');

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
  let sourceMap = null;

  if (doc.fileName.endsWith('.jbas')) {
    baseName = getBaseName(doc.uri, '.jbas');
    const all = transpileJBasAllVersions(basicCode);
    sourceMap = all.compact;

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
    filename: `${baseName}.tap`,
    sourceMap
  };
}

/**
 * Activates the Web Extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  let currentTurbo80Panel = null;

  let activeDebugDoc = null;
  let activeDebugLine = null;
  let activeDebugStmt = null;
  let activeDebugVars = [];
  let isDebuggingActive = false;
  let activeDebugAdapter = null;
  let activeDebugSourceMap = null;

  class SinclairBasicDebugAdapter {
    constructor(session) {
      this._sendMessage = new vscode.EventEmitter();
      this.onDidSendMessage = this._sendMessage.event;
      this.session = session;

      this.core = new SinclairBasicDebugAdapterCore({
        sendEvent: (event, body) => {
          this._sendMessage.fire({
            type: 'event',
            event: event,
            body: body
          });
        },
        sendResponse: (response) => {
          this._sendMessage.fire(response);
        },
        onAction: (action, data) => {
          if (action === 'continue') {
            handleDebugContinue();
          } else if (action === 'pause') {
            handleDebugPause();
          } else if (action === 'stepLine') {
            handleDebugStepLine();
          } else if (action === 'stepStmt') {
            handleDebugStepStmt();
          } else if (action === 'restart') {
            handleDebugRestart();
          } else if (action === 'stop') {
            handleDebugStop();
          } else if (action === 'setBreakpoints') {
            if (currentTurbo80Panel) {
              currentTurbo80Panel.webview.postMessage({
                command: 'setBreakpoints',
                breakpoints: data.lines
              });
            }
          }
        }
      });

      if (activeDebugSourceMap) {
        this.core.setSourceMap(activeDebugSourceMap);
      }
      if (activeDebugDoc) {
        this.core.setDocument(activeDebugDoc.fileName, activeDebugDoc.getText());
      }
    }

    handleMessage(message) {
      if (activeDebugSourceMap && !this.core.sourceMap) {
        this.core.setSourceMap(activeDebugSourceMap);
      }
      if (activeDebugDoc && !this.core.currentDocText) {
        this.core.setDocument(activeDebugDoc.fileName, activeDebugDoc.getText());
      }
      this.core.handleMessage(message);
    }

    dispose() {
      this._sendMessage.dispose();
      if (activeDebugAdapter === this) {
        activeDebugAdapter = null;
      }
    }
  }

  const debugLineDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 215, 0, 0.22)',
    overviewRulerColor: 'rgba(255, 215, 0, 0.85)',
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });

  const debugStmtDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 204, 0, 0.45)',
    borderRadius: '3px',
    border: '1px solid rgba(255, 204, 0, 0.9)'
  });

  const debugStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  function getBreakpointsForDocument(document) {
    if (!document) return [];
    const uriStr = document.uri.toString();
    const bps = vscode.debug.breakpoints.filter(b =>
      b instanceof vscode.SourceBreakpoint &&
      b.location.uri.toString() === uriStr &&
      b.enabled !== false
    );
    const basicLines = [];
    const isJBas = document.fileName.endsWith('.jbas') || document.languageId === 'jbas';

    for (const bp of bps) {
      const lineIndex = bp.location.range.start.line;
      if (lineIndex < document.lineCount) {
        if (isJBas && activeDebugSourceMap && activeDebugSourceMap.sourceToBasic) {
          const mapped = mapSourceLineToBasic(lineIndex + 1, activeDebugSourceMap.sourceToBasic);
          if (mapped !== null && mapped !== undefined) {
            basicLines.push(mapped);
          }
        } else {
          const lineText = document.lineAt(lineIndex).text;
          const m = lineText.match(/^\s*(\d+)/);
          if (m) {
            basicLines.push(parseInt(m[1], 10));
          }
        }
      }
    }
    return basicLines;
  }

  function clearDebugDecorations() {
    vscode.window.visibleTextEditors.forEach(editor => {
      editor.setDecorations(debugLineDecoration, []);
      editor.setDecorations(debugStmtDecoration, []);
    });
  }

  function highlightDebugPosition(doc, basicLine, stmt) {
    clearDebugDecorations();
    if (!doc) return;

    let docLine = -1;
    const isJBas = doc.fileName.endsWith('.jbas') || doc.languageId === 'jbas';
    if (isJBas && activeDebugSourceMap && activeDebugSourceMap.basicToSource) {
      const sourceLine1 = mapBasicToSourceLine(basicLine, activeDebugSourceMap.basicToSource);
      docLine = sourceLine1 - 1;
    } else {
      docLine = findDocumentLine(doc.getText(), basicLine);
    }

    if (docLine < 0 || docLine >= doc.lineCount) return;

    const lineText = doc.lineAt(docLine).text;
    const lineRange = new vscode.Range(docLine, 0, docLine, lineText.length);
    const stmtRangeObj = findStatementRange(lineText, stmt);
    const stmtRange = new vscode.Range(docLine, stmtRangeObj.startCol, docLine, stmtRangeObj.endCol);

    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    if (editor) {
      editor.setDecorations(debugLineDecoration, [lineRange]);
      editor.setDecorations(debugStmtDecoration, [stmtRange]);
      editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
      vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true })
        .then(ed => {
          ed.setDecorations(debugLineDecoration, [lineRange]);
          ed.setDecorations(debugStmtDecoration, [stmtRange]);
          ed.revealRange(lineRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }, () => {});
    }
  }

  function handleBasicPaused(line, stmt, vars) {
    activeDebugLine = line;
    activeDebugStmt = stmt;
    activeDebugVars = Array.isArray(vars) ? vars : [];

    vscode.commands.executeCommand('setContext', 'sinclairBasic.isDebugging', true);
    vscode.commands.executeCommand('setContext', 'sinclairBasic.isPaused', true);

    const isJBas = activeDebugDoc && (activeDebugDoc.fileName.endsWith('.jbas') || activeDebugDoc.languageId === 'jbas');
    if (isJBas && activeDebugSourceMap && activeDebugSourceMap.basicToSource) {
      const sourceLine1 = mapBasicToSourceLine(line, activeDebugSourceMap.basicToSource);
      debugStatusBarItem.text = `$(debug-pause) JBAS: L${sourceLine1} (BASIC: ${line}, Sent. ${stmt})`;
      debugStatusBarItem.tooltip = `Sinclair BASIC pausado en .jbas línea ${sourceLine1} (línea compilada ${line}, sentencia ${stmt}).\nHaz clic para inspeccionar variables en RAM.`;
    } else {
      debugStatusBarItem.text = `$(debug-pause) BASIC: Línea ${line} (Sent. ${stmt})`;
      debugStatusBarItem.tooltip = `Sinclair BASIC pausado en línea ${line}, sentencia ${stmt}.\nHaz clic para inspeccionar variables en RAM.`;
    }
    debugStatusBarItem.command = 'sinclairBasic.showDebugVariables';
    debugStatusBarItem.show();

    if (activeDebugDoc) {
      highlightDebugPosition(activeDebugDoc, line, stmt);
    }

    if (activeDebugAdapter) {
      if (activeDebugSourceMap) {
        activeDebugAdapter.core.setSourceMap(activeDebugSourceMap);
      }
      if (activeDebugDoc) {
        activeDebugAdapter.core.setDocument(activeDebugDoc.fileName, activeDebugDoc.getText());
      }
      activeDebugAdapter.core.notifyPaused(line, stmt, activeDebugVars);
    }
  }

  function handleBasicResumed() {
    clearDebugDecorations();
    vscode.commands.executeCommand('setContext', 'sinclairBasic.isPaused', false);
    if (isDebuggingActive) {
      debugStatusBarItem.text = '$(play) BASIC: Ejecutando...';
      debugStatusBarItem.tooltip = 'Sinclair BASIC en ejecución en Turbo80';
      debugStatusBarItem.show();
    }
    if (activeDebugAdapter) {
      activeDebugAdapter.core.notifyResumed();
    }
  }

  function handleDebugStopped() {
    isDebuggingActive = false;
    activeDebugDoc = null;
    activeDebugSourceMap = null;
    activeDebugLine = null;
    activeDebugStmt = null;
    activeDebugVars = [];
    clearDebugDecorations();
    debugStatusBarItem.hide();
    vscode.commands.executeCommand('setContext', 'sinclairBasic.isDebugging', false);
    vscode.commands.executeCommand('setContext', 'sinclairBasic.isPaused', false);

    if (activeDebugAdapter) {
      activeDebugAdapter.core.notifyTerminated();
      activeDebugAdapter = null;
    }
    if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'sinclair-basic') {
      vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
    }
  }

  function runTurbo80Webview(tapBytes, filename, options = {}) {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const model = config.get('turbo80Model', '48k') || '48k';
    const crt = config.get('turbo80Crt', true);
    const base64 = uint8ArrayToBase64(tapBytes);

    const isDebug = !!options.debug;
    const breakpoints = Array.isArray(options.breakpoints) ? options.breakpoints : [];
    const stopOnEntry = options.stopOnEntry !== undefined ? options.stopOnEntry : (breakpoints.length === 0);

    if (isDebug) {
      isDebuggingActive = true;
      activeDebugDoc = options.doc || null;
      vscode.commands.executeCommand('setContext', 'sinclairBasic.isDebugging', true);
      debugStatusBarItem.text = '$(play) BASIC: Iniciando depurador...';
      debugStatusBarItem.show();
    }

    const payload = {
      command: 'loadTap',
      base64,
      filename,
      model,
      crt,
      debug: isDebug,
      breakpoints,
      stopOnEntry
    };

    if (currentTurbo80Panel) {
      currentTurbo80Panel.reveal(vscode.ViewColumn.Beside, false);
      currentTurbo80Panel.title = `ZX: ${filename}${isDebug ? ' (Debug)' : ''}`;
      currentTurbo80Panel.webview.postMessage(payload);
    } else {
      currentTurbo80Panel = vscode.window.createWebviewPanel(
        'sinclairBasicTurbo80',
        `ZX: ${filename}${isDebug ? ' (Debug)' : ''}`,
        {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, 'media')
          ]
        }
      );

      currentTurbo80Panel.webview.html = getTurbo80Html(currentTurbo80Panel.webview, context.extensionUri, vscode);

      currentTurbo80Panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'ready') {
          currentTurbo80Panel.webview.postMessage(payload);
        } else if (message.command === 'basicPaused') {
          handleBasicPaused(message.line, message.stmt, message.vars);
        } else if (message.command === 'basicResumed') {
          handleBasicResumed();
        } else if (message.command === 'debugStopped') {
          handleDebugStopped();
        }
      });

      currentTurbo80Panel.onDidDispose(() => {
        currentTurbo80Panel = null;
        handleDebugStopped();
      });
    }
  }

  async function handleDebugTurbo80(uri) {
    const doc = await getTargetDocument(uri);
    if (!doc) {
      vscode.window.showInformationMessage('No active editor or Sinclair BASIC file selected.');
      return;
    }
    let res = null;
    if (doc.fileName.endsWith('.jbas')) {
      res = await handleCompileJBas(uri);
    } else if (doc.fileName.endsWith('.bas')) {
      res = await handleCompileBas(uri);
    } else {
      vscode.window.showWarningMessage('Please select a .bas or .jbas file to debug.');
      return;
    }
    if (!res) return;

    activeDebugDoc = doc;
    const breakpoints = getBreakpointsForDocument(doc);
    const stopOnEntry = (breakpoints.length === 0);
    runTurbo80Webview(res.tapBytes, res.filename, {
      debug: true,
      breakpoints,
      doc,
      stopOnEntry
    });

    await vscode.debug.startDebugging(undefined, {
      type: 'sinclair-basic',
      name: `Sinclair BASIC: ${res.filename}`,
      request: 'launch',
      program: doc.fileName,
      stopOnEntry
    });
  }

  function handleDebugContinue() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: 'debugContinue' });
    }
  }

  function handleDebugPause() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: 'debugPause' });
    }
  }

  function handleDebugStepLine() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: 'debugStepLine' });
    }
  }

  function handleDebugStepStmt() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: 'debugStepStmt' });
    }
  }

  function handleDebugRestart() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: 'debugRestart' });
    }
  }

  function handleDebugStop() {
    if (currentTurbo80Panel) {
      currentTurbo80Panel.webview.postMessage({ command: 'debugStop' });
    }
    handleDebugStopped();
  }

  function handleToggleBreakpoint() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri;
    const line = editor.selection.active.line;
    const existing = vscode.debug.breakpoints.find(b =>
      b instanceof vscode.SourceBreakpoint &&
      b.location.uri.toString() === uri.toString() &&
      b.location.range.start.line === line
    );
    if (existing) {
      vscode.debug.removeBreakpoints([existing]);
    } else {
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line, 0)))
      ]);
    }
  }

  async function handleShowDebugVariables() {
    if (!isDebuggingActive || activeDebugVars.length === 0) {
      vscode.window.showInformationMessage('Sin variables activas en RAM del ZX Spectrum en este momento.');
      return;
    }
    const items = activeDebugVars.map(v => ({
      label: `${v.name} = ${v.type === 'string' ? '"' + v.value + '"' : v.value}`,
      description: `Tipo: ${v.type}${v.length !== undefined ? ` (longitud: ${v.length})` : ''}`,
      detail: `Línea actual: ${activeDebugLine}, Sentencia: ${activeDebugStmt}`
    }));
    await vscode.window.showQuickPick(items, {
      title: `Variables ZX Spectrum (Línea ${activeDebugLine}, Sentencia ${activeDebugStmt})`,
      placeHolder: 'Inspección de variables en memoria RAM'
    });
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
      const { tapBytes, autoStartLine, filename, sourceMap } = await buildTapFromDocument(doc);
      activeDebugSourceMap = sourceMap;
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

    activeDebugSourceMap = null;

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

  // Command: Share on Turbo80.com (compiles/locates TAP, uploads, and generates shareable link)
  async function handleShareTurbo80(uri) {
    let tapBytes = null;
    let filename = '';

    // Check if clicked directly on a .tap file in Explorer
    if (uri && uri.path && uri.path.toLowerCase().endsWith('.tap')) {
      try {
        tapBytes = await vscode.workspace.fs.readFile(uri);
        filename = getBaseName(uri);
      } catch (err) {
        vscode.window.showErrorMessage(`Error al leer archivo TAP: ${err.message}`);
        return;
      }
    } else {
      // Otherwise compile active or selected .bas / .jbas document
      const result = await handleCompileBas(uri);
      if (!result) return;
      tapBytes = result.tapBytes;
      filename = result.filename;
    }

    try {
      const config = vscode.workspace.getConfiguration('sinclairBasic');
      const model = config.get('turbo80Model', '48k') || '48k';
      const crt = config.get('turbo80Crt', true);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Compartiendo ${filename} en Turbo80.com...`,
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Subiendo archivo .tap...' });
          const publicTapUrl = await uploadTapToHost(tapBytes, filename);

          progress.report({ message: 'Generando enlace web de Turbo80...' });
          const shareUrl = buildTurbo80ShareUrl(publicTapUrl, { model, crt });

          await vscode.env.clipboard.writeText(shareUrl);

          const choice = await vscode.window.showInformationMessage(
            `¡Cinta compartida! Enlace de Turbo80 copiado al portapapeles:\n${shareUrl}`,
            'Abrir en el Navegador',
            'Copiar Enlace'
          );

          if (choice === 'Abrir en el Navegador') {
            await vscode.env.openExternal(vscode.Uri.parse(shareUrl));
          } else if (choice === 'Copiar Enlace') {
            await vscode.env.clipboard.writeText(shareUrl);
          }
        }
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Error al compartir en Turbo80: ${err.message}`);
    }
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

  // Definition Provider for Sinclair BASIC (.bas): Ctrl+Click on jump line number (e.g. GO SUB 500, GO TO 100)
  const basDefinitionProvider = vscode.languages.registerDefinitionProvider('sinclair-basic', {
    provideDefinition(document, position) {
      const lineText = document.lineAt(position.line).text;
      const jumpTarget = findBasJumpTargetAtPosition(lineText, position.character);
      if (!jumpTarget) return null;

      const targetLoc = findBasLineIndex(document, jumpTarget.targetLineNumber);
      if (!targetLoc) return null;

      const originRange = new vscode.Range(
        position.line,
        jumpTarget.startCol,
        position.line,
        jumpTarget.endCol
      );
      const targetPos = new vscode.Position(targetLoc.lineIndex, targetLoc.col);
      const targetRange = new vscode.Range(targetPos, targetPos);

      return [
        {
          originSelectionRange: originRange,
          targetUri: document.uri,
          targetRange: targetRange,
          targetSelectionRange: targetRange
        }
      ];
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

  // Subroutine Folding Range Provider for Sinclair BASIC (.bas functions called via GO SUB)
  const basFoldingProvider = vscode.languages.registerFoldingRangeProvider('sinclair-basic', {
    provideFoldingRanges(document) {
      const ranges = getBasFoldingRanges(document.getText());
      return ranges.map(r => new vscode.FoldingRange(r.start, r.end, vscode.FoldingRangeKind.Region));
    }
  });

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
    vscode.commands.registerCommand('sinclairBasic.shareTurbo80', handleShareTurbo80),

    // Debugger commands for Sinclair BASIC (48K step-by-step & variables)
    vscode.commands.registerCommand('sinclairBasic.debugTurbo80', handleDebugTurbo80),
    vscode.commands.registerCommand('sinclairBasic.debugContinue', handleDebugContinue),
    vscode.commands.registerCommand('sinclairBasic.debugPause', handleDebugPause),
    vscode.commands.registerCommand('sinclairBasic.debugStepLine', handleDebugStepLine),
    vscode.commands.registerCommand('sinclairBasic.debugStepStmt', handleDebugStepStmt),
    vscode.commands.registerCommand('sinclairBasic.debugRestart', handleDebugRestart),
    vscode.commands.registerCommand('sinclairBasic.debugStop', handleDebugStop),
    vscode.commands.registerCommand('sinclairBasic.toggleBreakpoint', handleToggleBreakpoint),
    vscode.commands.registerCommand('sinclairBasic.showDebugVariables', handleShowDebugVariables),
    vscode.debug.registerDebugAdapterDescriptorFactory('sinclair-basic', {
      createDebugAdapterDescriptor(session) {
        activeDebugAdapter = new SinclairBasicDebugAdapter(session);
        return new vscode.DebugAdapterInlineImplementation(activeDebugAdapter);
      }
    }),
    vscode.debug.registerDebugConfigurationProvider('sinclair-basic', {
      provideDebugConfigurations() {
        return [
          {
            type: 'sinclair-basic',
            request: 'launch',
            name: 'Debug Sinclair BASIC (Turbo80)'
          }
        ];
      },
      async resolveDebugConfiguration(folder, config) {
        let program = config.program;
        if (!program) {
          const editor = vscode.window.activeTextEditor;
          if (editor && (editor.document.languageId === 'sinclair-basic' || editor.document.languageId === 'jbas')) {
            program = editor.document.fileName;
          }
        }
        if (!program) {
          vscode.window.showWarningMessage('Please select a .bas or .jbas file to debug.');
          return undefined;
        }
        config.type = 'sinclair-basic';
        config.request = 'launch';
        config.name = config.name || `Sinclair BASIC: ${program.split('/').pop().split('\\').pop()}`;
        config.program = program;

        if (!isDebuggingActive) {
          const editor = vscode.window.activeTextEditor;
          const doc = (editor && editor.document.fileName === program)
            ? editor.document
            : await vscode.workspace.openTextDocument(vscode.Uri.parse(program));

          let res = null;
          if (program.endsWith('.jbas')) {
            res = await handleCompileJBas(doc.uri);
          } else {
            res = await handleCompileBas(doc.uri);
          }
          if (!res) return undefined;
          activeDebugDoc = doc;
          const breakpoints = getBreakpointsForDocument(doc);
          config.stopOnEntry = (breakpoints.length === 0);
          runTurbo80Webview(res.tapBytes, res.filename, {
            debug: true,
            breakpoints,
            doc,
            stopOnEntry: config.stopOnEntry
          });
        }
        return config;
      }
    }),
    vscode.debug.onDidTerminateDebugSession(session => {
      if (session.type === 'sinclair-basic') {
        handleDebugStop();
      }
    }),
    debugStatusBarItem,
    debugLineDecoration,
    debugStmtDecoration,
    vscode.debug.onDidChangeBreakpoints(() => {
      if (isDebuggingActive && activeDebugDoc && currentTurbo80Panel) {
        const bps = getBreakpointsForDocument(activeDebugDoc);
        currentTurbo80Panel.webview.postMessage({
          command: 'setBreakpoints',
          breakpoints: bps
        });
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (isDebuggingActive && activeDebugDoc && editor && editor.document.uri.toString() === activeDebugDoc.uri.toString()) {
        if (activeDebugLine !== null && activeDebugStmt !== null) {
          highlightDebugPosition(activeDebugDoc, activeDebugLine, activeDebugStmt);
        }
      }
    }),
    vscode.commands.registerCommand('sinclairBasic.selectBas2tap', () => vscode.window.showInformationMessage('Executable path selection is only available on desktop.')),
    vscode.commands.registerCommand('sinclairBasic.selectEmulator', () => vscode.window.showInformationMessage('Executable path selection is only available on desktop.')),
    jbasLanguageConfig,
    definitionProvider,
    referenceProvider,
    symbolProvider,
    renameProvider,
    basDefinitionProvider,
    completionProvider,
    documentFormattingProvider,
    rangeFormattingProvider,
    basFoldingProvider,
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

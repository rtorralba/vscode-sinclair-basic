/**
 * Sinclair BASIC - VS Code Extension Entry Point
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { renumberProgram } = require('./core/renumber');
const { compileJBas, transpileJBasAllVersions } = require('./core/jbas2bas');
const { generateTapFile } = require('./core/tapGenerator');
const { formatKeywordsToUpper } = require('./core/formatter');
const { createSinclairCompletionProvider } = require('./core/completions');
const { translateWildcardsToChr } = require('./core/wildcards');
const { getBasFoldingRanges } = require('./core/folding');
const { findBasJumpTargetAtPosition, findBasLineIndex } = require('./core/definitions');
const { uploadTapToHost, buildTurbo80ShareUrl } = require('./core/share');
const {
  ROM48_STMT_ADDR,
  decodeSinclairFloat,
  readSpectrumVariables,
  findDocumentLine,
  findStatementRange,
  getStatementRanges,
  findStatementIndexAtColumn,
  SinclairBasicDebugAdapterCore,
  mapSourceLineToBasic,
  mapBasicToSourceLine
} = require('./core/debugger');
const { getTurbo80Html } = require('./core/turbo80Html');
const { extractProgramsFromTap, tapToBas, tapToJBas } = require('./core/tapDecoder');
const { basToJBas } = require('./core/bas2jbas');
const { RetroModeController } = require('./core/retroMode');

let retroModeController = null;

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

  // Always generate <baseName>.sinclair.bas translating bas2tap wildcards to standard Sinclair BASIC CHR$
  if (!baseName.endsWith('.sinclair')) {
    const basicContent = fs.readFileSync(basPath, 'utf-8');
    const sinclairContent = translateWildcardsToChr(basicContent);
    const sinclairPath = path.join(outputDir, `${baseName}.sinclair.bas`);
    fs.writeFileSync(sinclairPath, sinclairContent, 'utf-8');
  }

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
    const optimizePrintAttributes = config.get('optimizePrintAttributes', true);

    const sourceText = doc.getText();
    const all = transpileJBasAllVersions(sourceText, { optimizePrintAttributes });

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
    const sinclairPath = path.join(distDir, `${baseName}.sinclair.bas`);

    fs.writeFileSync(compactPath, all.compact.text, 'utf-8');
    fs.writeFileSync(step10Path, all.step10.text, 'utf-8');
    fs.writeFileSync(commentsPath, all.comments.text, 'utf-8');
    fs.writeFileSync(sinclairPath, all.sinclair.text, 'utf-8');

    const openDoc = await vscode.workspace.openTextDocument(step10Path);
    await vscode.window.showTextDocument(openDoc, { preview: false });

    vscode.window.showInformationMessage(
      `Transpiled versions to dist/: ${baseName}.bas (1x1), ${baseName}-step10.bas, ${baseName}-comments.bas, ${baseName}.sinclair.bas (standard CHR$)`
    );
    return step10Path;
  }

  // Command: Compile JBAS to TAP (generates all versions, builds .tap strictly from optimal 1x1 no-comments version)
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
    const optimizePrintAttributes = config.get('optimizePrintAttributes', true);

    const sourceText = doc.getText();
    const all = transpileJBasAllVersions(sourceText, { optimizePrintAttributes });
    activeDebugSourceMap = all.compact;

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
    const sinclairPath = path.join(distDir, `${baseName}.sinclair.bas`);

    // Write all versions so dist is always complete and synchronized
    fs.writeFileSync(compactPath, all.compact.text, 'utf-8');
    fs.writeFileSync(step10Path, all.step10.text, 'utf-8');
    fs.writeFileSync(commentsPath, all.comments.text, 'utf-8');
    fs.writeFileSync(sinclairPath, all.sinclair.text, 'utf-8');

    // Build .tap strictly from the most optimal version: lines 1 by 1 and without comments (compactPath)
    try {
      const { tapPath, autoStartLine } = await buildTapFromBas(compactPath, distDir);
      vscode.window.showInformationMessage(
        `Compiled ${baseName}.jbas → dist/${baseName}.tap (using optimal 1x1 no-comments version) & generated ${baseName}.sinclair.bas (Autostart line ${autoStartLine})`
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

    activeDebugSourceMap = null;

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
                breakpoints: data.breakpoints || data.lines
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
    const targetBreakpoints = [];
    const isJBas = document.fileName.endsWith('.jbas') || document.languageId === 'jbas';

    for (const bp of bps) {
      const lineIndex = bp.location.range.start.line;
      if (lineIndex < document.lineCount) {
        const lineText = document.lineAt(lineIndex).text;
        const col1 = (bp.location.range.start.character || 0) + 1;
        const stmtIndex = findStatementIndexAtColumn(lineText, col1);

        let basicLine = null;
        if (isJBas && activeDebugSourceMap && activeDebugSourceMap.sourceToBasic) {
          basicLine = mapSourceLineToBasic(lineIndex + 1, activeDebugSourceMap.sourceToBasic);
        } else {
          const m = lineText.match(/^\s*(\d+)/);
          if (m) {
            basicLine = parseInt(m[1], 10);
          } else {
            basicLine = lineIndex + 1;
          }
        }
        if (basicLine !== null && basicLine !== undefined) {
          targetBreakpoints.push({ line: basicLine, stmt: stmtIndex });
        }
      }
    }
    return targetBreakpoints;
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

  function runTurbo80Webview(tapPath, options = {}) {
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const model = config.get('turbo80Model', '48k') || '48k';
    const crt = config.get('turbo80Crt', true);
    const filename = path.basename(tapPath);
    const tapBuffer = fs.readFileSync(tapPath);
    const base64 = tapBuffer.toString('base64');

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
    let tapPath = null;
    if (doc.fileName.endsWith('.jbas')) {
      tapPath = await handleCompileJBas(uri);
    } else if (doc.fileName.endsWith('.bas')) {
      tapPath = await handleCompileBas(uri);
    } else {
      vscode.window.showWarningMessage('Please select a .bas or .jbas file to debug.');
      return;
    }
    if (!tapPath) return;

    activeDebugDoc = doc;
    const breakpoints = getBreakpointsForDocument(doc);
    const stopOnEntry = (breakpoints.length === 0);
    runTurbo80Webview(tapPath, {
      debug: true,
      breakpoints,
      doc,
      stopOnEntry
    });

    await vscode.debug.startDebugging(undefined, {
      type: 'sinclair-basic',
      name: `Sinclair BASIC: ${path.basename(doc.fileName)}`,
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
    const pos = editor.selection.active;
    const line = pos.line;
    const lineText = editor.document.lineAt(line).text;
    const ranges = getStatementRanges(lineText);

    if (ranges.length > 1) {
      const curStmt = findStatementIndexAtColumn(lineText, pos.character + 1);
      const targetRange = ranges[curStmt - 1];
      const targetCol = targetRange ? targetRange.startCol : 0;

      const existing = vscode.debug.breakpoints.find(b =>
        b instanceof vscode.SourceBreakpoint &&
        b.location.uri.toString() === uri.toString() &&
        b.location.range.start.line === line &&
        targetRange &&
        b.location.range.start.character >= targetRange.startCol &&
        b.location.range.start.character <= targetRange.endCol
      );

      if (existing) {
        vscode.debug.removeBreakpoints([existing]);
      } else {
        vscode.debug.addBreakpoints([
          new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line, targetCol)))
        ]);
      }
    } else {
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

  // Command: Share on Turbo80.com (compiles/locates TAP, uploads, and generates shareable link)
  async function handleShareTurbo80(uri) {
    let tapPath = null;
    let filename = '';

    // Check if clicked directly on a .tap file in Explorer
    if (uri && uri.fsPath && uri.fsPath.toLowerCase().endsWith('.tap') && fs.existsSync(uri.fsPath)) {
      tapPath = uri.fsPath;
      filename = path.basename(tapPath);
    } else {
      // Otherwise compile active or selected .bas / .jbas document
      const doc = await getTargetDocument(uri);
      if (!doc) {
        vscode.window.showInformationMessage('No active editor or Sinclair BASIC file selected.');
        return;
      }

      const filePath = doc.fileName;
      if (filePath.endsWith('.jbas')) {
        tapPath = await handleCompileJBas(uri);
      } else if (filePath.endsWith('.bas')) {
        tapPath = await handleCompileBas(uri);
      } else {
        vscode.window.showWarningMessage('Please select a .bas, .jbas, or .tap file to share.');
        return;
      }

      if (!tapPath) return;
      filename = path.basename(tapPath);
    }

    try {
      const tapBytes = fs.readFileSync(tapPath);
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
          const publicTapUrl = await uploadTapToHost(tapBytes, filename, fetch, {
            onProgress: (msg) => progress.report({ message: msg })
          });

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

  // Command: Import .bas and/or .jbas from TAP file
  async function handleImportTap(uri, format = 'both') {
    let tapPath = null;

    if (uri && uri.fsPath && uri.fsPath.toLowerCase().endsWith('.tap') && fs.existsSync(uri.fsPath)) {
      tapPath = uri.fsPath;
    } else {
      let defaultUri;
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        defaultUri = vscode.workspace.workspaceFolders[0].uri;
      }
      const fileUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri,
        openLabel: 'Import Sinclair BASIC from TAP',
        filters: { 'ZX Spectrum TAP files (*.tap)': ['tap'], 'All Files (*.*)': ['*'] }
      });
      if (fileUris && fileUris[0]) {
        tapPath = fileUris[0].fsPath;
      }
    }

    if (!tapPath) return;

    try {
      const tapBytes = fs.readFileSync(tapPath);
      const programs = extractProgramsFromTap(tapBytes);

      if (!programs || programs.length === 0) {
        vscode.window.showErrorMessage(
          `No Sinclair BASIC program found in '${path.basename(tapPath)}'. (The tape may only contain machine code or screen blocks).`
        );
        return;
      }

      // Determine output directory: if tap is inside dist/, save to parent directory (project root)
      let targetDir = path.dirname(tapPath);
      if (path.basename(targetDir).toLowerCase() === 'dist') {
        targetDir = path.dirname(targetDir);
      }

      const tapBase = path.basename(tapPath, path.extname(tapPath));
      let createdBasPath = null;
      let createdJbasPath = null;

      for (let pIdx = 0; pIdx < programs.length; pIdx++) {
        const prog = programs[pIdx];
        const prefix = programs.length === 1 ? tapBase : `${tapBase}_${prog.name}`;
        const basFile = path.join(targetDir, `${prefix}.bas`);
        const jbasFile = path.join(targetDir, `${prefix}.jbas`);

        if (format === 'both' || format === 'bas') {
          fs.writeFileSync(basFile, prog.basText, 'utf-8');
          createdBasPath = basFile;
        }

        if (format === 'both' || format === 'jbas') {
          fs.writeFileSync(jbasFile, prog.jbasText, 'utf-8');
          createdJbasPath = jbasFile;
        }
      }

      // Open primary created file in editor
      const primaryPath = createdJbasPath || createdBasPath;
      if (primaryPath) {
        const doc = await vscode.workspace.openTextDocument(primaryPath);
        await vscode.window.showTextDocument(doc);
      }

      const prog0 = programs[0];
      const items = [];
      if (createdJbasPath) items.push('Open .jbas');
      if (createdBasPath) items.push('Open .bas');

      const msg = (format === 'bas')
        ? `Sinclair BASIC imported from ${path.basename(tapPath)} (${prog0.linesCount} lines): created ${path.basename(createdBasPath)}`
        : (format === 'jbas')
        ? `Sinclair BASIC imported from ${path.basename(tapPath)} (${prog0.linesCount} lines): created ${path.basename(createdJbasPath)}`
        : `Sinclair BASIC imported from ${path.basename(tapPath)} (${prog0.linesCount} lines): created ${path.basename(createdBasPath)} and ${path.basename(createdJbasPath)}`;

      const choice = await vscode.window.showInformationMessage(msg, ...items);
      if (choice === 'Open .jbas' && createdJbasPath) {
        const doc = await vscode.workspace.openTextDocument(createdJbasPath);
        await vscode.window.showTextDocument(doc);
      } else if (choice === 'Open .bas' && createdBasPath) {
        const doc = await vscode.workspace.openTextDocument(createdBasPath);
        await vscode.window.showTextDocument(doc);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Error importing Sinclair BASIC from TAP: ${err.message}`);
    }
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

  // Command: Format Keywords to Uppercase in Sinclair BASIC (.bas or .jbas)
  async function handleFormatKeywords(uri) {
    let editor = vscode.window.activeTextEditor;
    if (uri && uri.fsPath && (!editor || editor.document.uri.toString() !== uri.toString())) {
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

  // Register commands and language providers
  context.subscriptions.push(
    // Renumber commands (sinclairBasic.renumber & sinclairBasic.renumberBas)
    vscode.commands.registerCommand('sinclairBasic.renumber', handleRenumber),
    vscode.commands.registerCommand('sinclairBasic.renumberBas', handleRenumber),

    // Format keywords to uppercase
    vscode.commands.registerCommand('sinclairBasic.formatKeywords', handleFormatKeywords),

    // Transpile JBAS to BAS (numbers 10 by 10)
    vscode.commands.registerCommand('sinclairBasic.transpileJBas', handleTranspileJBas),

    // Compile JBAS to TAP (numbers 1 by 1)
    vscode.commands.registerCommand('sinclairBasic.compileJBas', handleCompileJBas),
    vscode.commands.registerCommand('sinclairBasic.compileJBasToTap', handleCompileJBas),

    // Compile BAS (and buildTap alias)
    vscode.commands.registerCommand('sinclairBasic.compileBas', handleCompileBas),
    vscode.commands.registerCommand('sinclairBasic.buildTap', handleCompileBas),

    // Run in Emulator & Share
    vscode.commands.registerCommand('sinclairBasic.runEmulator', handleRunEmulator),
    vscode.commands.registerCommand('sinclairBasic.runTurbo80', handleRunTurbo80),
    vscode.commands.registerCommand('sinclairBasic.runExternalEmulator', handleRunExternalEmulator),
    vscode.commands.registerCommand('sinclairBasic.shareTurbo80', handleShareTurbo80),

    // Import from TAP (.bas and .jbas)
    vscode.commands.registerCommand('sinclairBasic.importTap', (uri) => handleImportTap(uri, 'both')),
    vscode.commands.registerCommand('sinclairBasic.importTapToBas', (uri) => handleImportTap(uri, 'bas')),
    vscode.commands.registerCommand('sinclairBasic.importTapToJBas', (uri) => handleImportTap(uri, 'jbas')),

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
        config.name = config.name || `Sinclair BASIC: ${path.basename(program)}`;
        config.program = program;

        if (!isDebuggingActive) {
          const fileUri = vscode.Uri.file(program);
          const doc = await vscode.workspace.openTextDocument(fileUri);
          let tapPath = null;
          if (program.endsWith('.jbas')) {
            tapPath = await handleCompileJBas(fileUri);
          } else {
            tapPath = await handleCompileBas(fileUri);
          }
          if (!tapPath) return undefined;
          activeDebugDoc = doc;
          const breakpoints = getBreakpointsForDocument(doc);
          config.stopOnEntry = (breakpoints.length === 0);
          runTurbo80Webview(tapPath, {
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

    // Autocompletion, formatting & folding providers
    completionProvider,
    documentFormattingProvider,
    rangeFormattingProvider,
    basFoldingProvider,
    basDefinitionProvider,

    // Diagnostics for duplicate labels
    jbasDiagnostics,
    vscode.workspace.onDidOpenTextDocument(validateJBasDocument),
    vscode.workspace.onDidChangeTextDocument(e => validateJBasDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => jbasDiagnostics.delete(doc.uri))
  );

  // Initialize Sinclair BASIC Retro Mode (ZX Spectrum 48K)
  retroModeController = new RetroModeController(vscode, context);
  retroModeController.init();
  context.subscriptions.push(retroModeController);

  // Validate any currently open .jbas documents
  vscode.workspace.textDocuments.forEach(validateJBasDocument);
}

function deactivate() {
  if (retroModeController) {
    retroModeController.dispose();
    retroModeController = null;
  }
}

module.exports = {
  activate,
  deactivate
};

/**
 * Sinclair BASIC Retro Mode
 * Authentic ZX Spectrum editor experience:
 * 1. Simple switch (ON / OFF).
 * 2. Editor-only white Paper 7 screen with black Ink 0 text (rest of IDE stays dark/normal).
 * 3. Authentic ZX Spectrum 8x8 font, enlarged for retro feel.
 * 4. Auto-uppercase keyword formatting on Enter.
 * 5. Authentic 48K ROM keyclick/Enter beep (~987 Hz square wave).
 * 6. Clean restoration to normal editor settings when turned OFF.
 */

const path = require('path');
const fs = require('fs');

let spawn = null;
let execFileSync = null;
try {
  const cp = require('child_process');
  spawn = cp.spawn;
  execFileSync = cp.execFileSync;
} catch {
  // Web extension / browser environment
}

const { formatLineKeywords } = require('./formatter');

/**
 * Ensures the authentic ZX Spectrum TrueType font is registered in Windows HKCU fonts.
 * @param {string} [extensionPath]
 */
function ensureFontInstalled(extensionPath) {
  if (process.platform !== 'win32' || !execFileSync || !extensionPath) return;

  try {
    const fontSrc = path.join(extensionPath, 'media', 'fonts', 'ZXSpectrum.ttf');
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData || !fs.existsSync(fontSrc)) return;

    const fontDir = path.join(localAppData, 'Microsoft', 'Windows', 'Fonts');
    const fontDest = path.join(fontDir, 'ZXSpectrum.ttf');

    if (!fs.existsSync(fontDir)) {
      fs.mkdirSync(fontDir, { recursive: true });
    }

    if (!fs.existsSync(fontDest)) {
      fs.copyFileSync(fontSrc, fontDest);
    }

    // Register font in current user registry (no admin required)
    execFileSync('reg.exe', [
      'add',
      'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
      '/v',
      'ZX Spectrum Unicode (TrueType)',
      '/t',
      'REG_SZ',
      '/d',
      fontDest,
      '/f'
    ], { stdio: 'ignore' });
  } catch {
    // Non-critical: falls back to system monospace font
  }
}

/**
 * Detects whether the Sinclair ZX Spectrum cursor would be in Keyword [K]
 * or Letter/Literal [L] mode based on the current line text and column index.
 * 
 * @param {string} lineText The text of the current line
 * @param {number} columnIndex Cursor column index (0-based)
 * @param {boolean} isJBas Whether the document is .jbas (supports @labels)
 * @returns {'K'|'L'}
 */
function detectCursorMode(lineText, columnIndex, isJBas = false) {
  if (!lineText || columnIndex <= 0) {
    return 'K';
  }

  const prefix = lineText.slice(0, columnIndex);

  let insideString = false;
  let lastStatementStart = 0;

  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (ch === '"') {
      insideString = !insideString;
    } else if (!insideString && ch === ':') {
      lastStatementStart = i + 1;
    }
  }

  if (insideString) {
    return 'L';
  }

  const stmt = prefix.slice(lastStatementStart);
  let stmtContent = stmt;
  if (lastStatementStart === 0) {
    stmtContent = stmtContent.replace(/^\s*\d+\s*/, '');
    if (isJBas) {
      stmtContent = stmtContent.replace(/^\s*@[a-zA-Z0-9_]+:\s*/, '');
    }
  }

  stmtContent = stmtContent.trimStart();
  return stmtContent.length === 0 ? 'K' : 'L';
}

const BASIC_STATEMENTS = new Set([
  'PRINT', 'LET', 'IF', 'FOR', 'NEXT', 'GO TO', 'GOTO', 'GO SUB', 'GOSUB',
  'RETURN', 'PAUSE', 'BORDER', 'PAPER', 'INK', 'FLASH', 'BRIGHT', 'INVERSE',
  'OVER', 'CLS', 'PLOT', 'DRAW', 'CIRCLE', 'BEEP', 'READ', 'DATA', 'RESTORE',
  'DIM', 'REM', 'RANDOMIZE', 'CLEAR', 'CONTINUE', 'STOP', 'NEW', 'LOAD',
  'SAVE', 'VERIFY', 'MERGE', 'INPUT', 'POKE', 'OUT', 'OPEN #', 'CLOSE #',
  'CAT', 'FORMAT', 'MOVE', 'ERASE', 'LLIST', 'LPRINT', 'COPY', 'DEF FN',
  'RUN', 'LINE'
]);

/**
 * Validates a single Sinclair BASIC (.bas) or JBAS (.jbas) line.
 * Emulates the syntax validation of the ZX Spectrum +3 / 128K full-screen editor.
 * 
 * @param {string} lineText
 * @param {boolean} [isJBas=false]
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateBasicLine(lineText, isJBas = false) {
  if (!lineText || lineText.trim().length === 0) {
    return { valid: true };
  }

  const trimmed = lineText.trim();
  let content = trimmed;

  // 1. Line numbers for standard .bas
  if (!isJBas) {
    const lineNumMatch = content.match(/^(\d+)\s*(.*)$/);
    if (!lineNumMatch) {
      return { valid: false, reason: 'Missing line number' };
    }
    const lineNum = parseInt(lineNumMatch[1], 10);
    if (lineNum < 1 || lineNum > 9999) {
      return { valid: false, reason: 'Line number out of range (1-9999)' };
    }
    content = lineNumMatch[2].trim();
    if (content.length === 0) {
      return { valid: true }; // Standalone line number
    }
  } else {
    const labelMatch = content.match(/^@([a-zA-Z0-9_]+):\s*(.*)$/);
    if (labelMatch) {
      content = labelMatch[2].trim();
      if (content.length === 0) {
        return { valid: true }; // Standalone label
      }
    }
  }

  // 2. Full-line comment check
  const upperTrimmed = content.toUpperCase();
  if (upperTrimmed.startsWith('REM') || (isJBas && content.startsWith("'"))) {
    return { valid: true };
  }

  // 3. Scan quotes, parentheses and separate statements
  let insideString = false;
  let parenDepth = 0;
  const statements = [];
  let currentStmt = '';

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === '"') {
      insideString = !insideString;
      currentStmt += ch;
      continue;
    }

    if (insideString) {
      currentStmt += ch;
      continue;
    }

    // Comment starts
    if (isJBas && ch === "'") {
      break;
    }

    const remaining = content.slice(i);
    if (/^REM(\s|$)/i.test(remaining)) {
      currentStmt += remaining;
      break;
    }

    if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      parenDepth--;
      if (parenDepth < 0) {
        return { valid: false, reason: 'Unmatched closing parenthesis' };
      }
    }

    if (ch === ':') {
      statements.push(currentStmt);
      currentStmt = '';
    } else {
      currentStmt += ch;
    }
  }

  if (insideString) {
    return { valid: false, reason: 'Unclosed string literal' };
  }

  if (parenDepth !== 0) {
    return { valid: false, reason: 'Unbalanced parentheses' };
  }

  statements.push(currentStmt);

  // 4. Validate individual statements
  for (let s = 0; s < statements.length; s++) {
    const stmt = statements[s].trim();
    if (stmt.length === 0) {
      return { valid: false, reason: 'Empty statement' };
    }

    const stmtUpper = stmt.toUpperCase();
    if (stmtUpper.startsWith('REM') || (isJBas && stmt.startsWith("'"))) {
      break;
    }

    let sContent = stmt;
    if (isJBas) {
      sContent = sContent.replace(/^@[a-zA-Z0-9_]+:\s*/, '').trim();
      if (sContent.length === 0) continue;
    }

    const sUpper = sContent.toUpperCase();

    // Structural checks
    if (/^FOR\b/i.test(sUpper) && !/\bTO\b/i.test(sUpper)) {
      return { valid: false, reason: 'FOR statement missing TO' };
    }

    if (/^IF\b/i.test(sUpper) && !/\bTHEN\b/i.test(sUpper)) {
      return { valid: false, reason: 'IF statement missing THEN' };
    }

    if (/^(GO\s*TO|GO\s*SUB|RESTORE|RUN|LINE)\s*$/i.test(sUpper)) {
      return { valid: false, reason: 'Missing jump target' };
    }

    // Keyword or assignment check
    const firstWordMatch = sUpper.match(/^([A-Z$#]+(?:\s+[A-Z$#]+)?)/);
    if (!firstWordMatch) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_$]*\s*=/i.test(sContent)) {
        return { valid: false, reason: 'Invalid statement syntax' };
      }
    } else {
      const w1 = firstWordMatch[1];
      const singleWord = w1.split(/\s+/)[0];
      const isKnown = BASIC_STATEMENTS.has(w1) ||
                      BASIC_STATEMENTS.has(singleWord) ||
                      /^[a-zA-Z_][a-zA-Z0-9_$]*\s*=/i.test(sContent);
      if (!isKnown) {
        return { valid: false, reason: `Unrecognized keyword: ${singleWord}` };
      }
    }
  }

  return { valid: true };
}

/**
 * Spectrum Beeper: Emits authentic ZX Spectrum sound effects matching the +3 BASIC editor:
 * 1. Valid Enter confirmation keyclick (zx_click.wav).
 * 2. Syntax error RASP buzz (~64 Hz, zx_error.wav).
 * 3. Cursor movement tick (zx_cursor.wav).
 * Uses a persistent lightweight process on Windows (PowerShell SoundPlayer) for 0ms latency.
 */
class SpectrumBeeper {
  constructor(soundDir = null) {
    if (!soundDir) {
      try {
        const candidate = path.join(__dirname, '..', '..', 'media', 'sound');
        if (fs.existsSync(candidate)) {
          soundDir = candidate;
        }
      } catch {}
    }
    this.soundDir = soundDir;
    this.clickSound = soundDir ? path.join(soundDir, 'zx_click.wav') : null;
    this.errorSound = soundDir ? path.join(soundDir, 'zx_error.wav') : null;
    this.cursorSound = soundDir ? path.join(soundDir, 'zx_cursor.wav') : null;

    this.process = null;
    this.platform = process.platform;
    this.isDisposed = false;
    this.isSpawning = false;
  }

  _initProcess() {
    if (this.isDisposed || this.process || this.isSpawning || !spawn) return;

    try {
      if (this.platform === 'win32') {
        this.isSpawning = true;
        this.process = spawn('powershell', ['-NoProfile', '-Command', '-'], {
          stdio: ['pipe', 'ignore', 'ignore'],
          windowsHide: true
        });

        this.process.on('error', () => {
          this.process = null;
          this.isSpawning = false;
        });

        this.process.on('exit', () => {
          this.process = null;
          this.isSpawning = false;
        });

        if (this.process.stdin) {
          this.process.stdin.on('error', () => {});
        }

        // Preload all 3 SoundPlayers in memory for instantaneous zero-latency playback
        if (this.clickSound && fs.existsSync(this.clickSound)) {
          const esc = this.clickSound.replace(/'/g, "''");
          this._write(`$click = New-Object System.Media.SoundPlayer('${esc}'); $click.Load()\n`);
        }
        if (this.errorSound && fs.existsSync(this.errorSound)) {
          const esc = this.errorSound.replace(/'/g, "''");
          this._write(`$err = New-Object System.Media.SoundPlayer('${esc}'); $err.Load()\n`);
        }
        if (this.cursorSound && fs.existsSync(this.cursorSound)) {
          const esc = this.cursorSound.replace(/'/g, "''");
          this._write(`$cursor = New-Object System.Media.SoundPlayer('${esc}'); $cursor.Load()\n`);
        }

        this.isSpawning = false;
      }
    } catch {
      this.process = null;
      this.isSpawning = false;
    }
  }

  _write(cmd) {
    if (this.isDisposed || !this.process) return;
    try {
      if (this.process.stdin && this.process.stdin.writable) {
        this.process.stdin.write(cmd);
      }
    } catch {}
  }

  click() {
    if (this.isDisposed) return;
    try {
      if (this.platform === 'win32') {
        if (!this.process) this._initProcess();
        if (this.clickSound && fs.existsSync(this.clickSound)) {
          this._write('$click.Play()\n');
        } else {
          this._write('[console]::beep(987, 25)\n');
        }
      } else if (this.platform === 'darwin') {
        if (this.clickSound && fs.existsSync(this.clickSound)) {
          if (spawn) spawn('afplay', [this.clickSound], { stdio: 'ignore' });
        } else if (spawn) {
          spawn('osascript', ['-e', 'beep 1'], { stdio: 'ignore' });
        }
      } else {
        if (this.clickSound && fs.existsSync(this.clickSound)) {
          if (spawn) spawn('paplay', [this.clickSound], { stdio: 'ignore' });
        } else if (process.stdout && process.stdout.isTTY) {
          process.stdout.write('\x07');
        }
      }
    } catch {}
  }

  // Alias for backward compatibility
  beep() {
    this.click();
  }

  error() {
    if (this.isDisposed) return;
    try {
      if (this.platform === 'win32') {
        if (!this.process) this._initProcess();
        if (this.errorSound && fs.existsSync(this.errorSound)) {
          this._write('$err.Play()\n');
        } else {
          this._write('[console]::beep(64, 160)\n');
        }
      } else if (this.platform === 'darwin') {
        if (this.errorSound && fs.existsSync(this.errorSound)) {
          if (spawn) spawn('afplay', [this.errorSound], { stdio: 'ignore' });
        } else if (spawn) {
          spawn('osascript', ['-e', 'beep 1'], { stdio: 'ignore' });
        }
      } else {
        if (this.errorSound && fs.existsSync(this.errorSound)) {
          if (spawn) spawn('paplay', [this.errorSound], { stdio: 'ignore' });
        } else if (process.stdout && process.stdout.isTTY) {
          process.stdout.write('\x07');
        }
      }
    } catch {}
  }

  cursor() {
    if (this.isDisposed) return;
    try {
      if (this.platform === 'win32') {
        if (!this.process) this._initProcess();
        if (this.cursorSound && fs.existsSync(this.cursorSound)) {
          this._write('$cursor.Play()\n');
        } else {
          this._write('[console]::beep(1200, 10)\n');
        }
      } else if (this.platform === 'darwin') {
        if (this.cursorSound && fs.existsSync(this.cursorSound)) {
          if (spawn) spawn('afplay', [this.cursorSound], { stdio: 'ignore' });
        }
      } else {
        if (this.cursorSound && fs.existsSync(this.cursorSound)) {
          if (spawn) spawn('paplay', [this.cursorSound], { stdio: 'ignore' });
        }
      }
    } catch {}
  }

  dispose() {
    this.isDisposed = true;
    if (this.process) {
      try {
        if (this.process.stdin) {
          this.process.stdin.removeAllListeners('error');
          this.process.stdin.on('error', () => {});
          this.process.stdin.end();
        }
        this.process.kill();
      } catch {}
      this.process = null;
    }
  }
}

const RETRO_COLOR_KEYS = [
  'editor.background',
  'editor.foreground',
  'editorLineNumber.foreground',
  'editorLineNumber.activeForeground',
  'editorCursor.foreground',
  'editor.selectionBackground',
  'editor.selectionHighlightBackground',
  'editor.selectionHighlightBorder',
  'editor.wordHighlightBackground',
  'editor.wordHighlightStrongBackground',
  'editor.findMatchHighlightBackground',
  'editor.findMatchBackground',
  'editor.lineHighlightBackground'
];

const RETRO_COLORS = {
  'editor.background': '#FFFFFF',
  'editor.foreground': '#000000',
  'editorLineNumber.foreground': '#888888',
  'editorLineNumber.activeForeground': '#000000',
  'editorCursor.foreground': '#000000',
  // Soft, clear Sinclair cyan selection - 100% readable text without dark grey wash
  'editor.selectionBackground': '#00D7D744',
  'editor.selectionHighlightBackground': '#00D7D718',
  'editor.selectionHighlightBorder': '#00D7D766',
  'editor.wordHighlightBackground': '#00D7D718',
  'editor.wordHighlightStrongBackground': '#00D7D730',
  'editor.findMatchHighlightBackground': '#FFE06688',
  'editor.findMatchBackground': '#FFCC00AA',
  'editor.lineHighlightBackground': '#F8F8F8'
};

const RETRO_FONT_FAMILY = "'ZX Spectrum Unicode', 'ZXSpectrum', 'Courier New', monospace";

/**
 * Controller for Sinclair BASIC Retro Mode in VS Code.
 */
class RetroModeController {
  constructor(vscode, context = null) {
    this.vscode = vscode;
    this.context = context;
    const soundDir = context && context.extensionPath
      ? path.join(context.extensionPath, 'media', 'sound')
      : null;
    this.beeper = new SpectrumBeeper(soundDir);
    this.statusBarItem = null;
    this.isAutoFormatting = false;
    this.isTyping = false;
    this.typingTimeout = null;
    this.lastCursorLine = -1;
    this.lastCursorCol = -1;
    this.lastSelectionChangeTime = 0;
    this.disposables = [];
  }

  async init() {
    // 0. Automatically clean up any leftover theme from previous versions
    try {
      const workbenchConfig = this.vscode.workspace.getConfiguration('workbench');
      const currentTheme = workbenchConfig.get('colorTheme');
      if (currentTheme && currentTheme.includes('Sinclair ZX Spectrum')) {
        await workbenchConfig.update('colorTheme', undefined, this.vscode.ConfigurationTarget.Global);
      }
    } catch {}

    // 0b. Register font if on Windows
    if (this.context && this.context.extensionPath) {
      ensureFontInstalled(this.context.extensionPath);
    }

    // 1. Status Bar Item
    this.statusBarItem = this.vscode.window.createStatusBarItem(this.vscode.StatusBarAlignment.Right, 95);
    this.statusBarItem.command = 'sinclairBasic.toggleRetroMode';
    this.disposables.push(this.statusBarItem);

    // 2. Register command
    this.disposables.push(
      this.vscode.commands.registerCommand('sinclairBasic.toggleRetroMode', () => this.toggleRetroMode())
    );

    // 3. Document change listener (for Enter key beep, error buzz & auto-formatting)
    this.disposables.push(
      this.vscode.workspace.onDidChangeTextDocument(e => this.handleTextDocumentChange(e))
    );

    // 3b. Selection change listener (for Cursor movement tick)
    this.disposables.push(
      this.vscode.window.onDidChangeTextEditorSelection(e => this.handleSelectionChange(e))
    );

    // 4. Active editor change
    this.disposables.push(
      this.vscode.window.onDidChangeActiveTextEditor(() => this.updateUi())
    );

    // 5. Configuration change
    this.disposables.push(
      this.vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('sinclairBasic.retroMode')) {
          this.updateUi();
        }
      })
    );

    // Apply or clean up retro styles according to current setting
    const isEnabled = this.isRetroEnabled();
    await this.applyRetroStyles(isEnabled);

    this.updateUi();
  }

  isRetroEnabled() {
    return this.vscode.workspace.getConfiguration('sinclairBasic').get('retroMode.enabled', false);
  }

  isBasicEditor(editor) {
    if (!editor || !editor.document) return false;
    const lang = editor.document.languageId;
    return lang === 'sinclair-basic' || lang === 'jbas';
  }

  async toggleRetroMode() {
    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    const current = config.get('retroMode.enabled', false);
    const next = !current;

    await config.update('retroMode.enabled', next, this.vscode.ConfigurationTarget.Global);
    await this.applyRetroStyles(next);

    if (next) {
      this.beeper.beep();
      this.vscode.window.showInformationMessage('🕹️ Modo Retro Sinclair BASIC: ACTIVADO (Pantalla blanca y fuente 8x8)');
    } else {
      this.vscode.window.showInformationMessage('Modo Retro Sinclair BASIC: Desactivado (Editor normal)');
    }

    this.updateUi();
  }

  async applyRetroStyles(enabled) {
    try {
      const workbenchConfig = this.vscode.workspace.getConfiguration('workbench');
      const colors = { ...workbenchConfig.get('colorCustomizations', {}) };

      if (enabled) {
        // Apply white Paper 7 background ONLY to the editor canvas (rest of IDE stays dark/normal)
        Object.assign(colors, RETRO_COLORS);
        await workbenchConfig.update('colorCustomizations', colors, this.vscode.ConfigurationTarget.Global);

        // 1. Close all panels (left sidebar, right sidebar, bottom panel) so only the editor remains:
        try {
          await this.vscode.commands.executeCommand('workbench.action.closeSidebar');
        } catch {}
        try {
          await this.vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
        } catch {}
        try {
          await this.vscode.commands.executeCommand('workbench.action.closePanel');
        } catch {}

        // 2. Apply authentic enlarged Sinclair ZX Spectrum pixel font (BOLD), hide line numbers & minimap ONLY for Sinclair BASIC
        for (const langId of ['sinclair-basic', 'jbas']) {
          const langConfig = this.vscode.workspace.getConfiguration('', { languageId: langId });
          await langConfig.update('editor.fontFamily', RETRO_FONT_FAMILY, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.fontSize', 19, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.fontWeight', 'bold', this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.lineHeight', 24, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.lineNumbers', 'off', this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.minimap.enabled', false, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.glyphMargin', false, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.folding', false, this.vscode.ConfigurationTarget.Global, true);
        }
      } else {
        // Remove retro color customizations so the editor returns 100% to normal theme
        for (const k of RETRO_COLOR_KEYS) {
          delete colors[k];
        }
        const newColors = Object.keys(colors).length > 0 ? colors : undefined;
        await workbenchConfig.update('colorCustomizations', newColors, this.vscode.ConfigurationTarget.Global);

        // Remove font, size, minimap and line numbers overrides so the editor returns 100% to normal
        for (const langId of ['sinclair-basic', 'jbas']) {
          const langConfig = this.vscode.workspace.getConfiguration('', { languageId: langId });
          await langConfig.update('editor.fontFamily', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.fontSize', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.fontWeight', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.lineHeight', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.lineNumbers', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.minimap.enabled', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.glyphMargin', undefined, this.vscode.ConfigurationTarget.Global, true);
          await langConfig.update('editor.folding', undefined, this.vscode.ConfigurationTarget.Global, true);
        }

        // Restore normal workspace panels (re-open Explorer in sidebar)
        try {
          await this.vscode.commands.executeCommand('workbench.view.explorer');
        } catch {}

        // Clean up theme if it was previously set
        const currentTheme = workbenchConfig.get('colorTheme');
        if (currentTheme && currentTheme.includes('Sinclair ZX Spectrum')) {
          await workbenchConfig.update('colorTheme', undefined, this.vscode.ConfigurationTarget.Global);
        }
      }
    } catch (err) {
      console.error('Error applying retro styles:', err);
    }
  }

  updateUi() {
    const editor = this.vscode.window.activeTextEditor;
    if (this.isBasicEditor(editor)) {
      const enabled = this.isRetroEnabled();
      this.statusBarItem.text = enabled ? '$(sparkle) ZX Retro: ON' : '$(sparkle) ZX Retro: OFF';
      this.statusBarItem.tooltip = enabled
        ? 'Modo Retro ZX Spectrum activo. Clic para desactivar.'
        : 'Clic para activar el Modo Retro ZX Spectrum.';
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  handleSelectionChange(e) {
    if (this.isAutoFormatting || this.isTyping || !this.isRetroEnabled()) return;
    const editor = this.vscode.window.activeTextEditor;
    if (!this.isBasicEditor(editor) || e.textEditor !== editor) return;

    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    const beepOnCursor = config.get('retroMode.beepOnCursor', true);
    if (!beepOnCursor) return;

    if (!editor.selection) return;
    const pos = editor.selection.active;
    if (pos.line === this.lastCursorLine && pos.character === this.lastCursorCol) {
      return;
    }
    this.lastCursorLine = pos.line;
    this.lastCursorCol = pos.character;

    // Emulate +3 keyrepeat throttle (~55ms)
    const now = Date.now();
    if (now - this.lastSelectionChangeTime < 55) {
      return;
    }
    this.lastSelectionChangeTime = now;

    this.beeper.cursor();
  }

  async handleTextDocumentChange(e) {
    if (this.isAutoFormatting || !this.isRetroEnabled()) return;
    const lang = e.document.languageId;
    if (lang !== 'sinclair-basic' && lang !== 'jbas') return;

    if (!e.contentChanges || e.contentChanges.length === 0) return;
    const change = e.contentChanges[0];

    // Mark typing so cursor movement tick doesn't trigger when inserting text
    this.isTyping = true;
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
    }, 60);

    // Single Enter key detection
    const isEnter = (change.text === '\n' || change.text === '\r\n') && change.rangeLength === 0;
    if (!isEnter) return;

    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    const beepOnEnter = config.get('retroMode.beepOnEnter', true);
    const beepOnError = config.get('retroMode.beepOnError', true);
    const formatOnEnter = config.get('retroMode.formatOnEnter', true);

    const lineIndex = change.range.start.line;
    if (lineIndex >= 0 && lineIndex < e.document.lineCount) {
      const line = e.document.lineAt(lineIndex);
      const originalText = line.text;

      const validation = validateBasicLine(originalText, lang === 'jbas');

      if (!validation.valid) {
        // 1. Line has syntax error -> Emit authentic ZX Spectrum +3 / 128K RASP error buzz!
        if (beepOnError) {
          this.beeper.error();
        }
        return;
      }

      // 2. Line is valid -> Emit authentic ZX Spectrum confirmation keyclick!
      if (beepOnEnter) {
        this.beeper.click();
      }

      // 3. Format keywords to uppercase on the submitted valid line
      if (formatOnEnter) {
        const formattedText = formatLineKeywords(originalText, lang === 'jbas');
        if (formattedText !== originalText) {
          this.isAutoFormatting = true;
          try {
            const edit = new this.vscode.WorkspaceEdit();
            edit.replace(e.document.uri, line.range, formattedText);
            await this.vscode.workspace.applyEdit(edit);
          } finally {
            this.isAutoFormatting = false;
          }
        }
      }
    }
  }

  dispose() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    if (this.beeper) {
      this.beeper.dispose();
    }
    this.disposables.forEach(d => {
      try { d.dispose(); } catch {}
    });
    this.disposables = [];
  }
}

module.exports = {
  detectCursorMode,
  validateBasicLine,
  SpectrumBeeper,
  formatLineKeywords,
  RetroModeController,
  ensureFontInstalled
};

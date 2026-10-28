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
 * Extracts line number and statement commands from a Sinclair BASIC line.
 * Returns { lineNum: number, command: string } or null if unnumbered/out-of-range.
 */
function parseBasicLineNumber(text) {
  if (typeof text !== 'string') return null;
  const match = text.trimStart().match(/^(\d+)(?:\s+(.*)|\s*)$/);
  if (!match) return null;
  const lineNum = parseInt(match[1], 10);
  if (isNaN(lineNum) || lineNum < 1 || lineNum > 9999) return null;
  return {
    lineNum,
    command: (match[2] || '').trim()
  };
}

/**
 * Searches a document (or array of lines) for a line starting with lineNum,
 * excluding the line at excludeIndex.
 * Returns the line index if found, or -1 if not found.
 */
function findExistingLineIndex(documentOrLines, lineNum, excludeIndex = -1) {
  if (!documentOrLines) return -1;
  const count = typeof documentOrLines.lineCount === 'number'
    ? documentOrLines.lineCount
    : documentOrLines.length;

  for (let i = 0; i < count; i++) {
    if (i === excludeIndex) continue;
    let lineText = '';
    if (typeof documentOrLines.lineAt === 'function') {
      lineText = documentOrLines.lineAt(i).text;
    } else {
      const item = documentOrLines[i];
      lineText = typeof item === 'string' ? item : (item && item.text ? item.text : '');
    }
    const parsed = parseBasicLineNumber(lineText);
    if (parsed && parsed.lineNum === lineNum) {
      return i;
    }
  }
  return -1;
}

/**
 * Calculates +3 BASIC line replacement when a numbered line is entered.
 * If the line number already exists at another line in the document, returns:
 * {
 *   shouldReplace: true,
 *   existingLineIndex,
 *   submittedLineIndex,
 *   lineNum,
 *   isDeleteOnly, // true if user typed only line number without command (e.g. "10")
 *   formattedText
 * }
 */
function calculateLineReplacement(documentOrLines, submittedLineIndex, options = {}) {
  const { isJBas = false, formatKeywords = true } = options;
  if (!documentOrLines) return { shouldReplace: false };

  let submittedLine = '';
  if (typeof documentOrLines.lineAt === 'function') {
    if (submittedLineIndex < 0 || submittedLineIndex >= documentOrLines.lineCount) {
      return { shouldReplace: false };
    }
    submittedLine = documentOrLines.lineAt(submittedLineIndex).text;
  } else {
    if (submittedLineIndex < 0 || submittedLineIndex >= documentOrLines.length) {
      return { shouldReplace: false };
    }
    const item = documentOrLines[submittedLineIndex];
    submittedLine = typeof item === 'string' ? item : (item && item.text ? item.text : '');
  }

  const parsed = parseBasicLineNumber(submittedLine);
  if (!parsed) {
    return { shouldReplace: false };
  }

  const { lineNum, command } = parsed;
  const existingLineIndex = findExistingLineIndex(documentOrLines, lineNum, submittedLineIndex);
  if (existingLineIndex === -1) {
    return { shouldReplace: false, lineNum, isNew: true };
  }

  const isDeleteOnly = command.length === 0;
  const formattedText = formatKeywords
    ? formatLineKeywords(submittedLine, isJBas)
    : submittedLine;

  return {
    shouldReplace: true,
    existingLineIndex,
    submittedLineIndex,
    lineNum,
    isDeleteOnly,
    formattedText
  };
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

const RETRO_COLORS = {
  // Authentic ZX Spectrum +3 non-bright Paper 7 / Border 7 (#D9D9D9)
  'editor.background': '#D9D9D9',
  'editor.foreground': '#000000',
  'editorGutter.background': '#D9D9D9',
  'editorGroup.border': '#D9D9D9',
  'editorGroupHeader.noTabsBackground': '#D9D9D9',
  'editorGroupHeader.tabsBackground': '#D9D9D9',
  'sash.hoverBorder': '#D9D9D900',
  'editorLineNumber.foreground': '#888888',
  'editorLineNumber.activeForeground': '#000000',
  // Authentic ZX Spectrum Ink 1 blue block cursor (#2A2AF0)
  'editorCursor.foreground': '#2A2AF0',
  'editorCursor.background': '#D9D9D9',
  // Soft, clear Sinclair cyan selection - 100% readable text without dark grey wash
  'editor.selectionBackground': '#00D7D744',
  'editor.selectionHighlightBackground': '#00D7D718',
  'editor.selectionHighlightBorder': '#00D7D766',
  'editor.wordHighlightBackground': '#00D7D718',
  'editor.wordHighlightStrongBackground': '#00D7D730',
  'editor.findMatchHighlightBackground': '#FFE06688',
  'editor.findMatchBackground': '#FFCC00AA',
  'editor.lineHighlightBackground': '#D9D9D9',
  'editor.lineHighlightBorder': '#D9D9D900',
  'editorOverviewRuler.border': '#D9D9D900',
  'scrollbar.shadow': '#D9D9D900',
  'scrollbarSlider.background': '#D9D9D900',
  'scrollbarSlider.hoverBackground': '#00000022',
  'scrollbarSlider.activeBackground': '#00000044',
  // Suggest / IntelliSense Widget (Crisp Sinclair Paper 7 background, high-contrast readable text)
  'editorSuggestWidget.background': '#FFFFFF',
  'editorSuggestWidget.foreground': '#000000',
  'editorSuggestWidget.border': '#00A3A6',
  'editorSuggestWidget.selectedBackground': '#0078D4',
  'editorSuggestWidget.selectedForeground': '#FFFFFF',
  'editorSuggestWidget.selectedIconForeground': '#FFFFFF',
  'editorSuggestWidget.highlightForeground': '#0066CC',
  'editorSuggestWidget.focusHighlightForeground': '#FFE066',
  'editorSuggestWidgetStatus.foreground': '#666666',
  // Hover & Tooltip Widgets (Function docs, previews)
  'editorHoverWidget.background': '#FFFFFF',
  'editorHoverWidget.foreground': '#000000',
  'editorHoverWidget.border': '#00A3A6',
  'editorHoverWidget.statusBarBackground': '#F5F5F5',
  // General Editor Widgets (Find & Replace, Parameter hints)
  'editorWidget.background': '#FFFFFF',
  'editorWidget.foreground': '#000000',
  'editorWidget.border': '#00A3A6'
};

/**
 * HTML for the +3 BASIC bottom banner (black bar, "+3 BASIC" label and the four diagonal
 * Spectrum stripes: red, yellow, green, cyan, framed inside the #D9D9D9 Spectrum border).
 * Pure function so it can be unit tested.
 */
function buildBannerHtml(fontUri = '', cspSource = '') {
  const fontFace = fontUri
    ? `@font-face { font-family: 'ZXBanner'; src: url('${fontUri}') format('truetype'); }`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource};">
<style>
${fontFace}
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: #D9D9D9;
  overflow: hidden;
  user-select: none;
}
.screen-bottom {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 18px 0 18px;
  background: #D9D9D9;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 20px;
  background: #000000;
  overflow: hidden;
}
.label {
  color: #D9D9D9;
  font-family: 'ZXBanner', 'ZX Spectrum Unicode', 'Courier New', monospace;
  font-size: 16px;
  font-weight: bold;
  letter-spacing: 1px;
  padding-left: 6px;
  line-height: 20px;
  text-transform: uppercase;
}
.stripes {
  display: flex;
  height: 100%;
  padding-left: 14px;
  padding-right: 18px;
}
.stripe {
  width: 16px;
  height: 100%;
  transform: skewX(-42deg);
  margin-right: -1px;
}
.red { background: #FF0000; }
.yellow { background: #FFFF00; }
.green { background: #00FF00; }
.cyan { background: #00FFFF; }
</style>
</head>
<body>
<div class="screen-bottom"><div class="bar"><span class="label">+3 BASIC</span><div class="stripes"><i class="stripe red"></i><i class="stripe yellow"></i><i class="stripe green"></i><i class="stripe cyan"></i></div></div></div>
</body>
</html>`;
}

// Derived automatically from RETRO_COLORS to guarantee 100% cleanup without leaving any leftover keys
const RETRO_COLOR_KEYS = Object.keys(RETRO_COLORS);

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
    this.bannerPanel = null;
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

    // 0c. Dispose any leftover deserialized +3 BASIC banner webview from a previous VS Code session
    //     so reopening VS Code with Retro Mode enabled never leaves a dead blank white webview tab!
    if (typeof this.vscode.window.registerWebviewPanelSerializer === 'function') {
      try {
        this.disposables.push(
          this.vscode.window.registerWebviewPanelSerializer('sinclairBasicBanner', {
            async deserializeWebviewPanel(webviewPanel) {
              try {
                webviewPanel.dispose();
              } catch {}
            }
          })
        );
      } catch {}
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
      this.vscode.window.onDidChangeActiveTextEditor(editor => {
        this.updateUi();
        if (this.isRetroEnabled() && this.isBasicEditor(editor) && !this.bannerPanel) {
          this.openBanner();
        }
      })
    );

    // 5. Configuration change
    this.disposables.push(
      this.vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('sinclairBasic.retroMode')) {
          this.updateUi();
        }
      })
    );

    // Apply retro styles if enabled, or clean up ONLY if leftover retro styles exist from a previous session
    const isEnabled = this.isRetroEnabled();
    if (isEnabled || this.hasLeftoverRetroStyles()) {
      await this.applyRetroStyles(isEnabled);
    }

    this.updateUi();
  }

  hasLeftoverRetroStyles() {
    try {
      if (this.context && this.context.globalState) {
        if (this.context.globalState.get('retroMode.savedTheme') !== undefined ||
            this.context.globalState.get('retroMode.savedShowTabs') !== undefined) {
          return true;
        }
      }
      const workbenchConfig = this.vscode.workspace.getConfiguration('workbench');
      const colors = workbenchConfig.get('colorCustomizations', {});
      if (colors && (colors['editor.background'] === '#D9D9D9' || colors['editorCursor.foreground'] === '#2A2AF0')) {
        return true;
      }
    } catch {}
    return false;
  }

  isRetroEnabled() {
    if (typeof this.retroEnabledOverride === 'boolean') {
      return this.retroEnabledOverride;
    }
    if (this.context && this.context.globalState) {
      const stateVal = this.context.globalState.get('retroMode.enabled');
      if (typeof stateVal === 'boolean') {
        return stateVal;
      }
    }
    return this.vscode.workspace.getConfiguration('sinclairBasic').get('retroMode.enabled', false);
  }

  isBasicEditor(editor) {
    if (!editor || !editor.document) return false;
    const lang = editor.document.languageId;
    return lang === 'sinclair-basic' || lang === 'jbas';
  }

  hasVisibleBasicEditor() {
    if (this.isBasicEditor(this.vscode.window.activeTextEditor)) return true;
    if (Array.isArray(this.vscode.window.visibleTextEditors)) {
      return this.vscode.window.visibleTextEditors.some(ed => this.isBasicEditor(ed));
    }
    return false;
  }

  async toggleRetroMode() {
    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    const current = this.isRetroEnabled();
    const next = !current;

    this.retroEnabledOverride = next;
    if (this.context && this.context.globalState) {
      try {
        await this.context.globalState.update('retroMode.enabled', next);
      } catch {}
    }
    await this.safeUpdate(config, 'retroMode.enabled', next, this.vscode.ConfigurationTarget.Global);
    await this.applyRetroStyles(next);

    if (next) {
      this.beeper.beep();
      this.vscode.window.showInformationMessage('🕹️ Modo Retro Sinclair BASIC: ACTIVADO (Pantalla blanca y fuente 8x8)');
    } else {
      this.vscode.window.showInformationMessage('Modo Retro Sinclair BASIC: Desactivado (Editor normal)');
    }

    this.updateUi();
  }

  async safeUpdate(config, key, value, target, overrideInLanguage = false) {
    try {
      await config.update(key, value, target, overrideInLanguage);
    } catch {}
  }

  getInspectedGlobalValue(config, key) {
    try {
      if (typeof config.inspect === 'function') {
        const info = config.inspect(key);
        if (info && Object.prototype.hasOwnProperty.call(info, 'globalValue')) {
          return info.globalValue;
        }
      }
    } catch {}
    return config.get(key);
  }

  async applyRetroStyles(enabled) {
    try {
      const workbenchConfig = this.vscode.workspace.getConfiguration('workbench');
      const breadcrumbsConfig = this.vscode.workspace.getConfiguration('breadcrumbs');
      const colors = { ...workbenchConfig.get('colorCustomizations', {}) };

      if (enabled) {
        // 0. Save user's original theme (only if not already on Default Light Modern) and switch to light mode
        const currentTheme = workbenchConfig.get('colorTheme');
        const isRetroLightTheme = currentTheme === 'Default Light Modern' || (currentTheme && currentTheme.includes('Sinclair ZX Spectrum'));
        if (!isRetroLightTheme) {
          if (this.context && this.context.globalState) {
            const rawTheme = this.getInspectedGlobalValue(workbenchConfig, 'colorTheme');
            const toSave = (rawTheme && rawTheme !== 'Default Light Modern' && !rawTheme.includes('Sinclair ZX Spectrum'))
              ? rawTheme
              : '__DEFAULT__';
            await this.context.globalState.update('retroMode.savedTheme', toSave);
          }
          await this.safeUpdate(workbenchConfig, 'colorTheme', 'Default Light Modern', this.vscode.ConfigurationTarget.Global);
        }

        // 0b. Save user's original showTabs & breadcrumbs (only if not already in retro state)
        const currentShowTabs = workbenchConfig.get('editor.showTabs');
        if (currentShowTabs !== 'none') {
          if (this.context && this.context.globalState) {
            const rawShowTabs = this.getInspectedGlobalValue(workbenchConfig, 'editor.showTabs');
            const toSave = (rawShowTabs && rawShowTabs !== 'none') ? rawShowTabs : '__DEFAULT__';
            await this.context.globalState.update('retroMode.savedShowTabs', toSave);
          }
          await this.safeUpdate(workbenchConfig, 'editor.showTabs', 'none', this.vscode.ConfigurationTarget.Global);
        }
        const currentBreadcrumbs = breadcrumbsConfig.get('enabled');
        if (currentBreadcrumbs !== false) {
          if (this.context && this.context.globalState) {
            const rawBreadcrumbs = this.getInspectedGlobalValue(breadcrumbsConfig, 'enabled');
            const toSave = (rawBreadcrumbs !== undefined && rawBreadcrumbs !== false) ? rawBreadcrumbs : '__DEFAULT__';
            await this.context.globalState.update('retroMode.savedBreadcrumbs', toSave);
          }
          await this.safeUpdate(breadcrumbsConfig, 'enabled', false, this.vscode.ConfigurationTarget.Global);
        }

        // Apply authentic Paper 7 (#D9D9D9) background ONLY to the editor canvas
        Object.assign(colors, RETRO_COLORS);
        await this.safeUpdate(workbenchConfig, 'colorCustomizations', colors, this.vscode.ConfigurationTarget.Global);

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

        // 2. Apply authentic enlarged Sinclair ZX Spectrum pixel font (BOLD), blue block cursor, border margins, hide line numbers & minimap ONLY for Sinclair BASIC
        const gTarget = this.vscode.ConfigurationTarget.Global;
        for (const langId of ['sinclair-basic', 'jbas']) {
          const langConfig = this.vscode.workspace.getConfiguration('', { languageId: langId });
          await this.safeUpdate(langConfig, 'editor.fontFamily', RETRO_FONT_FAMILY, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.fontSize', 19, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.fontWeight', 'bold', gTarget, true);
          await this.safeUpdate(langConfig, 'editor.lineHeight', 24, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.lineNumbers', 'off', gTarget, true);
          await this.safeUpdate(langConfig, 'editor.minimap.enabled', false, gTarget, true);
          // Leave glyphMargin & folding true (with invisible icons) so the editor has a clean ~36px left Spectrum BORDER 7 margin!
          await this.safeUpdate(langConfig, 'editor.glyphMargin', true, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.folding', false, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.cursorStyle', 'block', gTarget, true);
          await this.safeUpdate(langConfig, 'editor.cursorBlinking', 'blink', gTarget, true);
          await this.safeUpdate(langConfig, 'editor.padding', { top: 28, bottom: 0 }, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.renderLineHighlight', 'none', gTarget, true);
          await this.safeUpdate(langConfig, 'editor.overviewRulerBorder', false, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.hideCursorInOverviewRuler', true, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.scrollbar.vertical', 'hidden', gTarget, true);
          await this.safeUpdate(langConfig, 'editor.scrollbar.horizontal', 'hidden', gTarget, true);
        }

        // Apply lineNumbers: Off (0) and cursorStyle: Block (2) immediately to open BASIC editors
        if (Array.isArray(this.vscode.window.visibleTextEditors)) {
          for (const ed of this.vscode.window.visibleTextEditors) {
            if (this.isBasicEditor(ed) && ed.options) {
              try {
                ed.options = { ...ed.options, lineNumbers: 0, cursorStyle: 2 };
              } catch {}
            }
          }
        }

        // 3. +3 BASIC banner: slim black strip with the four Spectrum colours below the editor
        if (this.hasVisibleBasicEditor()) {
          await this.openBanner();
        }
      } else {
        // 0. Always remove the +3 BASIC banner, unlock any locked group and restore single editor layout
        await this.closeBanner();

        // 1. Remove retro color customizations so the editor returns 100% to normal theme
        for (const k of RETRO_COLOR_KEYS) {
          delete colors[k];
        }
        const newColors = Object.keys(colors).length > 0 ? colors : undefined;
        await this.safeUpdate(workbenchConfig, 'colorCustomizations', newColors, this.vscode.ConfigurationTarget.Global);

        // 2. Restore user's original color theme (dark or custom), tabs & breadcrumbs with 100% safe fallback
        let savedTheme = undefined;
        let savedShowTabs = undefined;
        let savedBreadcrumbs = undefined;
        if (this.context && this.context.globalState) {
          savedTheme = this.context.globalState.get('retroMode.savedTheme');
          savedShowTabs = this.context.globalState.get('retroMode.savedShowTabs');
          savedBreadcrumbs = this.context.globalState.get('retroMode.savedBreadcrumbs');
          await this.context.globalState.update('retroMode.savedTheme', undefined);
          await this.context.globalState.update('retroMode.savedShowTabs', undefined);
          await this.context.globalState.update('retroMode.savedBreadcrumbs', undefined);
        }

        const currentTheme = workbenchConfig.get('colorTheme');
        if (currentTheme === 'Default Light Modern' || (currentTheme && currentTheme.includes('Sinclair ZX Spectrum'))) {
          const themeToRestore = (!savedTheme || savedTheme === '__DEFAULT__' || savedTheme === 'Default Light Modern' || savedTheme.includes('Sinclair ZX Spectrum'))
            ? undefined
            : savedTheme;
          await this.safeUpdate(workbenchConfig, 'colorTheme', themeToRestore, this.vscode.ConfigurationTarget.Global);
        }

        if (workbenchConfig.get('editor.showTabs') === 'none') {
          const tabsToRestore = (!savedShowTabs || savedShowTabs === '__DEFAULT__' || savedShowTabs === 'none')
            ? undefined
            : savedShowTabs;
          await this.safeUpdate(workbenchConfig, 'editor.showTabs', tabsToRestore, this.vscode.ConfigurationTarget.Global);
        }

        if (breadcrumbsConfig.get('enabled') === false) {
          const breadcrumbsToRestore = (savedBreadcrumbs === undefined || savedBreadcrumbs === '__DEFAULT__' || savedBreadcrumbs === false)
            ? undefined
            : savedBreadcrumbs;
          await this.safeUpdate(breadcrumbsConfig, 'enabled', breadcrumbsToRestore, this.vscode.ConfigurationTarget.Global);
        }

        // 3. Remove font, size, cursor, padding, minimap and line numbers overrides so the editor returns 100% to normal
        const gTarget = this.vscode.ConfigurationTarget.Global;
        for (const langId of ['sinclair-basic', 'jbas']) {
          const langConfig = this.vscode.workspace.getConfiguration('', { languageId: langId });
          await this.safeUpdate(langConfig, 'editor.fontFamily', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.fontSize', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.fontWeight', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.lineHeight', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.cursorStyle', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.cursorBlinking', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.padding', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.lineDecorationsWidth', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.renderLineHighlight', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.overviewRulerBorder', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.hideCursorInOverviewRuler', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.scrollbar.vertical', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.scrollbar.horizontal', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.lineNumbers', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.minimap.enabled', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.glyphMargin', undefined, gTarget, true);
          await this.safeUpdate(langConfig, 'editor.folding', undefined, gTarget, true);
        }

        if (Array.isArray(this.vscode.window.visibleTextEditors)) {
          for (const ed of this.vscode.window.visibleTextEditors) {
            if (this.isBasicEditor(ed) && ed.options) {
              try {
                ed.options = { ...ed.options, lineNumbers: 1, cursorStyle: 1 };
              } catch {}
            }
          }
        }

        // Restore normal workspace panels (re-open Explorer in sidebar)
        try {
          await this.vscode.commands.executeCommand('workbench.view.explorer');
        } catch {}
      }
    } catch (err) {
      console.error('Error applying retro styles:', err);
    }
  }

  async openBanner() {
    if (this.bannerPanel || !this.vscode.window.createWebviewPanel) return;
    try {
      // 0. Ensure any leftover split/locked groups from a previous session are collapsed first
      try {
        await this.vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
      } catch {}
      try {
        await this.vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
      } catch {}

      // 1. Pre-create vertical split layout (85% top code editor / 15% bottom +3 BASIC strip)
      //    BEFORE opening the webview in ViewColumn.Two so VS Code doesn't split horizontally first.
      await this.vscode.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 1,
        groups: [{ size: 0.85 }, { size: 0.15 }]
      });

      const mediaFonts = this.context && this.context.extensionUri
        ? this.vscode.Uri.joinPath(this.context.extensionUri, 'media', 'fonts')
        : null;
      const panel = this.vscode.window.createWebviewPanel(
        'sinclairBasicBanner',
        '+3 BASIC',
        { viewColumn: this.vscode.ViewColumn.Two, preserveFocus: false },
        {
          enableScripts: false,
          localResourceRoots: mediaFonts ? [mediaFonts] : []
        }
      );
      const fontUri = mediaFonts
        ? panel.webview.asWebviewUri(this.vscode.Uri.joinPath(mediaFonts, 'ZXSpectrum.ttf')).toString()
        : '';
      panel.webview.html = buildBannerHtml(fontUri, panel.webview.cspSource);
      this.bannerPanel = panel;
      panel.onDidDispose(() => {
        this.bannerPanel = null;
      });

      // 2. Return focus to the BASIC editor in Group 1, then shrink the bottom strip to 8% height
      //    (Do NOT lock Group 2 so VS Code never persists an uncloseable empty white group on restart!)
      await this.vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
      await this.vscode.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 1,
        groups: [{ size: 0.92 }, { size: 0.08 }]
      });
      await this.vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');

      // 3. If the user ever clicks the bottom banner, immediately return focus to the BASIC editor
      if (typeof panel.onDidChangeViewState === 'function') {
        panel.onDidChangeViewState(e => {
          if (e.webviewPanel && e.webviewPanel.active) {
            this.vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
          }
        });
      }
    } catch (err) {
      console.error('Error opening +3 BASIC banner:', err);
    }
  }

  async closeBanner() {
    try {
      if (this.bannerPanel) {
        const panel = this.bannerPanel;
        this.bannerPanel = null;
        try {
          panel.dispose();
        } catch {}
      }
      // Always unlock any locked editor group and collapse back to a single editor layout,
      // even if bannerPanel was null (e.g. when rolling back after restarting VS Code).
      try {
        await this.vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
        await this.vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
      } catch {}
      try {
        await this.vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        await this.vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
      } catch {}
      try {
        await this.vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
      } catch {}
    } catch (err) {
      console.error('Error closing +3 BASIC banner:', err);
    }
  }

  updateUi() {
    const editor = this.vscode.window.activeTextEditor;
    const enabled = this.isRetroEnabled();
    // Always show the status bar toggle when Retro Mode is ON (even if no .bas file is focused)
    // so the user can ALWAYS click it to deactivate and roll back!
    if (enabled || this.isBasicEditor(editor)) {
      this.statusBarItem.text = enabled ? '$(sparkle) ZX Retro: ON' : '$(sparkle) ZX Retro: OFF';
      this.statusBarItem.tooltip = enabled
        ? 'Modo Retro ZX Spectrum activo. Clic para desactivar y restaurar VS Code.'
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

  getLineDeletionRange(document, lineIndex) {
    const line = document.lineAt(lineIndex);
    if (lineIndex < document.lineCount - 1) {
      return line.rangeIncludingLineBreak;
    }
    if (lineIndex > 0) {
      const prevLine = document.lineAt(lineIndex - 1);
      return new this.vscode.Range(prevLine.range.end, line.range.end);
    }
    return line.range;
  }

  async handleTextDocumentChange(e) {
    const retroEnabled = this.isRetroEnabled();
    const config = this.vscode.workspace.getConfiguration('sinclairBasic');
    const replaceOutsideRetro = config.get('replaceExistingLineNumber', false);

    if (this.isAutoFormatting || (!retroEnabled && !replaceOutsideRetro)) return;
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

    const beepOnEnter = config.get('retroMode.beepOnEnter', true);
    const beepOnError = config.get('retroMode.beepOnError', true);
    const formatOnEnter = config.get('retroMode.formatOnEnter', true);
    const replaceExisting = config.get('retroMode.replaceExistingLine', true) || replaceOutsideRetro;

    const lineIndex = change.range.start.line;
    if (lineIndex >= 0 && lineIndex < e.document.lineCount) {
      const line = e.document.lineAt(lineIndex);
      const originalText = line.text;

      const validation = validateBasicLine(originalText, lang === 'jbas');

      if (!validation.valid) {
        // 1. Line has syntax error -> Emit authentic ZX Spectrum +3 / 128K RASP error buzz!
        if (retroEnabled && beepOnError) {
          this.beeper.error();
        }
        return;
      }

      // 2. Line is valid -> Emit authentic ZX Spectrum confirmation keyclick!
      if (retroEnabled && beepOnEnter) {
        this.beeper.click();
      }

      // 3. +3 BASIC Line Replacement: If line number already exists elsewhere in document, replace it!
      if (replaceExisting) {
        const replacement = calculateLineReplacement(e.document, lineIndex, {
          isJBas: lang === 'jbas',
          formatKeywords: formatOnEnter
        });

        if (replacement.shouldReplace) {
          const edit = new this.vscode.WorkspaceEdit();
          const existingLine = e.document.lineAt(replacement.existingLineIndex);

          if (replacement.isDeleteOnly) {
            edit.delete(e.document.uri, this.getLineDeletionRange(e.document, replacement.existingLineIndex));
          } else {
            edit.replace(e.document.uri, existingLine.range, replacement.formattedText);
          }

          // Delete the duplicate line where the user typed the command
          edit.delete(e.document.uri, this.getLineDeletionRange(e.document, lineIndex));

          this.isAutoFormatting = true;
          try {
            await this.vscode.workspace.applyEdit(edit);
          } finally {
            this.isAutoFormatting = false;
          }
          return;
        }
      }

      // 4. Format keywords to uppercase on the submitted valid line (if not replaced above)
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
  parseBasicLineNumber,
  findExistingLineIndex,
  calculateLineReplacement,
  SpectrumBeeper,
  formatLineKeywords,
  RetroModeController,
  ensureFontInstalled,
  buildBannerHtml,
  RETRO_COLORS,
  RETRO_COLOR_KEYS
};

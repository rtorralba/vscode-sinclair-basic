const test = require('node:test');
const assert = require('node:assert');
const { detectCursorMode, validateBasicLine, SpectrumBeeper, formatLineKeywords } = require('../src/core/retroMode');

test('detectCursorMode detects [K] at line start and after line numbers', () => {
  // Empty line
  assert.strictEqual(detectCursorMode('', 0), 'K');
  assert.strictEqual(detectCursorMode('   ', 2), 'K');

  // After line number
  assert.strictEqual(detectCursorMode('10 ', 3), 'K');
  assert.strictEqual(detectCursorMode('100   ', 6), 'K');

  // Unnumbered indented line in JBAS
  assert.strictEqual(detectCursorMode('  ', 2, true), 'K');
  assert.strictEqual(detectCursorMode('@start: ', 8, true), 'K');
});

test('detectCursorMode detects [L] when typing expressions or arguments', () => {
  // Inside keyword or arguments
  assert.strictEqual(detectCursorMode('10 PR', 5), 'L');
  assert.strictEqual(detectCursorMode('10 PRINT ', 9), 'L');
  assert.strictEqual(detectCursorMode('10 LET a = 1', 12), 'L');
});

test('detectCursorMode detects [K] immediately after statement separator :', () => {
  // Statement separators
  assert.strictEqual(detectCursorMode('10 PRINT "A": ', 14), 'K');
  assert.strictEqual(detectCursorMode('10 LET a=1: ', 12), 'K');
  assert.strictEqual(detectCursorMode('10 BORDER 0 : PRINT 1 : ', 24), 'K');
});

test('detectCursorMode strictly handles colons inside strings as [L]', () => {
  // Colon inside double quotes is NOT a statement separator
  const line = '10 PRINT "HELLO:WORLD"';
  // Column after the colon inside the string
  const colInside = line.indexOf(':') + 1;
  assert.strictEqual(detectCursorMode(line, colInside), 'L');
});

test('detectCursorMode handles JBAS @label jumps and arguments', () => {
  assert.strictEqual(detectCursorMode('GO TO @loop', 11, true), 'L');
  assert.strictEqual(detectCursorMode('@main: PRINT "X": ', 18, true), 'K');
});

test('SpectrumBeeper can be initialized, emits click/error/cursor and disposes safely', () => {
  const beeper = new SpectrumBeeper();
  assert.ok(beeper);
  assert.strictEqual(typeof beeper.click, 'function');
  assert.strictEqual(typeof beeper.error, 'function');
  assert.strictEqual(typeof beeper.cursor, 'function');
  assert.strictEqual(typeof beeper.beep, 'function');
  assert.strictEqual(typeof beeper.dispose, 'function');

  // Ensure calling sounds does not throw
  beeper.click();
  beeper.error();
  beeper.cursor();
  beeper.beep();

  beeper.dispose();
  assert.strictEqual(beeper.isDisposed, true);
});

test('formatLineKeywords integrates with retroMode', () => {
  const formatted = formatLineKeywords('10 print "hello": let a=1', false);
  assert.strictEqual(formatted, '10 PRINT "hello": LET a=1');
});

test('validateBasicLine validates correct Sinclair BASIC and JBAS lines', () => {
  // Empty or blank
  assert.strictEqual(validateBasicLine('').valid, true);
  assert.strictEqual(validateBasicLine('   ').valid, true);

  // Standard valid statements
  assert.strictEqual(validateBasicLine('10 PRINT "HELLO WORLD"').valid, true);
  assert.strictEqual(validateBasicLine('20 BORDER 0: PAPER 7: INK 0: CLS').valid, true);
  assert.strictEqual(validateBasicLine('30 FOR i = 1 TO 10: NEXT i').valid, true);
  assert.strictEqual(validateBasicLine('40 IF x = 1 THEN GO TO 100').valid, true);
  assert.strictEqual(validateBasicLine('50 POKE 23609, 10').valid, true);
  assert.strictEqual(validateBasicLine('60 GO SUB 500').valid, true);
  assert.strictEqual(validateBasicLine('70 LET a = (1 + 2) * 3').valid, true);

  // Valid REM with unclosed quotes and parens (allowed in comments)
  assert.strictEqual(validateBasicLine('80 REM Unclosed quote " and paren ( here').valid, true);

  // JBAS valid lines
  assert.strictEqual(validateBasicLine('@start:', true).valid, true);
  assert.strictEqual(validateBasicLine("@loop: PRINT ' comment", true).valid, true);
  assert.strictEqual(validateBasicLine('player_x = 10', true).valid, true);
});

test('validateBasicLine detects syntax errors accurately', () => {
  // Missing line number in standard .bas
  assert.strictEqual(validateBasicLine('PRINT "NO LINE NUMBER"').valid, false);

  // Unclosed string literal
  assert.strictEqual(validateBasicLine('10 PRINT "HELLO').valid, false);

  // Unclosed / unmatched parentheses
  assert.strictEqual(validateBasicLine('10 LET a = (1 + 2').valid, false);
  assert.strictEqual(validateBasicLine('10 LET a = 1 + 2)').valid, false);

  // FOR without TO
  assert.strictEqual(validateBasicLine('10 FOR i = 1 10').valid, false);

  // IF without THEN
  assert.strictEqual(validateBasicLine('10 IF x = 1').valid, false);

  // Jump without target
  assert.strictEqual(validateBasicLine('10 GO TO').valid, false);
  assert.strictEqual(validateBasicLine('10 GO SUB').valid, false);

  // Empty statement / trailing colon
  assert.strictEqual(validateBasicLine('10 BORDER 1:').valid, false);
  assert.strictEqual(validateBasicLine('10 BORDER 1:: CLS').valid, false);

  // Unrecognized keyword
  assert.strictEqual(validateBasicLine('10 INVALIDKEYWORD 123').valid, false);
});

test('parseBasicLineNumber extracts line numbers and commands accurately', () => {
  const { parseBasicLineNumber } = require('../src/core/retroMode');

  assert.deepStrictEqual(parseBasicLineNumber('10 PRINT "HOLA"'), { lineNum: 10, command: 'PRINT "HOLA"' });
  assert.deepStrictEqual(parseBasicLineNumber('  100   LET a = 5  '), { lineNum: 100, command: 'LET a = 5' });
  assert.deepStrictEqual(parseBasicLineNumber('50'), { lineNum: 50, command: '' });
  assert.deepStrictEqual(parseBasicLineNumber(' 50 '), { lineNum: 50, command: '' });

  // Invalid / unnumbered
  assert.strictEqual(parseBasicLineNumber('PRINT "NO NUM"'), null);
  assert.strictEqual(parseBasicLineNumber('@label: LET a=1'), null);
  assert.strictEqual(parseBasicLineNumber('0 PRINT'), null);
  assert.strictEqual(parseBasicLineNumber('10000 PRINT'), null);
  assert.strictEqual(parseBasicLineNumber(''), null);
  assert.strictEqual(parseBasicLineNumber(null), null);
});

test('findExistingLineIndex locates duplicate line numbers excluding current line', () => {
  const { findExistingLineIndex } = require('../src/core/retroMode');

  const lines = [
    '10 PRINT "PRUEBA 1"',
    '20 GO TO 10',
    '30 PRINT "PRUEBA 2"',
    '10 PRINT "NUEVA 10"'
  ];

  // Excluding line 3 (the submitted line), line 10 exists at index 0
  assert.strictEqual(findExistingLineIndex(lines, 10, 3), 0);

  // Excluding line 0, line 10 exists at index 3
  assert.strictEqual(findExistingLineIndex(lines, 10, 0), 3);

  // When editing line 0 in-place (excluding index 0), line 20 does NOT exist at 0
  assert.strictEqual(findExistingLineIndex(lines, 20, 1), -1);

  // Non-existent line number
  assert.strictEqual(findExistingLineIndex(lines, 50, -1), -1);
});

test('calculateLineReplacement replaces existing line when duplicate line number is entered', () => {
  const { calculateLineReplacement } = require('../src/core/retroMode');

  const lines = [
    '10 PRINT "VIEJO"',
    '20 GO TO 10',
    '10 print "nuevo"' // typed at index 2
  ];

  const res = calculateLineReplacement(lines, 2, { formatKeywords: true });
  assert.strictEqual(res.shouldReplace, true);
  assert.strictEqual(res.existingLineIndex, 0);
  assert.strictEqual(res.submittedLineIndex, 2);
  assert.strictEqual(res.lineNum, 10);
  assert.strictEqual(res.isDeleteOnly, false);
  assert.strictEqual(res.formattedText, '10 PRINT "nuevo"');
});

test('calculateLineReplacement handles standalone line number as line deletion', () => {
  const { calculateLineReplacement } = require('../src/core/retroMode');

  const lines = [
    '10 PRINT "BORRAR"',
    '20 GO TO 10',
    '10' // typed standalone 10 at index 2
  ];

  const res = calculateLineReplacement(lines, 2);
  assert.strictEqual(res.shouldReplace, true);
  assert.strictEqual(res.existingLineIndex, 0);
  assert.strictEqual(res.submittedLineIndex, 2);
  assert.strictEqual(res.lineNum, 10);
  assert.strictEqual(res.isDeleteOnly, true);
});

test('calculateLineReplacement returns shouldReplace false when editing in-place or creating new line', () => {
  const { calculateLineReplacement } = require('../src/core/retroMode');

  const lines = [
    '10 PRINT "HOLA"',
    '20 GO TO 10',
    '30 PRINT "NUEVA LINEA 30"'
  ];

  // In-place edit of line 0
  assert.strictEqual(calculateLineReplacement(lines, 0).shouldReplace, false);

  // Brand new line 30 at index 2 (line 30 doesn't exist anywhere else)
  const resNew = calculateLineReplacement(lines, 2);
  assert.strictEqual(resNew.shouldReplace, false);
  assert.strictEqual(resNew.isNew, true);

  // Unnumbered line
  assert.strictEqual(calculateLineReplacement(['PRINT "NO NUM"'], 0).shouldReplace, false);
});

test('RETRO_COLORS styles suggest widget and guarantees 100% cleanup without polluting default theme', () => {
  const { RETRO_COLORS, RETRO_COLOR_KEYS } = require('../src/core/retroMode');

  // Authentic ZX Spectrum Paper 7 (#D9D9D9) and blue block cursor (#2A2AF0)
  assert.strictEqual(RETRO_COLORS['editor.background'], '#D9D9D9');
  assert.strictEqual(RETRO_COLORS['editorCursor.foreground'], '#2A2AF0');
  assert.strictEqual(RETRO_COLORS['editorGroup.border'], '#D9D9D9');

  // Must define suggest widget colors to prevent "black on dark" text
  assert.strictEqual(RETRO_COLORS['editorSuggestWidget.background'], '#FFFFFF');
  assert.strictEqual(RETRO_COLORS['editorSuggestWidget.foreground'], '#000000');
  assert.strictEqual(RETRO_COLORS['editorSuggestWidget.selectedBackground'], '#0078D4');
  assert.strictEqual(RETRO_COLORS['editorSuggestWidget.selectedForeground'], '#FFFFFF');
  assert.strictEqual(RETRO_COLORS['editorHoverWidget.background'], '#FFFFFF');
  assert.strictEqual(RETRO_COLORS['editorHoverWidget.foreground'], '#000000');

  assert.strictEqual(RETRO_COLORS['statusBar.background'], undefined);

  // Every single key in RETRO_COLORS MUST be present in RETRO_COLOR_KEYS for 100% cleanup
  for (const key of Object.keys(RETRO_COLORS)) {
    assert.ok(RETRO_COLOR_KEYS.includes(key), `Key ${key} must be in RETRO_COLOR_KEYS for clean deactivation`);
  }
});

test('buildBannerHtml draws +3 BASIC label and the four Spectrum stripes inside #D9D9D9 border', () => {
  const { buildBannerHtml } = require('../src/core/retroMode');
  const html = buildBannerHtml('vscode-resource:/ZXSpectrum.ttf', 'csp-source');
  assert.ok(html.includes('+3 BASIC'));
  assert.ok(html.includes('#D9D9D9'));
  for (const c of ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF']) assert.ok(html.includes(c));
  assert.ok(html.includes('vscode-resource:/ZXSpectrum.ttf'));
  assert.ok(html.includes('csp-source'));
  assert.ok(!buildBannerHtml().includes('@font-face'));
});

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

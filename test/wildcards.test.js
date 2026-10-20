const test = require('node:test');
const assert = require('node:assert/strict');
const { translateWildcardsToChr, translateStringLiteralToChr } = require('../src/core/wildcards.js');

test('translateStringLiteralToChr translates color attributes to CHR$', () => {
  assert.equal(translateStringLiteralToChr('{PAPER 2}'), 'CHR$ 17 + CHR$ 2');
  assert.equal(translateStringLiteralToChr('{INK 1}'), 'CHR$ 16 + CHR$ 1');
  assert.equal(translateStringLiteralToChr('{FLASH 1}'), 'CHR$ 18 + CHR$ 1');
  assert.equal(translateStringLiteralToChr('{BRIGHT 1}'), 'CHR$ 19 + CHR$ 1');
  assert.equal(translateStringLiteralToChr('{INVERSE 1}'), 'CHR$ 20 + CHR$ 1');
  assert.equal(translateStringLiteralToChr('{OVER 1}'), 'CHR$ 21 + CHR$ 1');
});

test('translateStringLiteralToChr translates AT and TAB coordinates to CHR$', () => {
  assert.equal(translateStringLiteralToChr('{AT 10, 5}'), 'CHR$ 22 + CHR$ 10 + CHR$ 5');
  assert.equal(translateStringLiteralToChr('{AT 0,0}'), 'CHR$ 22 + CHR$ 0 + CHR$ 0');
  assert.equal(translateStringLiteralToChr('{TAB 16}'), 'CHR$ 23 + CHR$ 16');
});

test('translateStringLiteralToChr translates CODE, hex, and UDGs', () => {
  assert.equal(translateStringLiteralToChr('{CODE 65}'), 'CHR$ 65');
  assert.equal(translateStringLiteralToChr('{#FF}'), 'CHR$ 255');
  assert.equal(translateStringLiteralToChr('{\\x41}'), 'CHR$ 65');
  assert.equal(translateStringLiteralToChr('\\x42'), 'CHR$ 66');
  assert.equal(translateStringLiteralToChr('{A}'), 'CHR$ 144');
  assert.equal(translateStringLiteralToChr('\\B'), 'CHR$ 145');
});

test('translateStringLiteralToChr handles mixed strings with text and wildcards', () => {
  assert.equal(
    translateStringLiteralToChr('{AT 10,1}{PAPER 2}HOLA'),
    'CHR$ 22 + CHR$ 10 + CHR$ 1 + CHR$ 17 + CHR$ 2 + "HOLA"'
  );

  assert.equal(
    translateStringLiteralToChr('SCORE: {INK 7}100'),
    '"SCORE: " + CHR$ 16 + CHR$ 7 + "100"'
  );
});

test('translateStringLiteralToChr leaves plain strings untouched', () => {
  assert.equal(translateStringLiteralToChr('HELLO WORLD'), '"HELLO WORLD"');
  assert.equal(translateStringLiteralToChr("DON'T PANIC"), '"DON\'T PANIC"');
});

test('translateWildcardsToChr translates wildcards across full program preserving REM and comments', () => {
  const code = [
    '10 PRINT "{AT 10,1}{PAPER 2}HOLA"',
    '20 PRINT "{PAPER 4} "; "{INK 1}OK"',
    '30 LET a$ = "{CODE 13}"',
    '40 REM This is a comment with {PAPER 2} which should not be changed',
    '50 PRINT "STANDARD TEXT"'
  ].join('\n');

  const translated = translateWildcardsToChr(code, { isJBas: false });
  const lines = translated.split('\n');

  assert.equal(lines[0], '10 PRINT CHR$ 22 + CHR$ 10 + CHR$ 1 + CHR$ 17 + CHR$ 2 + "HOLA"');
  assert.equal(lines[1], '20 PRINT CHR$ 17 + CHR$ 4 + " "; CHR$ 16 + CHR$ 1 + "OK"');
  assert.equal(lines[2], '30 LET a$ = CHR$ 13');
  assert.equal(lines[3], '40 REM This is a comment with {PAPER 2} which should not be changed');
  assert.equal(lines[4], '50 PRINT "STANDARD TEXT"');
});

test('translateWildcardsToChr preserves CRLF line endings', () => {
  const code = '10 PRINT "{PAPER 2}"\r\n20 GOTO 10\r\n';
  const translated = translateWildcardsToChr(code);
  assert.equal(translated, '10 PRINT CHR$ 17 + CHR$ 2\r\n20 GOTO 10\r\n');
});

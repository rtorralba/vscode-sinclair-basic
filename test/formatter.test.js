const test = require('node:test');
const assert = require('node:assert/strict');
const { formatKeywordsToUpper, formatLineKeywords } = require('../src/core/formatter.js');

test('formatKeywordsToUpper converts statements and functions to uppercase', () => {
  const code = [
    '10 border 1: paper 2: ink 7: cls',
    '20 let a = 10: let b = 20',
    '30 for i = 1 to 10 step 2',
    '40 print at 10, 5; "INDEX: "; i',
    '50 next i',
    '60 if a > b and not a = 0 or b < 5 then stop',
    '70 poke 23606, 0: let p = peek 23606',
    '80 def fn double(x) = x * 2: let y = fn double(4)',
    '90 randomize 0: pause 50: beep 1, 0',
    '100 circle 128, 88, 30: draw 10, 20: plot 50, 50'
  ].join('\n');

  const formatted = formatKeywordsToUpper(code, { isJBas: false });
  const lines = formatted.split('\n');

  assert.equal(lines[0], '10 BORDER 1: PAPER 2: INK 7: CLS');
  assert.equal(lines[1], '20 LET a = 10: LET b = 20');
  assert.equal(lines[2], '30 FOR i = 1 TO 10 STEP 2');
  assert.equal(lines[3], '40 PRINT AT 10, 5; "INDEX: "; i');
  assert.equal(lines[4], '50 NEXT i');
  assert.equal(lines[5], '60 IF a > b AND NOT a = 0 OR b < 5 THEN STOP');
  assert.equal(lines[6], '70 POKE 23606, 0: LET p = PEEK 23606');
  assert.equal(lines[7], '80 DEF FN double(x) = x * 2: LET y = FN double(4)');
  assert.equal(lines[8], '90 RANDOMIZE 0: PAUSE 50: BEEP 1, 0');
  assert.equal(lines[9], '100 CIRCLE 128, 88, 30: DRAW 10, 20: PLOT 50, 50');
});

test('formatKeywordsToUpper handles multi-word keywords and aliases', () => {
  const code = [
    '10 goto 100',
    '20 go to 200',
    '30 gosub 300',
    '40 go sub 400',
    '50 open # 1, "m", 1, "data"',
    '60 close # 1'
  ].join('\n');

  const formatted = formatKeywordsToUpper(code);
  const lines = formatted.split('\n');

  assert.equal(lines[0], '10 GOTO 100');
  assert.equal(lines[1], '10 GO TO 200'.replace('10', '20'));
  assert.equal(lines[2], '30 GOSUB 300');
  assert.equal(lines[3], '40 GO SUB 400');
  assert.equal(lines[4], '50 OPEN # 1, "m", 1, "data"');
  assert.equal(lines[5], '60 CLOSE # 1');
});

test('formatKeywordsToUpper handles dollar functions', () => {
  const code = [
    '10 let k$ = inkey$',
    '20 let c$ = chr$ 65',
    '30 let s$ = screen$(10, 5)',
    '40 let v$ = val$("123")',
    '50 let n$ = str$ 42'
  ].join('\n');

  const formatted = formatKeywordsToUpper(code);
  const lines = formatted.split('\n');

  assert.equal(lines[0], '10 LET k$ = INKEY$');
  assert.equal(lines[1], '20 LET c$ = CHR$ 65');
  assert.equal(lines[2], '30 LET s$ = SCREEN$(10, 5)');
  assert.equal(lines[3], '40 LET v$ = VAL$("123")');
  assert.equal(lines[4], '50 LET n$ = STR$ 42');
});

test('formatKeywordsToUpper strictly protects string literals', () => {
  const line = '10 print "don\'t panic, and then go to line 20: for i = 1 to 10"';
  const formatted = formatKeywordsToUpper(line);
  assert.equal(formatted, '10 PRINT "don\'t panic, and then go to line 20: for i = 1 to 10"');
});

test('formatKeywordsToUpper strictly protects REM comments', () => {
  const line = '10 rem this is a test: for i = 1 to 10: goto 20: poke 23606, 0';
  const formatted = formatKeywordsToUpper(line);
  assert.equal(formatted, '10 REM this is a test: for i = 1 to 10: goto 20: poke 23606, 0');
});

test('formatKeywordsToUpper strictly protects .jbas single-quote comments', () => {
  const line = 'let a = 1 \' comment with print, goto, and for loop';
  const formatted = formatKeywordsToUpper(line, { isJBas: true });
  assert.equal(formatted, 'LET a = 1 \' comment with print, goto, and for loop');
});

test('formatKeywordsToUpper strictly protects @labels in .jbas', () => {
  const code = [
    '@for_loop:',
    '  let count = count + 1',
    '  if count < 10 then goto @for_loop',
    '@stop_here:',
    '  stop'
  ].join('\n');

  const formatted = formatKeywordsToUpper(code, { isJBas: true });
  const lines = formatted.split('\n');

  assert.equal(lines[0], '@for_loop:');
  assert.equal(lines[1], '  LET count = count + 1');
  assert.equal(lines[2], '  IF count < 10 THEN GOTO @for_loop');
  assert.equal(lines[3], '@stop_here:');
  assert.equal(lines[4], '  STOP');
});

test('formatKeywordsToUpper does not alter variable names containing keyword substrings', () => {
  const code = [
    'let total = 5',
    'let score = 100',
    'let stopwatch = 0',
    'let formation = 1',
    'let at_home = 2',
    'let point1 = 3',
    'let remark = 4',
    'let linecount = 10',
    'let returncode = 0'
  ].join('\n');

  const formatted = formatKeywordsToUpper(code);
  const lines = formatted.split('\n');

  assert.equal(lines[0], 'LET total = 5');
  assert.equal(lines[1], 'LET score = 100');
  assert.equal(lines[2], 'LET stopwatch = 0');
  assert.equal(lines[3], 'LET formation = 1');
  assert.equal(lines[4], 'LET at_home = 2');
  assert.equal(lines[5], 'LET point1 = 3');
  assert.equal(lines[6], 'LET remark = 4');
  assert.equal(lines[7], 'LET linecount = 10');
  assert.equal(lines[8], 'LET returncode = 0');
});

test('formatKeywordsToUpper preserves CRLF line endings', () => {
  const code = '10 print "hello"\r\n20 goto 10\r\n';
  const formatted = formatKeywordsToUpper(code);
  assert.equal(formatted, '10 PRINT "hello"\r\n20 GOTO 10\r\n');
});

test('formatKeywordsToUpper formats every keyword in KEYWORDS_LIST', () => {
  const { KEYWORDS_LIST } = require('../src/core/keywords.js');
  for (const item of KEYWORDS_LIST) {
    const lower = item.name.toLowerCase();
    const formatted = formatKeywordsToUpper(lower);
    assert.equal(
      formatted,
      item.name,
      `Keyword "${lower}" should be formatted to "${item.name}", got "${formatted}"`
    );
  }
});


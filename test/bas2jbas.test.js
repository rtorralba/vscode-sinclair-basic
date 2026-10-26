const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slugifyTitle,
  findJumpTargets,
  convertRemToSingleQuote,
  basToJBas
} = require('../src/core/bas2jbas.js');
const { compileJBas } = require('../src/core/jbas2bas.js');

test('slugifyTitle converts titles to clean snake_case labels', () => {
  assert.equal(slugifyTitle('Game Over'), 'game_over');
  assert.equal(slugifyTitle('SUB Draw Player'), 'draw_player');
  assert.equal(slugifyTitle('*** SCORE LOOP ***'), 'score_loop');
  assert.equal(slugifyTitle('10 Start'), 'label_10_start');
});

test('convertRemToSingleQuote converts full-line and inline REM comments', () => {
  assert.equal(convertRemToSingleQuote('REM Just a comment'), "' Just a comment");
  assert.equal(convertRemToSingleQuote('LET x=1: REM inline comment'), "LET x=1 ' inline comment");
  assert.equal(convertRemToSingleQuote('PRINT "DO NOT REMOVE": REM print msg'), 'PRINT "DO NOT REMOVE" \' print msg');
});

test('basToJBas converts numbered BAS to clean JBAS with @labels and indentation', () => {
  const bas = `10 REM Main program
20 BORDER 0: PAPER 0: INK 7: CLS
30 GO SUB 100
40 GO TO 20
100 REM SUB Draw Screen
110 PRINT AT 10, 5; "HELLO"
120 RETURN
`;

  const jbas = basToJBas(bas);
  assert.ok(jbas.includes("' Main program"));
  assert.ok(jbas.includes('@line_20:'));
  assert.ok(jbas.includes('GO SUB @draw_screen'));
  assert.ok(jbas.includes('GO TO @line_20'));
  assert.ok(jbas.includes('@draw_screen:'));
  assert.ok(jbas.includes('  PRINT AT 10, 5; "HELLO"'));
  assert.ok(jbas.includes('  RETURN'));

  // Transpile generated JBAS back to BAS with compileJBas
  const compiled = compileJBas(jbas, { start: 10, step: 10 });
  assert.equal(compiled.success, true);
  assert.equal(compiled.errors.length, 0);
  assert.ok(compiled.text.includes('BORDER 0: PAPER 0: INK 7: CLS'));
  assert.ok(compiled.text.includes('RETURN'));
});

test('basToJBas handles multi-target jumps and conditional jumps', () => {
  const bas = `10 IF x=1 THEN 50
20 IF x=2 THEN GO TO 60
30 ON opt GO SUB 100, 200
40 STOP
50 PRINT "X IS 1": STOP
60 PRINT "X IS 2": STOP
100 PRINT "SUB 1": RETURN
200 PRINT "SUB 2": RETURN
`;

  const jbas = basToJBas(bas);
  assert.ok(jbas.includes('THEN @line_50'));
  assert.ok(jbas.includes('THEN GO TO @line_60'));
  assert.ok(jbas.includes('ON opt GO SUB @sub_100, @sub_200'));
  assert.ok(jbas.includes('@line_50:'));
  assert.ok(jbas.includes('@line_60:'));
  assert.ok(jbas.includes('@sub_100:'));
  assert.ok(jbas.includes('@sub_200:'));

  const compiled = compileJBas(jbas, { start: 10, step: 10 });
  assert.equal(compiled.success, true);
  assert.equal(compiled.errors.length, 0);
});

test('basToJBas strictly protects string literals and REM comments', () => {
  const bas = `10 PRINT "GO TO 100 AND GO SUB 200"
20 REM Don't touch 100 or 200 in comment
30 GO TO 10
`;

  const jbas = basToJBas(bas);
  assert.ok(jbas.includes('PRINT "GO TO 100 AND GO SUB 200"'));
  assert.ok(jbas.includes("@line_10:"));
  assert.ok(jbas.includes("GO TO @line_10"));
});

test('basToJBas preserves computed GOTO expressions like GO TO 10*j without converting to @labels', () => {
  const bas = `10 LET j=ATTR(y,x): GO TO 10*j
20 GO TO 100+offset
30 IF o THEN GO TO r
40 GO TO 50
50 STOP
`;

  const jbas = basToJBas(bas);
  assert.ok(jbas.includes('GO TO 10*j'));
  assert.ok(jbas.includes('GO TO 100+offset'));
  assert.ok(jbas.includes('GO TO r'));
  assert.ok(jbas.includes('GO TO @line_50'));
  assert.ok(!jbas.includes('@line_10*j'));
  assert.ok(!jbas.includes('@line_100+'));
});


const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripComments,
  replaceLabelsOutsideStrings,
  compileJBas
} = require('../src/core/jbas2bas.js');

test('stripComments strips single quote comments outside string literals', () => {
  assert.equal(stripComments("' Just a comment"), '');
  assert.equal(stripComments("LET x=1 ' init x"), 'LET x=1');
  assert.equal(stripComments('PRINT "DON\'T PANIC" \' inline comment'), 'PRINT "DON\'T PANIC"');
  assert.equal(stripComments('PRINT "NO COMMENTS"'), 'PRINT "NO COMMENTS"');
});

test('compileJBas compiles labels, strips comments, and generates sequential numbers', () => {
  const source = `
' Program Title
DIM y(7)
GO TO @start

' Main loop
@loop:
LET x=x+1 ' Increment
IF x>10 THEN GO TO @end
GO TO @loop

@start:
LET x=0
GO TO @loop

@end:
STOP
`;

  const res = compileJBas(source, { start: 10, step: 10 });
  assert.equal(res.success, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.linesCount, 8);

  const lines = res.text.trim().split(/\r?\n/);
  assert.equal(lines[0], '10 DIM y(7)');
  assert.equal(lines[1], '20 GO TO 60'); // @start is line 60
  assert.equal(lines[2], '30 LET x=x+1');
  assert.equal(lines[3], '40 IF x>10 THEN GO TO 80'); // @end is line 80
  assert.equal(lines[4], '50 GO TO 30'); // @loop is line 30
  assert.equal(lines[5], '60 LET x=0');
  assert.equal(lines[6], '70 GO TO 30');
  assert.equal(lines[7], '80 STOP');
});

test('compileJBas detects undefined labels', () => {
  const source = `
LET x=1
GO TO @missing_label
`;
  const res = compileJBas(source);
  assert.equal(res.success, false);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /Undefined label '@missing_label'/);
});

test('compileJBas handles label on the same line as code', () => {
  const source = `
@init: LET a=10
GO TO @init
`;
  const res = compileJBas(source, { start: 100, step: 10 });
  assert.equal(res.success, true);
  const lines = res.text.trim().split(/\r?\n/);
  assert.equal(lines[0], '100 LET a=10');
  assert.equal(lines[1], '110 GO TO 100');
});

test('compileJBas detects duplicate labels', () => {
  const source = `
@start:
LET x=1
@loop:
LET x=x+1
@start:
STOP
`;
  const res = compileJBas(source);
  assert.equal(res.success, false);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /Duplicate label definition '@start'/);
  assert.match(res.errors[0], /previously defined on line 2/);
});


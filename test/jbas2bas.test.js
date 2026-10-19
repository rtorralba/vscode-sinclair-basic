const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripComments,
  convertCommentsToRem,
  replaceLabelsOutsideStrings,
  compileJBas,
  transpileJBasAllVersions
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

test('convertCommentsToRem converts single-quote comments to Sinclair BASIC REM', () => {
  assert.equal(convertCommentsToRem("' Single comment"), 'REM Single comment');
  assert.equal(convertCommentsToRem("LET a=1 ' inline comment"), 'LET a=1: REM inline comment');
  assert.equal(convertCommentsToRem('PRINT "DON\'T PANIC" \' comment'), 'PRINT "DON\'T PANIC": REM comment');
  assert.equal(convertCommentsToRem('LET a=1: \' comment'), 'LET a=1: REM comment');
  assert.equal(convertCommentsToRem('REM already rem'), 'REM already rem');
});

test('compileJBas with keepComments converts comments to numbered REM lines and preserves jumps', () => {
  const source = `
' Title Comment
DIM a(5)
' Inline loop comment
@loop:
LET a(1)=1 ' Set array
GO TO @loop
`;

  const res = compileJBas(source, { start: 10, step: 10, keepComments: true });
  assert.equal(res.success, true);
  const lines = res.text.trim().split(/\r?\n/);
  assert.equal(lines[0], '10 REM Title Comment');
  assert.equal(lines[1], '20 DIM a(5)');
  assert.equal(lines[2], '30 REM Inline loop comment');
  assert.equal(lines[3], '40 LET a(1)=1: REM Set array');
  assert.equal(lines[4], '50 GO TO 40'); // @loop mapped to line 40
});

test('replaceLabelsOutsideStrings ignores @ characters inside REM comments', () => {
  const source = `
' Contact: dev@example.com
@start:
LET a=1
REM Check @param and test@foo
GO TO @start
`;

  const res = compileJBas(source, { start: 10, step: 10, keepComments: true });
  assert.equal(res.success, true);
  assert.equal(res.errors.length, 0);
  const lines = res.text.trim().split(/\r?\n/);
  assert.equal(lines[0], '10 REM Contact: dev@example.com');
  assert.equal(lines[1], '20 LET a=1');
  assert.equal(lines[2], '30 REM Check @param and test@foo');
  assert.equal(lines[3], '40 GO TO 20');
});

test('transpileJBasAllVersions generates compact (1x1), step10 (10x10), and comments (10x10 + REM) versions', () => {
  const source = `
' Main header
@start:
BORDER 0: INK 7: PAPER 0: CLS ' Screen setup
PRINT AT 10,10; "SCORE: "; score ' Show score
LET a=1 : LET b=2 : LET c=3
GO TO @start
`;

  const all = transpileJBasAllVersions(source);
  assert.equal(all.success, true);

  // Compact: 1 by 1, without comments and with compacted operator whitespace (most optimal for TAP)
  const compactLines = all.compact.text.trim().split(/\r?\n/);
  assert.equal(compactLines[0], '1 BORDER 0:INK 7:PAPER 0:CLS');
  assert.equal(compactLines[1], '2 PRINT AT 10,10;"SCORE: ";score');
  assert.equal(compactLines[2], '3 LET a=1:LET b=2:LET c=3');
  assert.equal(compactLines[3], '4 GO TO 1');

  // Step 10: 10 by 10, without comments (preserves original spacing for readability)
  const step10Lines = all.step10.text.trim().split(/\r?\n/);
  assert.equal(step10Lines[0], '10 BORDER 0: INK 7: PAPER 0: CLS');
  assert.equal(step10Lines[1], '20 PRINT AT 10,10; "SCORE: "; score');
  assert.equal(step10Lines[2], '30 LET a=1 : LET b=2 : LET c=3');
  assert.equal(step10Lines[3], '40 GO TO 10');

  // Comments: 10 by 10, with comments
  const commentsLines = all.comments.text.trim().split(/\r?\n/);
  assert.equal(commentsLines[0], '10 REM Main header');
  assert.equal(commentsLines[1], '20 BORDER 0: INK 7: PAPER 0: CLS: REM Screen setup');
  assert.equal(commentsLines[2], '30 PRINT AT 10,10; "SCORE: "; score: REM Show score');
  assert.equal(commentsLines[3], '40 LET a=1 : LET b=2 : LET c=3');
  assert.equal(commentsLines[4], '50 GO TO 20');
});

test('compactWhitespaceOutsideStrings compacts spaces around operators while protecting strings and REM', () => {
  const { compactWhitespaceOutsideStrings } = require('../src/core/jbas2bas.js');

  // Arithmetic and string concatenation (+, -, *, /)
  assert.equal(
    compactWhitespaceOutsideStrings('LET c$ = CHR$ 17 + CHR$ 4 + " " + CHR$ 17 + CHR$ 1 + " "'),
    'LET c$=CHR$ 17+CHR$ 4+" "+CHR$ 17+CHR$ 1+" "'
  );
  assert.equal(
    compactWhitespaceOutsideStrings('LET p$  = CHR$ 17 + CHR$ 3 + CHR$ 16 + CHR$ 2 + CHR$ 18 + CHR$ 1 + " " + CHR$ 17 + CHR$ 1 + CHR$ 18 + CHR$ 0 + " "'),
    'LET p$=CHR$ 17+CHR$ 3+CHR$ 16+CHR$ 2+CHR$ 18+CHR$ 1+" "+CHR$ 17+CHR$ 1+CHR$ 18+CHR$ 0+" "'
  );

  // Relational operators (<, >, <=, >=, <>, =)
  assert.equal(
    compactWhitespaceOutsideStrings('IF c1 < 0 THEN LET c1 = c2 + 31 + INT (RND * 6)'),
    'IF c1<0 THEN LET c1=c2+31+INT(RND*6)'
  );
  assert.equal(
    compactWhitespaceOutsideStrings('IF py <> oldpy THEN PRINT AT oldpy, 5; " "; AT py, 5; PAPER 2; " "'),
    'IF py<>oldpy THEN PRINT AT oldpy,5;" ";AT py,5;PAPER 2;" "'
  );

  // Colons and semicolons
  assert.equal(
    compactWhitespaceOutsideStrings('LET py=0: LET oldpy=0: LET c1=0'),
    'LET py=0:LET oldpy=0:LET c1=0'
  );

  // Preserves REM comments
  assert.equal(
    compactWhitespaceOutsideStrings('LET a = 1 + 2: REM Comment with spaces: 1 + 2 = 3'),
    'LET a=1+2:REM Comment with spaces: 1 + 2 = 3'
  );
});


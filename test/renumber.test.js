const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseLine,
  splitStringsAndRem,
  updateReferencesInCode,
  renumberProgram,
  renumberFile
} = require('../src/core/renumber.js');

test('parseLine parses numbered and unnumbered lines', () => {
  const line1 = parseLine('10 PRINT "HELLO"');
  assert.equal(line1.lineNum, 10);
  assert.equal(line1.code, 'PRINT "HELLO"');
  assert.equal(line1.leadingWs, '');

  const line2 = parseLine('  20   GOTO 10');
  assert.equal(line2.lineNum, 20);
  assert.equal(line2.code, 'GOTO 10');
  assert.equal(line2.leadingWs, '  ');

  const line3 = parseLine('REM just a comment');
  assert.equal(line3.lineNum, null);
  assert.equal(line3.code, 'REM just a comment');
});

test('splitStringsAndRem protects strings and REM comments', () => {
  const line = 'PRINT "GO TO 50": REM GO TO 60';
  const chunks = splitStringsAndRem(line);

  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks[0], { text: 'PRINT ', type: 'code' });
  assert.deepEqual(chunks[1], { text: '"GO TO 50"', type: 'string' });
  assert.deepEqual(chunks[2], { text: ': ', type: 'code' });
  assert.deepEqual(chunks[3], { text: 'REM GO TO 60', type: 'rem' });
});

test('splitStringsAndRem does not trigger on words starting with REM like REMARK', () => {
  const line = 'LET REMARK = 10';
  const chunks = splitStringsAndRem(line);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, 'code');
});

test('updateReferencesInCode updates single and multiple jump targets', () => {
  const mapping = new Map([
    [10, 100],
    [20, 110],
    [30, 120]
  ]);
  const warnings = [];

  const code1 = 'GO TO 10: GOSUB 20: RESTORE 30';
  const res1 = updateReferencesInCode(code1, mapping, warnings);
  assert.equal(res1, 'GO TO 100: GOSUB 110: RESTORE 120');
  assert.equal(warnings.length, 0);

  const code2 = 'ON X GO TO 10, 20, 30';
  const res2 = updateReferencesInCode(code2, mapping, warnings);
  assert.equal(res2, 'ON X GO TO 100, 110, 120');

  const code3 = 'GOTO 99';
  const res3 = updateReferencesInCode(code3, mapping, warnings);
  assert.equal(res3, 'GOTO 99');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Target line 99/);
});

test('renumberProgram renumbers program correctly with custom start and step', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'sample.bas');
  const input = fs.readFileSync(fixturePath, 'utf-8');

  const result = renumberProgram(input, { start: 100, step: 20 });
  assert.equal(result.success, true);
  assert.equal(result.linesCount, 9);
  assert.equal(result.warnings.length, 0);

  const lines = result.text.trim().split(/\r?\n/);
  assert.equal(lines[0], '100 REM *** TEST BASIC PROGRAM ***');
  assert.equal(lines[1], '120 PRINT "DO NOT CHANGE GO TO 99 OR 10": REM REMARK WITH GOTO 10');
  assert.equal(lines[2], '140 GO TO 180');
  assert.equal(lines[3], '160 GO SUB 220');
  assert.equal(lines[4], '180 IF X=1 THEN 200');
  assert.equal(lines[5], '200 ON K GO TO 120, 140, 160');
  assert.equal(lines[6], '220 RESTORE 240: RETURN');
  assert.equal(lines[7], '240 DATA 1,2,3');
  assert.equal(lines[8], '260 RUN 100');
});

test('renumberProgram preserves CRLF line endings when present', () => {
  const crlfInput = '10 PRINT 1\r\n20 GOTO 10\r\n';
  const result = renumberProgram(crlfInput);
  assert.equal(result.success, true);
  assert.ok(result.text.includes('\r\n'));
  assert.equal(result.text, '10 PRINT 1\r\n20 GOTO 10\r\n');
});

test('renumberFile handles file output and backup', () => {
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const tmpFile = path.join(tmpDir, 'test_run.bas');
  fs.writeFileSync(tmpFile, '10 PRINT "A"\n20 GOTO 10\n', 'utf-8');

  const ok = renumberFile(tmpFile, { start: 100, step: 50, makeBackup: true });
  assert.equal(ok, true);

  const updated = fs.readFileSync(tmpFile, 'utf-8');
  assert.equal(updated, '100 PRINT "A"\n150 GOTO 100\n');

  const backupFile = tmpFile + '.bak';
  assert.ok(fs.existsSync(backupFile));
  assert.equal(fs.readFileSync(backupFile, 'utf-8'), '10 PRINT "A"\n20 GOTO 10\n');

  // Clean up tmp files
  fs.unlinkSync(tmpFile);
  fs.unlinkSync(backupFile);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


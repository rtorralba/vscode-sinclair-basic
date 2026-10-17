const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  KEYWORDS,
  tokenizeLine,
  bas2tap,
  tap2buffer,
  generateTapFile
} = require('../src/core/tapGenerator.js');

test('tokenizeLine tokenizes Sinclair BASIC keywords and numbers', () => {
  const line = 'PRINT "HELLO"; AT 10,20; "WORLD"';
  const tokens = tokenizeLine(line);

  // First token should be PRINT (0xF5)
  assert.equal(tokens[0], KEYWORDS['PRINT']);
  // Ends with 0x0D (Enter)
  assert.equal(tokens[tokens.length - 1], 0x0D);
});

test('tokenizeLine is case-insensitive for keywords', () => {
  const line = 'print "hi": goto 10';
  const tokens = tokenizeLine(line);

  assert.equal(tokens[0], KEYWORDS['PRINT']);
  assert.ok(tokens.includes(KEYWORDS['GOTO']));
});

test('tokenizeLine does not tokenize keywords or numbers inside REM comments', () => {
  const line = 'REM PRINT GOTO 999';
  const tokens = tokenizeLine(line);

  assert.equal(tokens[0], KEYWORDS['REM']);
  // Following bytes should be raw ASCII for ' PRINT GOTO 999\r'
  const restChars = tokens.slice(1, -1).map(c => String.fromCharCode(c)).join('');
  assert.equal(restChars, ' PRINT GOTO 999');
});

test('bas2tap generates valid TAP header and data blocks with correct checksums', () => {
  const code = `
10 BORDER 1: PAPER 7: CLS
20 PRINT "HELLO SPECTRUM"
30 GO TO 20
`;
  const blocks = bas2tap(code, 'mygame', 10);
  assert.equal(blocks.length, 2);

  const headerBlock = blocks[0];
  const dataBlock = blocks[1];

  // Header block length: 2 bytes len + 1 flag (0x00) + 17 data + 1 checksum = 21 bytes
  assert.equal(headerBlock.length, 21);
  assert.equal(headerBlock[2], 0x00); // Flag: Header

  // Type: 0x00 Program
  assert.equal(headerBlock[3], 0x00);

  // Filename: "mygame    "
  const nameInHeader = String.fromCharCode(...headerBlock.slice(4, 14));
  assert.equal(nameInHeader, 'mygame    ');

  // Autostart line: 10
  const autoStart = headerBlock[3 + 13] | (headerBlock[3 + 14] << 8);
  assert.equal(autoStart, 10);

  // Verify header checksum: XOR of flag and 17 data bytes
  let headerXOR = 0;
  for (let i = 2; i < headerBlock.length - 1; i++) {
    headerXOR ^= headerBlock[i];
  }
  assert.equal(headerBlock[headerBlock.length - 1], headerXOR);

  // Data block flag: 0xFF
  assert.equal(dataBlock[2], 0xFF);

  // Verify data block checksum
  let dataXOR = 0;
  for (let i = 2; i < dataBlock.length - 1; i++) {
    dataXOR ^= dataBlock[i];
  }
  assert.equal(dataBlock[dataBlock.length - 1], dataXOR);
});

test('tokenizeLine correctly handles <>, <=, and >= operators without spaces', () => {
  const line = 'IF py<>oldpy AND c1<=31 AND sc>=50 THEN GO TO 10';
  const tokens = tokenizeLine(line);

  assert.ok(tokens.includes(KEYWORDS['<>']), 'Should contain <> token 0xC9');
  assert.ok(tokens.includes(KEYWORDS['<=']), 'Should contain <= token 0xC7');
  assert.ok(tokens.includes(KEYWORDS['>=']), 'Should contain >= token 0xC8');
  assert.ok(tokens.includes(KEYWORDS['THEN']), 'Should contain THEN token 0xCB');
  assert.ok(tokens.includes(KEYWORDS['GO TO']), 'Should contain GO TO token 0xEC');
});

test('tokenizeLine respects word boundaries for keywords in variable names', () => {
  const line = 'LET color=1: LET TOTAL=5: LET checkpoint=10';
  const tokens = tokenizeLine(line);

  // 'color' should NOT have OR (0xC5) tokenized
  assert.ok(!tokens.includes(KEYWORDS['OR']), 'Variable "color" should not tokenize OR');
  // 'TOTAL' should NOT have TO (0xCC) tokenized
  assert.ok(!tokens.includes(KEYWORDS['TO']), 'Variable "TOTAL" should not tokenize TO');
  // 'checkpoint' should NOT have POINT (0xA9) tokenized
  assert.ok(!tokens.includes(KEYWORDS['POINT']), 'Variable "checkpoint" should not tokenize POINT');
});

test('tokenizeLine does not encode digits inside multi-char variable names as numbers', () => {
  const line = 'LET c1=c1-1: LET c12=10';
  const tokens = tokenizeLine(line);

  // Variable names c1 and c12 should have ASCII digits without 0x0E hidden marker immediately following
  // Number literals -1 and 10 should have 0x0E marker
  const numMarkers = tokens.filter(b => b === 0x0E).length;
  // Exactly 2 number literals: 1 and 10
  assert.equal(numMarkers, 2, 'Only literal numbers 1 and 10 should have 0x0E markers');
});

test('generateTapFile writes a valid .tap file to disk', () => {
  const code = '10 PRINT "TEST TAP FILE": STOP';
  const outPath = path.join(__dirname, 'tmp', 'test_output.tap');

  const res = generateTapFile(code, outPath, { filename: 'test', autostart: 10 });
  assert.ok(fs.existsSync(outPath));
  assert.equal(res.autoStartLine, 10);
  assert.ok(res.bytesCount > 0);

  // Clean up
  fs.unlinkSync(outPath);
});


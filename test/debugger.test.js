const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  ROM48_STMT_ADDR,
  decodeSinclairFloat,
  readSpectrumVariables,
  findDocumentLine,
  findStatementRange,
  SinclairBasicDebugAdapterCore,
  decodeSpectrumString
} = require('../src/core/debugger.js');

describe('Sinclair BASIC Debugger Engine', () => {

  it('exports correct ROM48 statement address', () => {
    assert.strictEqual(ROM48_STMT_ADDR, 0x1B3D);
  });

  describe('decodeSinclairFloat', () => {
    it('decodes small integers (short form: 00 sign val_low val_high 00)', () => {
      // 0 = 00 00 00 00 00
      assert.strictEqual(decodeSinclairFloat(0, 0, 0, 0, 0), 0);
      // 42 = 00 00 2A 00 00
      assert.strictEqual(decodeSinclairFloat(0, 0, 42, 0, 0), 42);
      // -100 = 00 FF 64 00 00
      assert.strictEqual(decodeSinclairFloat(0, 0xFF, 100, 0, 0), -100);
      // 1000 = 00 00 E8 03 00
      assert.strictEqual(decodeSinclairFloat(0, 0, 0xE8, 0x03, 0), 1000);
    });

    it('decodes floating-point numbers', () => {
      // 0.5: exp = 127 (0x7F - 128 = -1), mantissa 0 -> 1.0 * 2^(-1) = 0.5
      const half = decodeSinclairFloat(0x7F, 0x00, 0x00, 0x00, 0x00);
      assert.strictEqual(half, 0.5);

      // 1.0: exp = 128 (0x80 - 128 = 0) -> 1.0 * 2^0 = 1.0
      const one = decodeSinclairFloat(0x80, 0x00, 0x00, 0x00, 0x00);
      assert.strictEqual(one, 1.0);

      // 2.0: exp = 129 (0x81 - 128 = 1) -> 1.0 * 2^1 = 2.0
      const two = decodeSinclairFloat(0x81, 0x00, 0x00, 0x00, 0x00);
      assert.strictEqual(two, 2.0);

      // Negative number: bit 7 of byte 1 is set
      const negOne = decodeSinclairFloat(0x80, 0x80, 0x00, 0x00, 0x00);
      assert.strictEqual(negOne, -1.0);
    });
  });

  describe('readSpectrumVariables', () => {
    it('reads numeric and string variables from Spectrum RAM', () => {
      const memory = new Uint8Array(65536);
      memory[0x5C4B] = 0x00;
      memory[0x5C4C] = 0x60; // VARS at 0x6000

      let idx = 0x6000;
      // Single-letter numeric variable 'j' = 7
      // 'j' = letter 10 -> type 3: (3 << 5) | 10 = 0x6A
      memory[idx++] = 0x6A;
      memory[idx++] = 0x00; // int form
      memory[idx++] = 0x00; // positive
      memory[idx++] = 0x07; // 7
      memory[idx++] = 0x00;
      memory[idx++] = 0x00;

      // Multi-letter variable 'score' = 1500
      // 's' = letter 19 -> type 5: (5 << 5) | 19 = 0xB3
      memory[idx++] = 0xB3; // 's'
      memory[idx++] = 99;   // 'c'
      memory[idx++] = 111;  // 'o'
      memory[idx++] = 114;  // 'r'
      memory[idx++] = 101 | 0x80; // 'e' | 0x80 (terminal)
      memory[idx++] = 0x00;
      memory[idx++] = 0x00;
      memory[idx++] = 1500 & 0xFF;
      memory[idx++] = (1500 >> 8) & 0xFF;
      memory[idx++] = 0x00;

      // String variable 'msg$' = "OK"
      // 'm' = letter 13 -> type 2: (2 << 5) | 13 = 0x4D
      memory[idx++] = 0x4D;
      memory[idx++] = 2; // length low
      memory[idx++] = 0; // length high
      memory[idx++] = 79; // 'O'
      memory[idx++] = 75; // 'K'

      // End of variables marker
      memory[idx++] = 0x80;

      const vars = readSpectrumVariables((addr) => memory[addr]);
      assert.strictEqual(vars.length, 3);
      assert.deepStrictEqual(vars[0], { name: 'j', type: 'number', value: 7 });
      assert.deepStrictEqual(vars[1], { name: 'score', type: 'number', value: 1500 });
      assert.deepStrictEqual(vars[2], { name: 'm$', type: 'string', value: 'OK', length: 2, rawBytes: [79, 75] });
    });

    it('returns empty array when VARS is empty (starts with 0x80)', () => {
      const memory = new Uint8Array(65536);
      memory[0x5C4B] = 0x00;
      memory[0x5C4C] = 0x60;
      memory[0x6000] = 0x80;

      const vars = readSpectrumVariables((addr) => memory[addr]);
      assert.deepStrictEqual(vars, []);
    });
  });

  describe('decodeSpectrumString', () => {
    it('decodes raw bytes into Sinclair BASIC {CODE n} wildcards (e.g. y$ in Dino BASIC)', () => {
      // y$ = [19, 17, 16, 16, 17, 19, 20]
      const yBytes = [19, 17, 16, 16, 17, 19, 20];
      assert.strictEqual(
        decodeSpectrumString(yBytes),
        '{CODE 19}{CODE 17}{CODE 16}{CODE 16}{CODE 17}{CODE 19}{CODE 20}'
      );
    });

    it('decodes control codes: PAPER, INK, FLASH, AT, and UDGs', () => {
      // {PAPER 4} {PAPER 1} 
      const cBytes = [17, 4, 32, 17, 1, 32];
      assert.strictEqual(decodeSpectrumString(cBytes), '{PAPER 4} {PAPER 1} ');

      // {PAPER 3}{INK 2}{FLASH 1}
      const pBytes = [17, 3, 16, 2, 18, 1];
      assert.strictEqual(decodeSpectrumString(pBytes), '{PAPER 3}{INK 2}{FLASH 1}');

      // {AT 10,20}
      const atBytes = [22, 10, 20];
      assert.strictEqual(decodeSpectrumString(atBytes), '{AT 10,20}');

      // UDG {A} and {U}
      assert.strictEqual(decodeSpectrumString([144, 164]), '{A}{U}');
    });

    it('handles regular text with quotes and backslashes', () => {
      const textBytes = [72, 79, 76, 65]; // "HOLA"
      assert.strictEqual(decodeSpectrumString(textBytes), 'HOLA');

      const quoteBytes = [34]; // quote
      assert.strictEqual(decodeSpectrumString(quoteBytes), '\\"');
    });
  });

  describe('findDocumentLine', () => {
    const sampleDoc = [
      '1 GO TO 74',
      '2 IF PEEK 23560 THEN POKE 23560,0',
      '74 LET py=0: LET oldpy=0',
      '75 LET y$="ABC"',
      '100 STOP'
    ].join('\n');

    it('finds existing line numbers in document', () => {
      assert.strictEqual(findDocumentLine(sampleDoc, 1), 0);
      assert.strictEqual(findDocumentLine(sampleDoc, 2), 1);
      assert.strictEqual(findDocumentLine(sampleDoc, 74), 2);
      assert.strictEqual(findDocumentLine(sampleDoc, 75), 3);
      assert.strictEqual(findDocumentLine(sampleDoc, 100), 4);
    });

    it('returns -1 for non-existent line numbers', () => {
      assert.strictEqual(findDocumentLine(sampleDoc, 50), -1);
      assert.strictEqual(findDocumentLine(sampleDoc, 999), -1);
    });
  });

  describe('findStatementRange', () => {
    it('finds statement ranges on multi-statement lines', () => {
      const line = '74 LET py=0: LET oldpy=0: LET sc=0';
      const s1 = findStatementRange(line, 1);
      assert.strictEqual(line.slice(s1.startCol, s1.endCol), 'LET py=0');

      const s2 = findStatementRange(line, 2);
      assert.strictEqual(line.slice(s2.startCol, s2.endCol), 'LET oldpy=0');

      const s3 = findStatementRange(line, 3);
      assert.strictEqual(line.slice(s3.startCol, s3.endCol), 'LET sc=0');
    });

    it('ignores colons inside string literals and REM comments', () => {
      const line = '10 PRINT "A:B:C": REM this:is:ignored';
      const s1 = findStatementRange(line, 1);
      assert.strictEqual(line.slice(s1.startCol, s1.endCol), 'PRINT "A:B:C"');

      const s2 = findStatementRange(line, 2);
      assert.strictEqual(line.slice(s2.startCol, s2.endCol), 'REM this:is:ignored');
    });
  });

  describe('SinclairBasicDebugAdapterCore', () => {
    it('handles initialize, launch, and configurationDone', () => {
      const events = [];
      const responses = [];
      const actions = [];

      const adapter = new SinclairBasicDebugAdapterCore({
        sendEvent: (e, b) => events.push({ event: e, body: b }),
        sendResponse: (r) => responses.push(r),
        onAction: (a, d) => actions.push({ action: a, data: d })
      });

      adapter.handleMessage({ seq: 1, type: 'request', command: 'initialize', arguments: {} });
      assert.strictEqual(responses.length, 1);
      assert.strictEqual(responses[0].success, true);
      assert.strictEqual(responses[0].body.supportsConfigurationDoneRequest, true);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event, 'initialized');

      adapter.handleMessage({ seq: 2, type: 'request', command: 'launch', arguments: { program: '/test/game.bas' } });
      assert.strictEqual(responses.length, 2);
      assert.strictEqual(actions[0].action, 'launch');
      assert.strictEqual(actions[0].data.program, '/test/game.bas');

      adapter.handleMessage({ seq: 3, type: 'request', command: 'configurationDone', arguments: {} });
      assert.strictEqual(responses.length, 3);
      assert.strictEqual(actions[1].action, 'configurationDone');
    });

    it('resolves breakpoints against BASIC document lines', () => {
      const actions = [];
      const responses = [];
      const adapter = new SinclairBasicDebugAdapterCore({
        sendEvent: () => {},
        sendResponse: (r) => responses.push(r),
        onAction: (a, d) => actions.push({ action: a, data: d })
      });

      adapter.setDocument('/test/game.bas', '10 LET a=1\n20 LET b=2\n30 PRINT a+b');
      adapter.handleMessage({
        seq: 1,
        type: 'request',
        command: 'setBreakpoints',
        arguments: {
          source: { path: '/test/game.bas' },
          breakpoints: [{ line: 2 }] // document line 2 is '20 LET b=2'
        }
      });

      assert.strictEqual(responses[0].success, true);
      assert.strictEqual(actions[0].action, 'setBreakpoints');
      assert.deepStrictEqual(actions[0].data.lines, [20]);
    });

    it('handles pause notification, stackTrace, scopes, and variables', () => {
      const events = [];
      const responses = [];
      const adapter = new SinclairBasicDebugAdapterCore({
        sendEvent: (e, b) => events.push({ event: e, body: b }),
        sendResponse: (r) => responses.push(r)
      });

      adapter.setDocument('/test/game.bas', '10 LET a=1\n20 LET b=2: PRINT "HI"\n30 PRINT a+b');

      // Notify paused at line 20, stmt 2
      adapter.notifyPaused(20, 2, [
        { name: 'a', type: 'number', value: 1 },
        { name: 'msg$', type: 'string', value: 'ZX' }
      ]);

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event, 'stopped');
      assert.strictEqual(events[0].body.threadId, 1);

      // Request threads
      adapter.handleMessage({ seq: 10, type: 'request', command: 'threads', arguments: {} });
      assert.strictEqual(responses[0].body.threads[0].id, 1);

      // Request stack trace
      adapter.handleMessage({ seq: 11, type: 'request', command: 'stackTrace', arguments: { threadId: 1 } });
      const frames = responses[1].body.stackFrames;
      assert.strictEqual(frames.length, 1);
      assert.strictEqual(frames[0].line, 2); // 1-indexed doc line
      assert.strictEqual(frames[0].name, 'Línea 20 [Sentencia 2]');

      // Request scopes
      adapter.handleMessage({ seq: 12, type: 'request', command: 'scopes', arguments: { frameId: 1 } });
      assert.strictEqual(responses[2].body.scopes[0].name, 'Variables en RAM (VARS)');

      // Request variables
      adapter.handleMessage({ seq: 13, type: 'request', command: 'variables', arguments: { variablesReference: 1000 } });
      const vars = responses[3].body.variables;
      assert.strictEqual(vars.length, 2);
      assert.strictEqual(vars[0].name, 'a');
      assert.strictEqual(vars[0].value, '1');
      assert.strictEqual(vars[1].value, '"ZX"');
    });

    it('expands string variables with byte-by-byte CODE inspection in DAP variables request', () => {
      const responses = [];
      const adapter = new SinclairBasicDebugAdapterCore({
        sendEvent: () => {},
        sendResponse: (r) => responses.push(r)
      });

      // Variable y$ has rawBytes for Dino BASIC jump heights
      adapter.notifyPaused(10, 1, [
        {
          name: 'y$',
          type: 'string',
          value: '{CODE 19}{CODE 17}{CODE 16}{CODE 16}{CODE 17}{CODE 19}{CODE 20}',
          rawBytes: [19, 17, 16, 16, 17, 19, 20]
        }
      ]);

      // Top-level variables (variablesReference = 1000)
      adapter.handleMessage({ seq: 1, type: 'request', command: 'variables', arguments: { variablesReference: 1000 } });
      const topVars = responses[0].body.variables;
      assert.strictEqual(topVars[0].name, 'y$');
      assert.strictEqual(topVars[0].value, '"{CODE 19}{CODE 17}{CODE 16}{CODE 16}{CODE 17}{CODE 19}{CODE 20}"');
      assert.strictEqual(topVars[0].variablesReference, 2000); // Expandable!

      // Child expansion (variablesReference = 2000)
      adapter.handleMessage({ seq: 2, type: 'request', command: 'variables', arguments: { variablesReference: 2000 } });
      const childVars = responses[1].body.variables;
      assert.strictEqual(childVars.length, 7);
      assert.strictEqual(childVars[0].name, '(1)');
      assert.strictEqual(childVars[0].value, '19  {CODE 19}');
      assert.strictEqual(childVars[6].name, '(7)');
      assert.strictEqual(childVars[6].value, '20  {CODE 20}');
    });

    it('dispatches debugger actions: continue, next, stepIn, pause, disconnect', () => {
      const actions = [];
      const adapter = new SinclairBasicDebugAdapterCore({
        sendEvent: () => {},
        sendResponse: () => {},
        onAction: (a, d) => actions.push(a)
      });

      adapter.handleMessage({ seq: 1, type: 'request', command: 'continue', arguments: {} });
      adapter.handleMessage({ seq: 2, type: 'request', command: 'next', arguments: {} });
      adapter.handleMessage({ seq: 3, type: 'request', command: 'stepIn', arguments: {} });
      adapter.handleMessage({ seq: 4, type: 'request', command: 'pause', arguments: {} });
      adapter.handleMessage({ seq: 5, type: 'request', command: 'disconnect', arguments: {} });

      assert.deepStrictEqual(actions, ['continue', 'stepLine', 'stepStmt', 'pause', 'stop']);
    });
  });

});


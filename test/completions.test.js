const test = require('node:test');
const assert = require('node:assert/strict');
const { createSinclairCompletionProvider } = require('../src/core/completions.js');

// Minimal vscode mock for testing completion provider
const mockVscode = {
  CompletionItemKind: {
    Keyword: 13,
    Function: 2,
    Operator: 24,
    Color: 15,
    Snippet: 14,
    Property: 9,
    Reference: 17
  },
  CompletionItem: class {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  },
  MarkdownString: class {
    constructor(val = '') {
      this.value = val;
    }
    appendCodeblock(code, lang) {
      this.value += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }
    appendMarkdown(md) {
      this.value += md;
    }
  },
  SnippetString: class {
    constructor(val) {
      this.value = val;
    }
  }
};

function createMockDoc(lines, languageId = 'sinclair-basic') {
  return {
    languageId,
    fileName: languageId === 'jbas' ? 'test.jbas' : 'test.bas',
    lineCount: lines.length,
    lineAt(idx) {
      return { text: lines[idx] };
    }
  };
}

test('completion provider returns keywords and snippets outside strings and comments', () => {
  const provider = createSinclairCompletionProvider(mockVscode);
  const doc = createMockDoc(['10 PR']);
  const items = provider.provideCompletionItems(doc, { line: 0, character: 5 });

  assert.ok(Array.isArray(items));
  assert.ok(items.length > 50);

  const printItem = items.find(item => item.label === 'PRINT');
  assert.ok(printItem);
  assert.equal(printItem.kind, mockVscode.CompletionItemKind.Keyword);

  const forSnippet = items.find(item => item.label === 'FOR (Snippet)');
  assert.ok(forSnippet);
  assert.equal(forSnippet.kind, mockVscode.CompletionItemKind.Snippet);
});

test('completion provider returns null inside string literal unless inside control code', () => {
  const provider = createSinclairCompletionProvider(mockVscode);
  const doc = createMockDoc(['10 PRINT "hello world']);
  const items = provider.provideCompletionItems(doc, { line: 0, character: 15 });
  assert.equal(items, null);
});

test('completion provider returns control codes inside string literal with {', () => {
  const provider = createSinclairCompletionProvider(mockVscode);
  const doc = createMockDoc(['10 PRINT "{']);
  const items = provider.provideCompletionItems(doc, { line: 0, character: 11 });

  assert.ok(Array.isArray(items));
  const inkItem = items.find(item => item.label === 'INK');
  assert.ok(inkItem);
  assert.equal(inkItem.kind, mockVscode.CompletionItemKind.Property);
});

test('completion provider returns null inside REM comment', () => {
  const provider = createSinclairCompletionProvider(mockVscode);
  const doc = createMockDoc(['10 REM this is a test ']);
  const items = provider.provideCompletionItems(doc, { line: 0, character: 20 });
  assert.equal(items, null);
});

test('completion provider returns null inside .jbas single-quote comment', () => {
  const provider = createSinclairCompletionProvider(mockVscode);
  const doc = createMockDoc(['LET a = 1 \' testing '], 'jbas');
  const items = provider.provideCompletionItems(doc, { line: 0, character: 18 });
  assert.equal(items, null);
});

test('completion provider returns labels when typing @ in .jbas', () => {
  const provider = createSinclairCompletionProvider(mockVscode);
  const doc = createMockDoc([
    '@start:',
    '  LET x = 10',
    '@game_loop:',
    '  GOTO @'
  ], 'jbas');

  const items = provider.provideCompletionItems(doc, { line: 3, character: 8 });
  assert.ok(Array.isArray(items));
  assert.equal(items.length, 2);
  assert.equal(items[0].label, '@start');
  assert.equal(items[1].label, '@game_loop');
});

/**
 * Sinclair BASIC Autocompletion Provider
 * Provides context-aware completions for Sinclair BASIC keywords, statements,
 * functions, screen attributes, control codes, and JBAS jump labels.
 */

const { KEYWORDS_LIST, CONTROL_CODES_LIST } = require('./keywords');

/**
 * Creates a CompletionItemProvider for VS Code using the provided vscode API object.
 * @param {typeof import('vscode')} vscode 
 * @returns {import('vscode').CompletionItemProvider}
 */
function createSinclairCompletionProvider(vscode) {
  // Pre-build keyword completion items
  const keywordCompletionItems = KEYWORDS_LIST.map(kw => {
    let kind = vscode.CompletionItemKind.Keyword;
    if (kw.kind === 'function') kind = vscode.CompletionItemKind.Function;
    else if (kw.kind === 'operator') kind = vscode.CompletionItemKind.Operator;
    else if (kw.kind === 'attribute') kind = vscode.CompletionItemKind.Color;

    const item = new vscode.CompletionItem(kw.name, kind);
    item.detail = kw.syntax;
    const doc = new vscode.MarkdownString();
    doc.appendCodeblock(kw.syntax, 'sinclair-basic');
    doc.appendMarkdown(kw.description);
    item.documentation = doc;
    item.insertText = kw.name;
    return item;
  });

  // Pre-build snippet items for common constructs
  const snippetItems = KEYWORDS_LIST
    .filter(kw => kw.snippet && kw.snippet !== kw.name)
    .map(kw => {
      const item = new vscode.CompletionItem(kw.name + ' (Snippet)', vscode.CompletionItemKind.Snippet);
      item.detail = kw.syntax;
      const doc = new vscode.MarkdownString();
      doc.appendCodeblock(kw.snippet, 'sinclair-basic');
      doc.appendMarkdown(`*${kw.description}*`);
      item.documentation = doc;
      item.insertText = new vscode.SnippetString(kw.snippet);
      return item;
    });

  // Pre-build control code completion items (inside string literal "{...}")
  const controlCodeItems = CONTROL_CODES_LIST.map(cc => {
    const item = new vscode.CompletionItem(cc.name, vscode.CompletionItemKind.Property);
    item.detail = cc.syntax;
    item.documentation = new vscode.MarkdownString(
      `Control code for bas2tap / tapGenerator:\n\n\`${cc.syntax}\`\n\n${cc.description}`
    );
    item.insertText = cc.name + ' ';
    return item;
  });

  return {
    provideCompletionItems(document, position) {
      const lineText = document.lineAt(position.line).text;
      const prefix = lineText.slice(0, position.character);

      // Check if cursor is inside a string literal
      let inString = false;
      for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] === '"') inString = !inString;
      }

      const isJBas = document.languageId === 'jbas' || document.fileName.endsWith('.jbas');

      // Check if cursor is inside a REM comment or .jbas single-quote comment
      if (!inString) {
        if (/\bREM\b/i.test(prefix)) {
          return null; // Inside REM comment: do not suggest keywords
        }
        if (isJBas && prefix.includes("'")) {
          return null; // Inside JBAS comment: do not suggest keywords
        }
      }

      // If inside string literal, only offer control codes if inside { ... }
      if (inString) {
        const lastOpen = prefix.lastIndexOf('{');
        const lastClose = prefix.lastIndexOf('}');
        if (lastOpen > lastClose) {
          return controlCodeItems;
        }
        return null;
      }

      // If in JBAS and typing @ (or after @), suggest document labels
      if (isJBas && /@[a-zA-Z0-9_]*$/.test(prefix)) {
        const labelItems = [];
        const labelRegex = /^\s*@([a-zA-Z0-9_]+)\s*:/;
        for (let i = 0; i < document.lineCount; i++) {
          const m = document.lineAt(i).text.match(labelRegex);
          if (m) {
            const labelName = m[1];
            const item = new vscode.CompletionItem('@' + labelName, vscode.CompletionItemKind.Reference);
            item.detail = `Jump target defined on line ${i + 1}`;
            item.documentation = new vscode.MarkdownString(`Label target: \`@${labelName}:\`\n\nDefined on line ${i + 1}`);
            item.filterText = '@' + labelName;
            labelItems.push(item);
          }
        }
        return labelItems;
      }

      // Return all Sinclair BASIC keywords and snippets
      return [...keywordCompletionItems, ...snippetItems];
    }
  };
}

module.exports = {
  createSinclairCompletionProvider
};

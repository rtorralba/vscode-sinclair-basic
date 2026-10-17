/**
 * Sinclair BASIC (Unofficial) - VS Code Extension Entry Point
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { renumberProgram } = require('./core/renumber');
const { compileJBas } = require('./core/jbas2bas');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Command: Renumber Lines
  const renumberDisposable = vscode.commands.registerCommand('sinclairBasic.renumber', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor found.');
      return;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const defaultStart = config.get('renumberStart', 10);
    const defaultStep = config.get('renumberStep', 10);

    const doc = editor.document;
    const fullText = doc.getText();

    try {
      const result = renumberProgram(fullText, { start: defaultStart, step: defaultStep });

      if (!result.success) {
        vscode.window.showErrorMessage('Sinclair BASIC Renumber failed: Program has no valid statements.');
        return;
      }

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(fullText.length)
      );

      await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, result.text);
      });

      if (result.warnings && result.warnings.length > 0) {
        vscode.window.showWarningMessage(
          `Renumbered ${result.linesCount} lines with ${result.warnings.length} warning(s). Check output for details.`
        );
      } else {
        vscode.window.showInformationMessage(`Successfully renumbered ${result.linesCount} lines (start ${defaultStart}, step ${defaultStep}).`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Renumber error: ${err.message}`);
    }
  });

  // Command: Compile .jbas to standard .bas
  const compileDisposable = vscode.commands.registerCommand('sinclairBasic.compileJBas', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor found.');
      return;
    }

    const doc = editor.document;
    const filePath = doc.fileName;

    if (!filePath.endsWith('.jbas')) {
      vscode.window.showWarningMessage('Current file is not a .jbas file.');
      return;
    }

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const defaultStart = config.get('renumberStart', 10);
    const defaultStep = config.get('renumberStep', 10);
    const outDirName = config.get('outputDirectory', 'dist');

    const sourceText = doc.getText();
    const result = compileJBas(sourceText, { start: defaultStart, step: defaultStep });

    if (!result.success) {
      const errorMsg = result.errors.join('\n');
      vscode.window.showErrorMessage(`Compilation failed:\n${errorMsg}`);
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const rootDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
    const distDir = path.isAbsolute(outDirName) ? outDirName : path.join(rootDir, outDirName);

    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    const baseName = path.basename(filePath, '.jbas');
    const targetBasPath = path.join(distDir, `${baseName}.bas`);

    fs.writeFileSync(targetBasPath, result.text, 'utf-8');

    const openDoc = await vscode.workspace.openTextDocument(targetBasPath);
    await vscode.window.showTextDocument(openDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

    vscode.window.showInformationMessage(`Compiled ${result.linesCount} lines to ${path.basename(targetBasPath)}`);
  });

  // Helper: Get or compile .bas for current file
  async function prepareBasFile(editor) {
    const doc = editor.document;
    const filePath = doc.fileName;
    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const outDirName = config.get('outputDirectory', 'dist');
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const rootDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
    const distDir = path.isAbsolute(outDirName) ? outDirName : path.join(rootDir, outDirName);

    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    if (filePath.endsWith('.jbas')) {
      const defaultStart = config.get('renumberStart', 10);
      const defaultStep = config.get('renumberStep', 10);
      const result = compileJBas(doc.getText(), { start: defaultStart, step: defaultStep });

      if (!result.success) {
        throw new Error('Compilation failed: ' + result.errors.join('; '));
      }

      const baseName = path.basename(filePath, '.jbas');
      const targetBas = path.join(distDir, `${baseName}.bas`);
      fs.writeFileSync(targetBas, result.text, 'utf-8');
      return targetBas;
    }

    return filePath;
  }

  // Command: Build TAP File
  const buildTapDisposable = vscode.commands.registerCommand('sinclairBasic.buildTap', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor found.');
      return null;
    }

    try {
      const basPath = await prepareBasFile(editor);
      const config = vscode.workspace.getConfiguration('sinclairBasic');
      const bas2tapPath = config.get('bas2tapPath', 'bas2tap');
      const configuredAutoStart = config.get('autoStartLine', 0);

      let autoStartLine = configuredAutoStart;
      if (autoStartLine <= 0) {
        const basContent = fs.readFileSync(basPath, 'utf-8');
        const match = basContent.match(/^\s*(\d+)/m);
        autoStartLine = match ? parseInt(match[1], 10) : 10;
      }

      const baseName = path.basename(basPath, path.extname(basPath));
      const distDir = path.dirname(basPath);
      const tapPath = path.join(distDir, `${baseName}.tap`);

      const args = [`-a${autoStartLine}`, basPath, tapPath];

      await new Promise((resolve, reject) => {
        execFile(bas2tapPath, args, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || stdout || error.message));
          } else {
            resolve(stdout);
          }
        });
      });

      vscode.window.showInformationMessage(`Successfully built TAP: ${path.basename(tapPath)} (Autostart line ${autoStartLine})`);
      return tapPath;
    } catch (err) {
      vscode.window.showErrorMessage(`Build TAP error: ${err.message}`);
      return null;
    }
  });

  // Command: Run in Emulator
  const runEmulatorDisposable = vscode.commands.registerCommand('sinclairBasic.runEmulator', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor found.');
      return;
    }

    const tapPath = await vscode.commands.executeCommand('sinclairBasic.buildTap');
    if (!tapPath) return;

    const config = vscode.workspace.getConfiguration('sinclairBasic');
    const emulatorPath = config.get('emulatorPath', 'fuse');
    const emulatorArgs = config.get('emulatorArgs', []);

    const allArgs = [...emulatorArgs, tapPath];

    execFile(emulatorPath, allArgs, (error) => {
      if (error && error.code !== 0) {
        vscode.window.showErrorMessage(`Failed to launch emulator (${emulatorPath}): ${error.message}`);
      }
    });
  });

  context.subscriptions.push(renumberDisposable, compileDisposable, buildTapDisposable, runEmulatorDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};

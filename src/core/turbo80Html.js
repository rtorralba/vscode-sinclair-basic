/**
 * Sinclair BASIC - Turbo80 Webview HTML Generator
 * Generates the complete HTML document for the Turbo80 ZX Spectrum web emulator
 * with embedded offline runtime, styling, and step-by-step Sinclair BASIC debugger.
 */

function getTurbo80Html(webview, extensionUri, vscode) {
  const turbo80CoreUri = (webview && extensionUri && vscode)
    ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'turbo80', 'turbo80-core.js'))
    : '';
  const turbo80Uri = (webview && extensionUri && vscode)
    ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'turbo80', 'turbo80.js'))
    : '';
  const cspSource = (webview && webview.cspSource) ? webview.cspSource : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline' 'unsafe-eval' ${cspSource} https://turbo80.com;
    frame-src https://turbo80.com;
    style-src 'unsafe-inline' ${cspSource};
    img-src https: data: ${cspSource};
    font-src ${cspSource} data:;
    connect-src https://turbo80.com ${cspSource} data: blob:;
  ">
  <title>Turbo80 - ZX Spectrum</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0c0c11;
      color: #e9e9f2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    #emulator-wrap {
      flex: 1;
      min-height: 0;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow-y: auto;
      overflow-x: hidden;
    }
    #spectrum {
      width: 100% !important;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    #spectrum iframe {
      border: 0;
      width: 100% !important;
      height: auto !important;
      aspect-ratio: 4 / 3 !important;
      max-width: 100vw;
    }
    #footer {
      height: 34px;
      background: #14141e;
      border-top: 1px solid #28283a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.2rem;
      font-size: 12px;
      color: #9b9bb0;
      user-select: none;
      flex-shrink: 0;
    }
    #footer a {
      color: #37d0ff;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s ease;
    }
    #footer a:hover {
      color: #57ef9e;
      text-decoration: underline;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      font-size: 12px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #57ef9e;
      box-shadow: 0 0 8px rgba(87, 239, 158, 0.7);
    }
    .attribution {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
    }
  </style>
</head>
<body>
  <div id="emulator-wrap">
    <div id="spectrum" style="width: 100%;"></div>
  </div>
  <footer id="footer">
    <div class="status-badge">
      <span class="status-dot"></span>
      <span id="game-title">Iniciando ZX Spectrum...</span>
    </div>
    <div class="attribution">
      Emulado con <a href="https://turbo80.com" target="_blank" rel="noopener">Turbo80</a> &bull; Emulador de ZX Spectrum por Jos&eacute; Enrique Garc&iacute;a (Incinerator)
    </div>
  </footer>

  <script src="${turbo80CoreUri}"></script>
  <script src="${turbo80Uri}"></script>
  <script>
    if (typeof Turbo80 === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://turbo80.com/turbo80.js';
      document.head.appendChild(s);
    }
  </script>
  <script>
    const vscode = acquireVsCodeApi();
    let emulator = null;
    let pendingData = null;

    function adjustEmulatorSizing() {
      const spectrum = document.getElementById('spectrum');
      if (!spectrum) return;
      const shadow = spectrum.shadowRoot;
      if (shadow && !shadow.getElementById('t80-responsive-size')) {
        const style = document.createElement('style');
        style.id = 't80-responsive-size';
        style.textContent = [
          ':host { width: 100% !important; max-width: 100% !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; }',
          '.t80-body { width: 100% !important; max-width: 100% !important; min-height: 0 !important; height: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; background: transparent !important; }',
          'main { width: 100% !important; max-width: 100% !important; min-height: 0 !important; height: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; margin: 0 !important; padding: 0 !important; }',
          '.screen-zone { width: 100% !important; max-width: 100% !important; height: auto !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; gap: 0 !important; }',
          '.bezel { width: 100% !important; max-width: 100% !important; height: auto !important; margin: 0 !important; padding: 0 !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; }',
          '.screen-wrap { width: 100% !important; max-width: 100% !important; height: auto !important; aspect-ratio: 4 / 3 !important; margin: 0 auto !important; }',
          '#screen { width: 100% !important; max-width: 100% !important; height: auto !important; aspect-ratio: 4 / 3 !important; display: block !important; }',
          '#crt-gl { width: 100% !important; height: 100% !important; }'
        ].join('\\n');
        shadow.appendChild(style);
      }
    }

    function focusEmulator() {
      try {
        if (emulator && typeof emulator.focus === 'function') {
          emulator.focus();
        }
      } catch (e) {}
      try {
        const shadow = (document.querySelector('#spectrum') && document.querySelector('#spectrum').shadowRoot) || (emulator && emulator.shadow);
        const screen = shadow ? (shadow.getElementById('screen') || shadow.querySelector('canvas')) : document.querySelector('#spectrum canvas');
        if (screen) {
          if (!screen.hasAttribute('tabindex')) {
            screen.setAttribute('tabindex', '0');
          }
          screen.focus();
        }
      } catch (e) {}
      try {
        const iframe = document.querySelector('#spectrum iframe') || (emulator && emulator.iframe);
        if (iframe) {
          if (!iframe.hasAttribute('tabindex')) {
            iframe.setAttribute('tabindex', '0');
          }
          iframe.focus();
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
          }
          if (typeof iframe.click === 'function') {
            iframe.click();
          }
        }
      } catch (e) {}
    }

    function attachIframeListeners() {
      try {
        const iframe = document.querySelector('#spectrum iframe') || (emulator && emulator.iframe);
        if (iframe && !iframe._hasLoadedListener) {
          iframe._hasLoadedListener = true;
          iframe.addEventListener('load', () => {
            scheduleFocus();
          });
        }
      } catch (e) {}
    }

    function scheduleFocus() {
      adjustEmulatorSizing();
      focusEmulator();
      attachIframeListeners();
      [50, 150, 300, 500, 800, 1200, 1800].forEach(delay => {
        setTimeout(() => {
          adjustEmulatorSizing();
          focusEmulator();
        }, delay);
      });
    }

    function applyTap(data) {
      try {
        const binaryString = atob(data.base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const currentModel = data.model || '48k';
        document.getElementById('game-title').textContent = (data.filename || 'game.tap') + ' (' + currentModel.toUpperCase() + ')';

        if (typeof Turbo80 === 'undefined') {
          document.getElementById('game-title').textContent = 'Error cargando Turbo80 (comprueba tu conexi\u00f3n a internet)';
          return;
        }

        if (!emulator) {
          emulator = Turbo80(document.getElementById('spectrum'), {
            load: bytes,
            name: data.filename || 'game.tap',
            model: currentModel,
            crt: data.crt ? 'on' : 'off',
            width: '100%'
          });
          if (emulator && typeof emulator.on === 'function') {
            emulator.on('ready', () => {
              adjustEmulatorSizing();
              scheduleFocus();
            });
            emulator.on('loaded', () => {
              adjustEmulatorSizing();
              scheduleFocus();
            });
          }
          attachIframeListeners();
        } else {
          const doLoad = () => emulator.load(bytes, data.filename || 'game.tap');
          if (emulator.setModel) {
            Promise.resolve(emulator.setModel(currentModel))
              .then(() => {
                if (emulator.reset) emulator.reset();
                return doLoad();
              })
              .then(() => {
                adjustEmulatorSizing();
                scheduleFocus();
              })
              .catch(() => {
                doLoad();
                adjustEmulatorSizing();
                scheduleFocus();
              });
          } else {
            doLoad();
            adjustEmulatorSizing();
            scheduleFocus();
          }
        }
        adjustEmulatorSizing();
        scheduleFocus();
      } catch (err) {
        console.error('Error loading TAP into Turbo80:', err);
        document.getElementById('game-title').textContent = 'Error al cargar TAP: ' + err.message;
      }
    }

    function decodeSinclairFloat(b0, b1, b2, b3, b4) {
      if (b0 === 0) {
        const sign = (b1 === 0xFF) ? -1 : 1;
        const val = (b2 & 0xFF) | ((b3 & 0xFF) << 8);
        return sign * val;
      }
      const exp = b0 - 128;
      const mant = (((b1 & 0x7F) | 0x80) * 0x1000000) +
                   ((b2 & 0xFF) * 0x10000) +
                   ((b3 & 0xFF) * 0x100) +
                   (b4 & 0xFF);
      let val = mant * Math.pow(2, exp - 31);
      if (b1 & 0x80) val = -val;
      return Math.round(val * 1000000) / 1000000;
    }

    function readSpectrumVariables(readByte) {
      const varsStart = (readByte(0x5C4B) & 0xFF) | ((readByte(0x5C4C) & 0xFF) << 8);
      const vars = [];
      let p = varsStart;
      const maxAddr = 0xFF00;

      while (p < maxAddr) {
        const b = readByte(p);
        if (b === 0x80 || b === 0xFF || b === 0) break;

        const type = (b >> 5) & 7;
        const letterCode = b & 0x1F;

        if (type === 3) {
          const name = String.fromCharCode(96 + letterCode);
          const val = decodeSinclairFloat(
            readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4), readByte(p + 5)
          );
          vars.push({ name, type: 'number', value: val });
          p += 6;
        } else if (type === 5) {
          let name = String.fromCharCode(96 + letterCode);
          p++;
          while (p < maxAddr) {
            const c = readByte(p);
            name += String.fromCharCode(c & 0x7F);
            p++;
            if (c & 0x80) break;
          }
          const val = decodeSinclairFloat(
            readByte(p), readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4)
          );
          vars.push({ name, type: 'number', value: val });
          p += 5;
        } else if (type === 2) {
          const name = String.fromCharCode(96 + letterCode) + '$';
          const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
          let str = '';
          for (let i = 0; i < len; i++) {
            const ch = readByte(p + 3 + i);
            if (ch >= 32 && ch <= 126) {
              str += String.fromCharCode(ch);
            } else {
              str += String.fromCharCode(92) + 'x' + ch.toString(16).padStart(2, '0').toUpperCase();
            }
          }
          vars.push({ name, type: 'string', value: str, length: len });
          p += 3 + len;
        } else if (type === 7) {
          const name = String.fromCharCode(96 + letterCode);
          const val = decodeSinclairFloat(
            readByte(p + 1), readByte(p + 2), readByte(p + 3), readByte(p + 4), readByte(p + 5)
          );
          vars.push({ name, type: 'for', value: val });
          p += 19;
        } else if (type === 4 || type === 6) {
          const isString = (type === 6);
          const name = String.fromCharCode(96 + letterCode) + (isString ? '$' : '');
          const len = (readByte(p + 1) & 0xFF) | ((readByte(p + 2) & 0xFF) << 8);
          vars.push({ name, type: isString ? 'string-array' : 'number-array', length: len });
          p += 3 + len;
        } else {
          break;
        }
      }
      return vars;
    }

    const basicDebugger = {
      enabled: false,
      attached: false,
      breakpoints: new Set(),
      stepMode: null,
      pauseRequested: false,
      lastLine: null,
      lastStmt: null,
      lastPausedLine: null,
      lastPausedStmt: null,
      vars: [],

      attach(sp) {
        if (!sp || this.attached) return;
        this.attached = true;
        if (!sp.breakpoints) sp.breakpoints = new Set();
        sp.breakpoints.add(0x1B3D);
        if (!sp.bpConds) sp.bpConds = new Map();

        sp.bpConds.set(0x1B3D, (cpu, spectrum) => {
          if (!this.enabled) return false;

          const line = spectrum.memory.read(0x5C45) | (spectrum.memory.read(0x5C46) << 8);
          const stmt = spectrum.memory.read(0x5C47);

          if (line >= 0x8000) return false;

          if (this.stepMode === 'stmt') {
            if (line !== this.lastLine || stmt !== this.lastStmt) {
              this.stepMode = null;
              this.onBreakHit(line, stmt, spectrum);
              return true;
            }
            return false;
          }

          if (this.stepMode === 'line') {
            if (line !== this.lastLine) {
              this.stepMode = null;
              this.onBreakHit(line, stmt, spectrum);
              return true;
            }
            return false;
          }

          if (this.pauseRequested) {
            this.pauseRequested = false;
            this.onBreakHit(line, stmt, spectrum);
            return true;
          }

          if (this.breakpoints.has(line)) {
            if (line === this.lastPausedLine && stmt === this.lastPausedStmt) {
              return false;
            }
            this.onBreakHit(line, stmt, spectrum);
            return true;
          }

          return false;
        });
      },

      onBreakHit(line, stmt, spectrum) {
        this.lastPausedLine = line;
        this.lastPausedStmt = stmt;
        this.vars = readSpectrumVariables(a => spectrum.memory.read(a));

        updateFooterStatus('paused', line, stmt);
        vscode.postMessage({
          command: 'basicPaused',
          line: line,
          stmt: stmt,
          vars: this.vars
        });
      }
    };

    function updateFooterStatus(status, line, stmt) {
      const title = document.getElementById('game-title');
      const dot = document.querySelector('.status-dot');
      if (!title) return;

      if (!basicDebugger.enabled) {
        if (dot) {
          dot.style.background = '#57ef9e';
          dot.style.boxShadow = '0 0 8px rgba(87, 239, 158, 0.7)';
        }
        return;
      }

      if (status === 'paused') {
        if (dot) {
          dot.style.background = '#ffcc00';
          dot.style.boxShadow = '0 0 8px rgba(255, 204, 0, 0.8)';
        }
        title.textContent = (pendingData && pendingData.filename ? pendingData.filename + ' — ' : '') + 'Pausado (Línea ' + line + ', Sent. ' + stmt + ')';
      } else {
        if (dot) {
          dot.style.background = '#57ef9e';
          dot.style.boxShadow = '0 0 8px rgba(87, 239, 158, 0.7)';
        }
        title.textContent = (pendingData && pendingData.filename) ? pendingData.filename : 'ZX Spectrum';
      }
    }

    function doContinue() {
      if (emulator) {
        basicDebugger.stepMode = null;
        basicDebugger.pauseRequested = false;
        updateFooterStatus('running');
        vscode.postMessage({ command: 'basicResumed' });
        emulator.resume();
      }
    }

    function doPause() {
      basicDebugger.pauseRequested = true;
    }

    function doStepLine() {
      if (emulator) {
        basicDebugger.stepMode = 'line';
        basicDebugger.lastLine = basicDebugger.lastPausedLine;
        updateFooterStatus('running');
        vscode.postMessage({ command: 'basicResumed' });
        emulator.resume();
      }
    }

    function doStepStmt() {
      if (emulator) {
        basicDebugger.stepMode = 'stmt';
        basicDebugger.lastLine = basicDebugger.lastPausedLine;
        basicDebugger.lastStmt = basicDebugger.lastPausedStmt;
        updateFooterStatus('running');
        vscode.postMessage({ command: 'basicResumed' });
        emulator.resume();
      }
    }

    function doRestart() {
      if (pendingData) {
        basicDebugger.pauseRequested = true;
        applyTap(pendingData);
      }
    }

    function doStop() {
      basicDebugger.enabled = false;
      updateFooterStatus('running');
      vscode.postMessage({ command: 'debugStopped' });
      if (emulator) emulator.resume();
    }

    window.addEventListener('keydown', function (e) {
      if (!basicDebugger.enabled) return;
      if (e.key === 'F5') { e.preventDefault(); doContinue(); }
      else if (e.key === 'F6') { e.preventDefault(); doPause(); }
      else if (e.key === 'F10') { e.preventDefault(); doStepLine(); }
      else if (e.key === 'F11') { e.preventDefault(); doStepStmt(); }
    });

    function checkAttach() {
      try {
        const sp = emulator && emulator.main && emulator.main.spectrum;
        if (sp) {
          basicDebugger.attach(sp);
        }
      } catch (e) {}
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'loadTap') {
        pendingData = msg;
        if (msg.debug) {
          basicDebugger.enabled = true;
          if (Array.isArray(msg.breakpoints)) {
            basicDebugger.breakpoints = new Set(msg.breakpoints);
          }
          if (msg.stopOnEntry || basicDebugger.breakpoints.size === 0) {
            basicDebugger.pauseRequested = true;
          }
          updateFooterStatus(basicDebugger.pauseRequested ? 'paused' : 'running', 1, 1);
        } else {
          basicDebugger.enabled = false;
          updateFooterStatus('running');
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          applyTap(msg);
          checkAttach();
          [50, 150, 300, 600, 1200, 2000].forEach(d => setTimeout(checkAttach, d));
        }
      } else if (msg.command === 'setBreakpoints') {
        const bps = Array.isArray(msg.breakpoints) ? msg.breakpoints : (Array.isArray(msg.lines) ? msg.lines : []);
        basicDebugger.breakpoints = new Set(bps);
      } else if (msg.command === 'debugContinue') {
        doContinue();
      } else if (msg.command === 'debugPause') {
        doPause();
      } else if (msg.command === 'debugStepLine') {
        doStepLine();
      } else if (msg.command === 'debugStepStmt') {
        doStepStmt();
      } else if (msg.command === 'debugRestart') {
        doRestart();
      } else if (msg.command === 'debugStop') {
        doStop();
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      adjustEmulatorSizing();
      if (pendingData) {
        applyTap(pendingData);
        checkAttach();
        [50, 150, 300, 600, 1200, 2000].forEach(d => setTimeout(checkAttach, d));
        pendingData = null;
      }
      vscode.postMessage({ command: 'ready' });
    });

    window.addEventListener('resize', adjustEmulatorSizing);
    setInterval(adjustEmulatorSizing, 250);

    window.addEventListener('focus', focusEmulator);
    window.addEventListener('pointerdown', focusEmulator);
    window.addEventListener('click', focusEmulator);
    window.addEventListener('keydown', focusEmulator);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleFocus();
      }
    });
  </script>
</body>
</html>`;
}

module.exports = {
  getTurbo80Html
};

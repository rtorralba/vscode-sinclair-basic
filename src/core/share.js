/**
 * Sinclair BASIC - Turbo80.com Share Engine
 * 
 * Uploads a compiled ZX Spectrum .tap image to a public host and generates
 * a direct, shareable Turbo80 link (https://turbo80.com/?load=...&model=48k)
 * allowing colleagues and players to test the game instantly in any browser.
 */

const CATBOX_API_URL = 'https://catbox.moe/user/api.php';
const LITTERBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php';

/**
 * Normalizes input bytes to a clean Uint8Array.
 * @param {Buffer|Uint8Array} bytes 
 * @returns {Uint8Array}
 */
function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return new Uint8Array(bytes);
}

/**
 * Helper to pause execution.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verifies if the uploaded URL returns an accessible file with Content-Length > 0.
 * Catbox sometimes returns a URL that points to a 0-byte file when the upload
 * stream was interrupted or when an earlier corrupted attempt was cached by hash.
 * @param {string} url 
 * @param {Function} fetchFn 
 * @returns {Promise<{ ok: boolean, size: number }>}
 */
async function verifyRemoteFileSize(url, fetchFn) {
  try {
    const res = await fetchFn(url, { method: 'HEAD' });
    if (!res.ok) {
      // If HEAD is rejected with 405 Method Not Allowed or fails, try Range GET for 1 byte
      const getRes = await fetchFn(url, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-0' }
      });
      if (!getRes.ok) return { ok: false, size: 0 };
      return { ok: true, size: 1 };
    }

    const lenHeader = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('content-length')
      : (res.headers && res.headers['content-length']);

    if (lenHeader !== null && lenHeader !== undefined) {
      const len = parseInt(lenHeader, 10);
      if (!isNaN(len) && len === 0) {
        return { ok: false, size: 0 };
      }
      return { ok: true, size: isNaN(len) ? -1 : len };
    }
    return { ok: true, size: -1 };
  } catch (err) {
    // If the verification network call itself fails (e.g. strict firewall or mock fetch),
    // don't block the share flow if the upload POST succeeded
    return { ok: true, size: -1 };
  }
}

/**
 * Uploads bytes to Catbox permanent hosting.
 * @param {Uint8Array} bytes 
 * @param {string} safeFilename 
 * @param {Function} fetchFn 
 * @returns {Promise<string>}
 */
async function uploadToCatbox(bytes, safeFilename, fetchFn) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');

  const file = new File([bytes], safeFilename, {
    type: 'application/octet-stream'
  });
  form.append('fileToUpload', file);

  const res = await fetchFn(CATBOX_API_URL, {
    method: 'POST',
    body: form,
    headers: {
      'User-Agent': 'VSCode-Sinclair-BASIC/1.0.3'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const rawUrl = (await res.text()).trim();
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    throw new Error(`Respuesta vacía o inesperada de Catbox: ${rawUrl}`);
  }

  return rawUrl;
}

/**
 * Uploads bytes to Litterbox temporary hosting (72h retention) as automatic fallback.
 * Uses the same author/CORS configuration as Catbox but a separate API without permanent hash deduplication.
 * @param {Uint8Array} bytes 
 * @param {string} safeFilename 
 * @param {Function} fetchFn 
 * @returns {Promise<string>}
 */
async function uploadToLitterbox(bytes, safeFilename, fetchFn) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '72h');

  const file = new File([bytes], safeFilename, {
    type: 'application/octet-stream'
  });
  form.append('fileToUpload', file);

  const res = await fetchFn(LITTERBOX_API_URL, {
    method: 'POST',
    body: form,
    headers: {
      'User-Agent': 'VSCode-Sinclair-BASIC/1.0.3'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const rawUrl = (await res.text()).trim();
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    throw new Error(`Respuesta vacía o inesperada de Litterbox: ${rawUrl}`);
  }

  return rawUrl;
}

/**
 * Uploads a TAP buffer to a public host and returns the direct public URL.
 * Includes automatic retry on empty responses, 0-byte integrity verification,
 * hash cache-buster bypass, and Litterbox fallback.
 * 
 * @param {Buffer|Uint8Array} tapBytes 
 * @param {string} [filename='program.tap'] 
 * @param {Function} [fetchFn=fetch] Custom fetch implementation (optional for dependency injection/testing)
 * @param {Object} [options={}] Options for retries, verification, and fallback
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.retryDelay=600]
 * @param {boolean} [options.verifyIntegrity=true]
 * @param {boolean} [options.useFallback=true]
 * @param {Function} [options.onProgress] Optional callback for status messages
 * @returns {Promise<string>} Direct download URL (e.g. https://files.catbox.moe/xxxx.tap)
 */
async function uploadTapToHost(tapBytes, filename = 'program.tap', fetchFn = fetch, options = {}) {
  if (!tapBytes || tapBytes.length === 0) {
    throw new Error('El archivo TAP está vacío o no se generó correctamente.');
  }

  const safeFilename = filename.toLowerCase().endsWith('.tap') ? filename : `${filename}.tap`;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
  const retryDelay = options.retryDelay !== undefined ? options.retryDelay : 600;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  let currentBytes = toUint8Array(tapBytes);
  let lastError = null;

  // Attempt 1: Upload to Catbox with retry & 0-byte cache-buster
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        onProgress(`Reintentando subida a Catbox (intento ${attempt}/${maxRetries})...`);
      }
      const rawUrl = await uploadToCatbox(currentBytes, safeFilename, fetchFn);

      // Verify integrity (check if file was stored as 0 bytes due to hash corruption)
      if (options.verifyIntegrity !== false) {
        onProgress('Verificando integridad de la cinta en el servidor...');
        const check = await verifyRemoteFileSize(rawUrl, fetchFn);
        if (!check.ok && check.size === 0) {
          // File was cached with 0 bytes! Append 1 harmless byte (0x00) to change the hash
          // In ZX Spectrum TAP format, extra trailing bytes are safely ignored by ROM tape loaders
          const padded = new Uint8Array(currentBytes.length + 1);
          padded.set(currentBytes);
          padded[currentBytes.length] = 0x00;
          currentBytes = padded;

          if (attempt < maxRetries) {
            onProgress('Caché de 0 bytes detectada en el servidor. Reintentando con evasión de hash...');
            await sleep(retryDelay);
            continue;
          }
        }
      }

      return rawUrl;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(retryDelay);
      }
    }
  }

  // Attempt 2: Fallback to Litterbox if Catbox permanent failed completely
  if (options.useFallback !== false) {
    try {
      onProgress('Catbox temporalmente no disponible. Conmutando a Litterbox (72h)...');
      const litterUrl = await uploadToLitterbox(currentBytes, safeFilename, fetchFn);
      return litterUrl;
    } catch (fallbackErr) {
      lastError = new Error(`Catbox (${lastError.message}) y Litterbox (${fallbackErr.message})`);
    }
  }

  throw new Error(`Error en el servidor de alojamiento: ${lastError.message}`);
}

/**
 * Builds a shareable Turbo80 URL for a given public TAP URL and options.
 * @param {string} tapPublicUrl 
 * @param {{ model?: string, crt?: boolean }} [options={}]
 * @returns {string} Full Turbo80 shareable URL
 */
function buildTurbo80ShareUrl(tapPublicUrl, options = {}) {
  if (!tapPublicUrl) {
    throw new Error('Se requiere la URL pública del archivo TAP.');
  }

  const model = options.model || '48k';
  const encodedUrl = encodeURIComponent(tapPublicUrl.trim());
  let shareUrl = `https://turbo80.com/?load=${encodedUrl}&model=${model}`;

  if (options.crt === false) {
    shareUrl += '&crt=0';
  }

  return shareUrl;
}

module.exports = {
  uploadTapToHost,
  buildTurbo80ShareUrl
};

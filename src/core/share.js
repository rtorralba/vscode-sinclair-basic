/**
 * Sinclair BASIC - Turbo80.com Share Engine
 * 
 * Uploads a compiled ZX Spectrum .tap image to a public host and generates
 * a direct, shareable Turbo80 link (https://turbo80.com/?load=...&model=48k)
 * allowing colleagues and players to test the game instantly in any browser.
 */

/**
 * Uploads a TAP buffer to Catbox (free public file host) and returns the direct public URL.
 * @param {Buffer|Uint8Array} tapBytes 
 * @param {string} [filename='program.tap'] 
 * @param {Function} [fetchFn=fetch] Custom fetch implementation (optional for dependency injection/testing)
 * @returns {Promise<string>} Direct download URL (e.g. https://files.catbox.moe/xxxx.tap)
 */
async function uploadTapToHost(tapBytes, filename = 'program.tap', fetchFn = fetch) {
  if (!tapBytes || tapBytes.length === 0) {
    throw new Error('El archivo TAP está vacío o no se generó correctamente.');
  }

  const safeFilename = filename.toLowerCase().endsWith('.tap') ? filename : `${filename}.tap`;

  const form = new FormData();
  form.append('reqtype', 'fileupload');

  const file = new File([tapBytes], safeFilename, {
    type: 'application/octet-stream'
  });
  form.append('fileToUpload', file);

  const res = await fetchFn('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
    headers: {
      'User-Agent': 'VSCode-Sinclair-BASIC/1.0.1'
    }
  });

  if (!res.ok) {
    throw new Error(`Error en el servidor de alojamiento (${res.status} ${res.statusText})`);
  }

  const rawUrl = (await res.text()).trim();
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    throw new Error(`Respuesta inesperada al alojar la cinta: ${rawUrl}`);
  }

  return rawUrl;
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

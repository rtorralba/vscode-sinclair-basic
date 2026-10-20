const test = require('node:test');
const assert = require('node:assert');
const { uploadTapToHost, buildTurbo80ShareUrl } = require('../src/core/share');

test('buildTurbo80ShareUrl constructs valid Turbo80 link with defaults', () => {
  const tapUrl = 'https://files.catbox.moe/abc123.tap';
  const shareUrl = buildTurbo80ShareUrl(tapUrl);

  assert.ok(shareUrl.startsWith('https://turbo80.com/?load='));
  assert.ok(shareUrl.includes(encodeURIComponent(tapUrl)));
  assert.ok(shareUrl.includes('model=48k'));
});

test('buildTurbo80ShareUrl supports 128k model and disabling CRT', () => {
  const tapUrl = 'https://files.catbox.moe/game128.tap';
  const shareUrl = buildTurbo80ShareUrl(tapUrl, { model: '128k', crt: false });

  assert.ok(shareUrl.includes('model=128k'));
  assert.ok(shareUrl.includes('crt=0'));
});

test('buildTurbo80ShareUrl throws on empty URL', () => {
  assert.throws(() => buildTurbo80ShareUrl(''), /Se requiere la URL/);
});

test('uploadTapToHost uploads successfully with mock fetch', async () => {
  const mockTapBytes = Buffer.from('FAKE-ZX-SPECTRUM-TAP-BYTES');
  const mockFetch = async (url, opts) => {
    assert.strictEqual(url, 'https://catbox.moe/user/api.php');
    assert.strictEqual(opts.method, 'POST');
    return {
      ok: true,
      status: 200,
      text: async () => 'https://files.catbox.moe/test99.tap\n'
    };
  };

  const publicUrl = await uploadTapToHost(mockTapBytes, 'mi_juego.tap', mockFetch);
  assert.strictEqual(publicUrl, 'https://files.catbox.moe/test99.tap');
});

test('uploadTapToHost throws on empty buffer', async () => {
  await assert.rejects(
    async () => uploadTapToHost(Buffer.alloc(0)),
    /El archivo TAP está vacío/
  );
});

test('uploadTapToHost handles HTTP error status', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error'
  });

  await assert.rejects(
    async () => uploadTapToHost(Buffer.from('TAP'), 'juego.tap', mockFetch),
    /Error en el servidor de alojamiento/
  );
});

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
  const mockFetch = async (url, opts = {}) => {
    if (opts.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: { 'content-length': String(mockTapBytes.length) }
      };
    }
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

test('uploadTapToHost handles HTTP error status and reports error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error'
  });

  await assert.rejects(
    async () => uploadTapToHost(Buffer.from('TAP'), 'juego.tap', mockFetch, { maxRetries: 1, useFallback: false }),
    /Error en el servidor de alojamiento/
  );
});

test('uploadTapToHost retries on empty response from Catbox and succeeds', async () => {
  let attempt = 0;
  const mockTapBytes = Buffer.from('RETRY-TEST-TAP');
  const mockFetch = async (url, opts = {}) => {
    if (opts.method === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: { 'content-length': String(mockTapBytes.length) }
      };
    }
    attempt++;
    if (attempt === 1) {
      // First attempt returns empty body (Catbox load spike)
      return {
        ok: true,
        status: 200,
        text: async () => '   \n'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => 'https://files.catbox.moe/retry_success.tap\n'
    };
  };

  const publicUrl = await uploadTapToHost(mockTapBytes, 'retry.tap', mockFetch, { retryDelay: 5 });
  assert.strictEqual(publicUrl, 'https://files.catbox.moe/retry_success.tap');
  assert.strictEqual(attempt, 2);
});

test('uploadTapToHost detects 0-byte cache corruption and re-uploads with cache-buster padding byte', async () => {
  let attempt = 0;
  const recordedFiles = [];
  const mockTapBytes = Buffer.from('ZERO-BYTE-CACHE-BUG');

  const mockFetch = async (url, opts = {}) => {
    if (opts.method === 'HEAD') {
      if (url.includes('zero_corrupt.tap')) {
        // First file was cached with 0 bytes!
        return {
          ok: true,
          status: 200,
          headers: { 'content-length': '0' }
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { 'content-length': String(mockTapBytes.length + 1) }
      };
    }

    attempt++;
    // Capture the file bytes sent in FormData
    const file = opts.body.get('fileToUpload');
    const bytes = await file.arrayBuffer();
    recordedFiles.push(new Uint8Array(bytes));

    if (attempt === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => 'https://files.catbox.moe/zero_corrupt.tap\n'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => 'https://files.catbox.moe/clean_fixed.tap\n'
    };
  };

  const publicUrl = await uploadTapToHost(mockTapBytes, 'zero.tap', mockFetch, { retryDelay: 5 });
  assert.strictEqual(publicUrl, 'https://files.catbox.moe/clean_fixed.tap');
  assert.strictEqual(attempt, 2);
  // Verify first attempt had original length
  assert.strictEqual(recordedFiles[0].length, mockTapBytes.length);
  // Verify second attempt was padded with 1 byte (0x00)
  assert.strictEqual(recordedFiles[1].length, mockTapBytes.length + 1);
  assert.strictEqual(recordedFiles[1][recordedFiles[1].length - 1], 0x00);
});

test('uploadTapToHost falls back to Litterbox (72h) if Catbox is completely down', async () => {
  const mockTapBytes = Buffer.from('FALLBACK-TEST-TAP');
  const calledUrls = [];

  const mockFetch = async (url, opts = {}) => {
    calledUrls.push(url);
    if (url === 'https://catbox.moe/user/api.php') {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      };
    }
    if (url === 'https://litterbox.catbox.moe/resources/internals/api.php') {
      assert.strictEqual(opts.body.get('time'), '72h');
      return {
        ok: true,
        status: 200,
        text: async () => 'https://litter.catbox.moe/fallback123.tap\n'
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { 'content-length': String(mockTapBytes.length) }
    };
  };

  const publicUrl = await uploadTapToHost(mockTapBytes, 'game.tap', mockFetch, {
    maxRetries: 2,
    retryDelay: 5,
    useFallback: true
  });

  assert.strictEqual(publicUrl, 'https://litter.catbox.moe/fallback123.tap');
  assert.ok(calledUrls.includes('https://catbox.moe/user/api.php'));
  assert.ok(calledUrls.includes('https://litterbox.catbox.moe/resources/internals/api.php'));
});

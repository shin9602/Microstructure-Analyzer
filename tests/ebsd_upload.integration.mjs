import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { createServer } from 'vite';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const workspace = process.cwd();
const fixtureParent = path.resolve(os.tmpdir(), 'AutoCalculator', 'upload-tests');
const fixture = path.join(fixtureParent, "한글 O'Hara! " + randomUUID());
const runtime = path.join(os.tmpdir(), 'AutoCalculator', 'ebsd',
  createHash('sha256').update(fixture.toLowerCase()).digest('hex').slice(0, 16));
assert.ok(fixture.startsWith(fixtureParent + path.sep));
assert.ok(runtime.startsWith(path.join(os.tmpdir(), 'AutoCalculator', 'ebsd') + path.sep));
await fsp.mkdir(path.join(fixture, 'python', '.temp_ebsd'), { recursive: true });
for (const name of await fsp.readdir(path.join(workspace, 'python'))) {
  if (name.endsWith('.py') && !name.startsWith('test_')) {
    await fsp.copyFile(path.join(workspace, 'python', name), path.join(fixture, 'python', name));
  }
}
for (const name of ['vite.config.ts', 'version.txt', 'package.json']) {
  await fsp.copyFile(path.join(workspace, name), path.join(fixture, name));
}
// Resolve packages from the actual installation without a junction into its
// node_modules. The isolated install can live outside OneDrive, with any name.
const configPath = path.join(fixture, 'vite.config.ts');
let config = await fsp.readFile(configPath, 'utf8');
for (const dependency of ['vite', '@vitejs/plugin-react', 'tailwindcss', 'autoprefixer']) {
  config = config.replaceAll(`'${dependency}'`, JSON.stringify(import.meta.resolve(dependency)));
}
await fsp.writeFile(configPath, config);
const guardCode = (await transform(await fsp.readFile(path.join(workspace, 'src/server/security.ts'), 'utf8'), {loader:'ts',format:'esm'})).code;
config = config.replace("'./src/server/security'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(guardCode).toString('base64')));
const runnableConfig = path.join(fixture, 'vite-runtime.mjs');
await fsp.writeFile(runnableConfig, (await transform(config, { loader: 'ts', format: 'esm', target: 'node20' })).code);
const configuration = (await import(pathToFileURL(runnableConfig).href)).default;
const oldDirectory = path.join(fixture, 'python', '.temp_ebsd');
const sentinel = path.join(oldDirectory, 'locked.osc');
await fsp.writeFile(sentinel, 'existing OneDrive input must remain untouched');
const originalWrite = fs.createWriteStream;
const originalRm = fs.rmSync;
let failNextWrite = false;
fs.rmSync = function (target, ...args) {
  if (path.resolve(String(target)).startsWith(oldDirectory + path.sep)) {
    throw Object.assign(new Error('simulated OneDrive deletion failure'), { code: 'EPERM' });
  }
  return originalRm.call(this, target, ...args);
};
fs.createWriteStream = function (target, ...args) {
  if (path.resolve(String(target)).startsWith(oldDirectory + path.sep)) {
    throw Object.assign(new Error('simulated OneDrive write failure'), { code: 'EPERM' });
  }
  if (failNextWrite && path.resolve(String(target)).startsWith(runtime + path.sep)) {
    failNextWrite = false;
    return new Writable({ write(_chunk, _encoding, done) {
      done(Object.assign(new Error('simulated disk permission failure'), { code: 'EPERM' }));
    } });
  }
  return originalWrite.call(this, target, ...args);
};
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('Timed out waiting for upload cleanup');
};
let server;
try {
  server = await createServer({ ...configuration, root: fixture, configFile: false,
    cacheDir: path.join(fixture, 'vite-cache'), optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, open: false }, clearScreen: false });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const rootResponse = await fetch(base);
  const cookie = rootResponse.headers.get('set-cookie').split(';')[0];
  const localFetch = (url, options={}) => fetch(url, {...options, headers:{Cookie:cookie,...options.headers}});
  let reloads = 0;
  const send = server.ws.send.bind(server.ws);
  server.ws.send = (...args) => { if (args[0]?.type === 'full-reload') reloads++; return send(...args); };
  const prepare = async previous => {
    const response = await localFetch(base + '/api/clear-ebsd-temp' + (previous ? '?previous_session=' + previous : ''));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.match(body.session, /^[a-f0-9-]{36}$/);
    return body.session;
  };
  const upload = (session, filename, body) => localFetch(base + '/api/upload-ebsd?session=' + session + '&filename=' + encodeURIComponent(filename),
    { method: 'POST', body, duplex: 'half' });
  const first = await prepare();
  const second = await prepare();
  for (const [session, body] of [[first, 'first'], [second, 'second']]) {
    assert.equal((await upload(session, 'same-name.ang', body)).status, 200);
    assert.equal(await fsp.readFile(path.join(runtime, 'uploads', session, 'same-name.ang'), 'utf8'), body);
  }
  assert.equal(await fsp.readFile(sentinel, 'utf8'), 'existing OneDrive input must remain untouched');
  console.log('PASS: OneDrive EPERM paths untouched; sessions isolate colliding filenames');

  failNextWrite = true;
  const failed = await upload(second, 'fail.ang', 'nonempty data');
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).error, /simulated disk permission failure/);
  assert.equal((await upload(second, 'empty.ang', '')).status, 400);
  assert.equal((await upload('invalid', 'probe.ang', 'x')).status, 400);
  const third = await prepare();
  console.log('PASS: write errors return HTTP JSON; empty/stale uploads rejected; server stays alive');

  const abortDirectory = path.join(runtime, 'uploads', third);
  const aborted = http.request(base + '/api/upload-ebsd?session=' + third + '&filename=aborted.osc',
    { method: 'POST', headers: { Cookie:cookie, 'Content-Length': 1000000 } });
  aborted.on('error', () => undefined);
  aborted.write(Buffer.alloc(16384));
  await waitFor(async () => (await fsp.readdir(abortDirectory)).some(name => name.endsWith('.upload')));
  aborted.destroy();
  await waitFor(async () => !(await fsp.readdir(abortDirectory)).some(name => name.endsWith('.upload')));
  const actualSession = await prepare(third);
  console.log('PASS: interrupted upload partial file removed; next upload session works');

  const actualPath = process.argv[2];
  if (actualPath) {
    const name = path.basename(actualPath);
    const size = (await fsp.stat(actualPath)).size;
    const uploaded = await upload(actualSession, name, fs.createReadStream(actualPath));
    assert.equal(uploaded.status, 200);
    assert.equal((await uploaded.json()).file, name);
    assert.equal((await fsp.stat(path.join(runtime, 'uploads', actualSession, name))).size, size);
    console.log('PASS: actual OSC uploaded without conversion in the HTTP request:', size, 'bytes');
    const testEta = process.argv.includes('--eta');
    let expectedEta = 0, etaCount = 0, previewReference;
    if (testEta) {
      const prepared = await localFetch(base + '/api/prepare-ebsd?session=' + actualSession + '&filename=' + encodeURIComponent(name));
      assert.equal(prepared.status, 200, await prepared.clone().text());
      const descriptor = await prepared.json();
      previewReference = descriptor.iq;
      const iq = await (await localFetch(base + '/api/ebsd-results/' + encodeURIComponent(descriptor.iq))).arrayBuffer();
      const valid = new Uint8Array(await (await localFetch(base + '/api/ebsd-results/' + encodeURIComponent(descriptor.valid))).arrayBuffer());
      assert.equal(iq.byteLength, descriptor.width * descriptor.height * 4);
      const mask = new Uint8Array(valid.length);
      for (let y = Math.floor(descriptor.height * .1); y < Math.floor(descriptor.height * .3); y++) {
        for (let x = Math.floor(descriptor.width * .1); x < Math.floor(descriptor.width * .3); x++) {
          const index = y * descriptor.width + x;
          if (valid[index]) { mask[index] = 1; etaCount++; }
        }
      }
      expectedEta = etaCount / valid.reduce((a, b) => a + b, 0) * 100;
      const parameters = new URLSearchParams({session: actualSession, filename: name, width: String(descriptor.width), height: String(descriptor.height), source_sha256: descriptor.source_sha256});
      const invalid = await localFetch(base + '/api/eta-mask?' + parameters, {method:'POST', body: new Uint8Array(1)});
      assert.equal(invalid.status, 400);
      const wrongHash = new URLSearchParams(parameters); wrongHash.set('source_sha256', '0'.repeat(64));
      assert.equal((await localFetch(base + '/api/eta-mask?' + wrongHash, {method:'POST', body:mask})).status, 400);
      const saved = await localFetch(base + '/api/eta-mask?' + parameters, {method:'POST', body:mask});
      assert.equal(saved.status, 200, await saved.clone().text());
      console.log('PASS: exact-grid IQ reference, mask shape/hash rejection, and eta selection upload:', etaCount, 'test pixels');
    }
    const coWeight = process.argv[3] ?? '9';
    const options = testEta ? '&analysis_options=' + encodeURIComponent(JSON.stringify({eta:{enabled:true,co_basis:'remaining'}})) : '';
    const text = await (await localFetch(base + '/api/run-ebsd?temp=1&session=' + actualSession + '&co_wt=' + encodeURIComponent(coWeight) + options)).text();
    const events = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const result = events.find(event => event.type === 'result_pack');
    assert.ok(result, text.slice(-2500));
    assert.equal(events.find(event => event.type === 'done')?.code, 0);
    assert.equal(result.errors.length, 0);
    assert.ok(result.samples[0].basic && result.samples[0].advanced);
    assert.equal(result.samples[0].basic.PhaseAudit.gamma_mode, 'all_other');
    const audit = result.samples[0].basic.PhaseAudit;
    assert.equal(audit.classification_order, 'Whole-map IQ Co -> remaining source WC / gamma');
    assert.ok(Math.abs(audit.co_percent_before_cleanup - audit.co_target_percent_of_total) < 0.01);
    assert.equal(result.samples[0].advanced.PhaseAudit.classification_order, audit.classification_order);
    console.log('PASS: basic/advanced use whole-map IQ Co first; Co area matches the whole-map target:', audit.co_percent_before_cleanup);
    if (testEta) {
      const basic = result.samples[0].basic;
      assert.ok(Math.abs(basic.Eta_Area - expectedEta) < 1e-8);
      assert.equal(audit.eta_points, etaCount);
      assert.equal(result.samples[0].advanced.PhaseAudit.eta_points, etaCount);
      assert.ok(Math.abs(basic.WC_Vol + basic.Co_Vol + basic.G_Vol + basic.Eta_Area + basic.Excluded_Area - 100) < 1e-8);
      const sizeImage = result.samples[0].images.find(name => name.includes('ETA_SIZE_'));
      assert.ok(sizeImage);
      assert.equal(result.samples[0].image_data[sizeImage].length, 2);
      const thresholdImage = result.samples[0].images.find(name => name.includes('threshold_check_'));
      assert.ok(thresholdImage);
      const histogram = result.samples[0].image_data[thresholdImage].find(name => !name.endsWith('_raw.csv'));
      const rows = (await (await localFetch(base + '/api/ebsd-results/' + encodeURIComponent(histogram))).text()).trim().split(/\r?\n/);
      const countColumn = rows.shift().split(',').indexOf('count');
      assert.equal(rows.reduce((sum,row) => sum + Number(row.split(',')[countColumn]),0), audit.analysis_points);
      console.log('PASS: eta removed in both analyses; total Area% sums to 100; size plot and both CSV exports available');
    }
    const image = result.samples[0].images.find(name => name.includes('IQ_MAP_'));
    assert.ok(image);
    const png = await localFetch(base + '/api/ebsd-results/' + encodeURIComponent(image));
    assert.equal(png.status, 200);
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
    const zip = await localFetch(base + '/api/ebsd-results/' + encodeURIComponent(result.zip));
    assert.equal(zip.status, 200);
    assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    await waitFor(async () => !fs.existsSync(path.join(runtime, 'uploads', actualSession)));
    if (previewReference) await waitFor(async () => !fs.existsSync(path.join(runtime, 'results', previewReference)));
    console.log('PASS: actual OSC conversion, combined analysis, IQ PNG and ZIP download; input cleaned afterward');
  }
  assert.equal(reloads, 0, 'Uploading must not trigger browser reload');
  console.log('PASS: uploads and results remain outside OneDrive; no browser full reload');
} finally {
  if (server) {
    server.httpServer.closeAllConnections?.();
    await server.close();
  }
  fs.createWriteStream = originalWrite;
  fs.rmSync = originalRm;
  // Both recursive targets are unique, verified test-owned absolute directories.
  await fsp.rm(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fsp.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

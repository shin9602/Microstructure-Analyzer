import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'vite';
import { transform } from 'esbuild';
import fs from 'node:fs/promises';

const source = await fs.readFile('src/server/security.ts', 'utf8');
const code = (await transform(source, {loader:'ts', format:'esm'})).code;
const {privateRequestPath, validMeasurementFilename} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
for (const pathname of ['/token.txt','/@fs/C:/app/token.txt?raw','/%2574oken.txt','/token.txt::$DATA','/.env.local','/analysis_results/report.md','/__open-in-editor','/launch_app.ps1']) assert.equal(privateRequestPath(pathname), true, pathname);
assert.equal(privateRequestPath('/src/main.tsx'), false);
assert.equal(privateRequestPath('/api/ebsd-results/scan.osc.map.png'), false);
for (const name of ['../a.osc','a.osc:stream','NUL.ang','a.exe','a/b.ang']) assert.equal(validMeasurementFilename(name), false, name);
assert.equal(validMeasurementFilename('한글 측정 [1].osc'), true);
const server = await createServer({server:{host:'127.0.0.1',port:5187,strictPort:true,open:false},clearScreen:false});
try {
  await server.listen();
  const base = 'http://127.0.0.1:5187';
  const index = await fetch(base);
  assert.equal(index.status,200);
  const cookie = index.headers.get('set-cookie').split(';')[0];
  assert.match(index.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const check = async (pathname, status, options={}) => {
    const response=await fetch(base+pathname,{...options,headers:{Cookie:cookie,...options.headers}});
    assert.equal(response.status,status,pathname); await response.body?.cancel();
  };
  await check('/api/ebsd-history',200);
  assert.equal((await fetch(base+'/api/ebsd-history')).status,401);
  await check('/api/ebsd-history',403,{headers:{Origin:'https://security-probe.invalid'}});
  await check('/api/ebsd-history',403,{headers:{'Sec-Fetch-Site':'cross-site'}});
  await check('/api/ebsd-history',405,{method:'POST'});
  await check('/token.txt',403,{method:'HEAD'});
  await check('/%2574oken.txt?raw',403,{method:'HEAD'});
  await check('/launch_app.ps1',403,{method:'HEAD'});
  await check('/src/main.tsx',200);
  const rebound = await new Promise((resolve,reject)=>{
    const req=http.request(base+'/api/ebsd-history',{headers:{Host:'security-probe.invalid:5187',Cookie:cookie}},res=>{resolve(res.statusCode);res.resume()}); req.on('error',reject);req.end();
  });
  assert.equal(rebound,403);
  const oversized = await new Promise((resolve,reject)=>{
    const req=http.request(base+'/api/upload-ebsd',{method:'POST',headers:{Cookie:cookie,'Content-Length':1073741825}},res=>{resolve(res.statusCode);res.resume();req.destroy()});req.on('error',reject);req.flushHeaders();
  });
  assert.equal(oversized,413);
  console.log('PASS: private file guards, filenames, session, Host, Origin, Fetch-Site, methods, upload limit and normal module loading');
} finally { await server.close(); }

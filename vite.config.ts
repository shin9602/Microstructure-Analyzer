import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { finished } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'
import { localRequestError, privateRequestPath, validMeasurementFilename, MAX_UPLOAD_BYTES } from './src/server/security'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const ebsdRuntimeRoot = path.join(os.tmpdir(), 'AutoCalculator', 'ebsd',
  createHash('sha256').update(path.resolve(projectRoot).toLowerCase()).digest('hex').slice(0, 16))
const ebsdPersistentRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'AutoCalculator', 'ebsd',
  createHash('sha256').update(path.resolve(projectRoot).toLowerCase()).digest('hex').slice(0, 16))
const ebsdResultsRoot = path.join(ebsdPersistentRoot, 'results')
const ebsdAnalysisCache = path.join(ebsdPersistentRoot, 'cache')

async function saveUpload(req: IncomingMessage, destination: string) {
  const output = fs.createWriteStream(destination, { flags: 'wx' })
  let received = 0
  const limit = (chunk: Buffer) => { received += chunk.length; if (received > MAX_UPLOAD_BYTES) { req.unpipe(output); output.destroy(new Error('업로드는 파일당 1 GiB 이하로 제한됩니다.')); req.resume() } }
  req.on('data', limit)
  const complete = finished(output)
  req.once('aborted', () => output.destroy(new Error('업로드 연결이 중단됐습니다.')))
  req.once('error', error => output.destroy(error))
  req.pipe(output)
  try {
    await complete
    if (!req.complete) throw new Error('파일 업로드가 완료되지 않았습니다.')
  } catch (error) {
    // Do not destroy the HTTP request on a disk error: return JSON to the client.
    req.unpipe(output)
    req.resume()
    output.destroy()
    throw error
  } finally { req.off('data', limit) }
}

// version.txt is what START_HERE.bat updates, so the UI label must follow it.
function readAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'version.txt'), 'utf8')
    const v = raw.replace(/^\uFEFF/, '').trim()
    if (v) return v.startsWith('v') ? v : `v${v}`
  } catch {
    // fall through to package.json
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
    if (pkg.version) return `v${pkg.version}`
  } catch {
    // ignore
  }
  return 'v?'
}

function isWindowsStorePython(exe: string): boolean {
  const normalized = exe.toLowerCase()
  return normalized.includes('windowsapps')
    || normalized.endsWith('\\python.exe') && normalized.includes('microsoft')
    || exe === 'python'
    || exe === 'py'
}

function resolvePythonCommand(): string {
  const envPython = process.env.PYTHON_EXE?.trim()
  if (envPython && !isWindowsStorePython(envPython)) {
    if (path.isAbsolute(envPython) && fs.existsSync(envPython)) return envPython
    if (!path.isAbsolute(envPython)) return envPython
  }

  const bundledPython = path.join(projectRoot, '_tools', 'python', 'python.exe')
  if (process.platform === 'win32' && fs.existsSync(bundledPython)) {
    return bundledPython
  }


  return 'python'
}

function spawnPythonProcess(pythonCmd: string, args: string[], cwd: string) {
  return spawn(pythonCmd, ['-X', 'utf8', '-u', ...args], {
    cwd, windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg', NUMBA_CACHE_DIR: path.join(ebsdRuntimeRoot, 'numba') },
  })
}

function pythonRunnerPlugin(): Plugin {
  const localSecret = randomBytes(32).toString('hex')
  const uploads = new Map<string, string>()
  const activeUploads = new Set<string>()
  const etaMasks = new Map<string, Record<string, { path: string; width: number; height: number; source_sha256: string }>>()
  const previewDirectories = new Map<string, Set<string>>()
  const removeUpload = async (session: string) => {
    const directory = uploads.get(session)
    if (!directory || activeUploads.has(session)) return
    const allowedRoot = path.resolve(ebsdRuntimeRoot, 'uploads') + path.sep
    if (!path.resolve(directory).startsWith(allowedRoot)) throw new Error('Invalid upload cleanup path')
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    uploads.delete(session)
    etaMasks.delete(session)
    const previewRoot = path.resolve(ebsdResultsRoot, 'previews') + path.sep
    for (const preview of previewDirectories.get(session) || []) {
      if (!path.resolve(preview).startsWith(previewRoot)) throw new Error('Invalid preview cleanup path')
      await fs.promises.rm(preview, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    }
    previewDirectories.delete(session)
  }
  return {
    name: 'python-runner',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestError = localRequestError(req)
        if (requestError || privateRequestPath(req.url || '/')) {
          res.statusCode = 403; res.end('Forbidden local request'); req.resume(); return
        }
        res.setHeader('X-Content-Type-Options', 'nosniff')
        const cookieName = `ac_local_session_${req.socket.localPort}`
        const pathname = (req.url || '/').split('?')[0]
        if (pathname === '/' || pathname === '/index.html') {
          res.setHeader('Set-Cookie', `${cookieName}=${localSecret}; HttpOnly; SameSite=Strict; Path=/`)
        }
        if (pathname.startsWith('/api/')) {
          if (!(req.headers.cookie || '').split(';').some(value => value.trim() === `${cookieName}=${localSecret}`)) {
            res.statusCode = 401; res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: '앱 세션이 만료됐습니다. 화면을 새로고침하세요.' })); req.resume(); return
          }
          const posting = pathname === '/api/upload-ebsd' || pathname === '/api/eta-mask'
          if (req.method !== (posting ? 'POST' : 'GET')) { res.statusCode = 405; res.end('Method not allowed'); req.resume(); return }
          const length = req.headers['content-length']
          if (posting && length && (!/^\d+$/.test(length) || Number(length) > MAX_UPLOAD_BYTES)) {
            res.statusCode = 413; res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: '업로드는 파일당 1 GiB 이하로 제한됩니다.' })); req.resume(); return
          }
        }

        if (req.url?.startsWith('/api/prepare-ebsd') || req.url?.startsWith('/api/eta-mask')) {
          const url = new URL(req.url, 'http://localhost')
          const session = url.searchParams.get('session') || ''
          const directory = uploads.get(session)
          const filename = url.searchParams.get('filename') || ''
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (!directory || activeUploads.has(session) || path.basename(filename) !== filename || !validMeasurementFilename(filename) || !fs.existsSync(path.join(directory, filename))) {
            res.statusCode = 400; res.end(JSON.stringify({ error: '파일 업로드를 다시 준비한 뒤 영역을 선택하세요.' })); req.resume(); return
          }
          if (url.pathname === '/api/eta-mask') {
            const width = Number(url.searchParams.get('width')), height = Number(url.searchParams.get('height'))
            const digest = url.searchParams.get('source_sha256') || ''
            if (req.method !== 'POST' || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 20_000_000 || !/^[a-f0-9]{64}$/.test(digest) || Number(req.headers['content-length']) !== width * height) {
              res.statusCode = 400; res.end(JSON.stringify({ error: '에타 영역 데이터의 크기 또는 파일 정보가 올바르지 않습니다.' })); req.resume(); return
            }
            const destination = path.join(directory, randomUUID() + '.eta-mask.bin')
            activeUploads.add(session)
            void (async () => {
              try {
                await saveUpload(req, destination)
                const hasher = createHash('sha256')
                for await (const block of fs.createReadStream(path.join(directory, filename))) hasher.update(block)
                if (hasher.digest('hex') !== digest) throw new Error('에타 영역을 선택한 파일과 업로드한 파일이 다릅니다.')
                const masks = etaMasks.get(session) || {}
                const key = filename.replace(/\.(osc|ang)$/i, '.ang')
                const previous = masks[key]?.path
                masks[key] = { path: destination, width, height, source_sha256: digest }
                etaMasks.set(session, masks)
                if (previous) await fs.promises.rm(previous, { force: true })
                res.end(JSON.stringify({ success: true }))
              } catch (error) {
                await fs.promises.rm(destination, { force: true }).catch(() => undefined)
                if (!res.destroyed) { res.statusCode = 400; res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
              } finally { activeUploads.delete(session) }
            })()
            return
          }
          activeUploads.add(session)
          const output = path.join(ebsdResultsRoot, 'previews', randomUUID())
          const previews = previewDirectories.get(session) || new Set<string>()
          previews.add(output); previewDirectories.set(session, previews)
          const child = spawnPythonProcess(resolvePythonCommand(), [path.join('python', 'prepare_ebsd.py'), '--input', path.join(directory, filename), '--output', output, '--results-root', ebsdResultsRoot], projectRoot)
          let stdout = '', stderr = '', complete = false
          child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
          child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-6000) })
          child.on('error', error => { stderr += error.message })
          child.on('close', code => {
            complete = true; activeUploads.delete(session)
            if (res.destroyed) return
            const descriptor = stdout.split('\n').find(line => line.startsWith('PREVIEW_DATA:'))
            if (code === 0 && descriptor) res.end(descriptor.slice(13))
            else { res.statusCode = 500; res.end(JSON.stringify({ error: '에타 편집용 IQ 맵 준비 실패: ' + (stderr || stdout).slice(-2500) })) }
          })
          res.on('close', () => { if (!complete) child.kill() })
          return
        }
        if (req.url && req.url.startsWith('/api/clear-ebsd-temp')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            try {
              const previous = new URL(req.url, 'http://localhost').searchParams.get('previous_session')
              if (previous) void removeUpload(previous).catch(error => console.warn('Upload cleanup:', error.message))
              const session = randomUUID()
              const directory = path.join(ebsdRuntimeRoot, 'uploads', session)
              fs.mkdirSync(directory, { recursive: true })
              uploads.set(session, directory)
              res.end(JSON.stringify({ success: true, session }))
            } catch (error) {
              res.statusCode = 500
              res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
            }
            return;
        }

        if (req.url && req.url.startsWith('/api/upload-ebsd')) {
           const urlObj = new URL(req.url, 'http://localhost');
           const filename = urlObj.searchParams.get('filename');
           const session = urlObj.searchParams.get('session') || ''
           const tempPath = uploads.get(session)
           res.setHeader('Content-Type', 'application/json; charset=utf-8')
           if (!filename || path.basename(filename) !== filename || !validMeasurementFilename(filename)) {
               res.statusCode = 400
               res.end(JSON.stringify({ success: false, error: 'ANG 또는 OSC 파일 이름을 확인하세요.' }));
               req.resume()
               return;
           }
           if (!tempPath || activeUploads.has(session)) {
             res.statusCode = 400
             res.end(JSON.stringify({ success: false, error: '업로드 준비가 만료됐습니다. 화면을 새로고침하고 다시 실행하세요.' }))
             req.resume()
             return
           }
           const partial = path.join(tempPath, randomUUID() + '.upload')
           void (async () => {
             try {
               await saveUpload(req, partial)
               if ((await fs.promises.stat(partial)).size === 0) {
                 res.statusCode = 400
                 throw new Error('파일이 비어 있습니다.')
               }
               await fs.promises.rename(partial, path.join(tempPath, filename))
               // Conversion belongs to the analysis process, not the upload request.
               if (!res.destroyed) res.end(JSON.stringify({ success: true, file: filename }))
             } catch (error) {
               req.resume()
               if (!res.destroyed && !res.writableEnded) {
                 if (res.statusCode === 200) res.statusCode = 500
                 res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
               }
             } finally {
               await fs.promises.rm(partial, { force: true }).catch(() => undefined)
             }
           })()
           return;
        }

        if (req.url && req.url.startsWith('/api/ebsd-results/')) {
           let requestedFile: string;
           try { requestedFile = decodeURIComponent(req.url.replace('/api/ebsd-results/', '').split('?')[0]) }
           catch { res.statusCode = 400; res.end('Invalid result path'); return }
           const resultsRoot = ebsdResultsRoot;
           const filePath = path.resolve(resultsRoot, requestedFile);
           if (!filePath.startsWith(resultsRoot + path.sep)) { res.statusCode = 403; res.end('Invalid result path'); return; }
           if (!fs.existsSync(filePath)) {
               res.statusCode = 404;
               res.end('Not found');
               return;
           }
           
           const realRoot = fs.realpathSync(resultsRoot) + path.sep
           const realFile = fs.realpathSync(filePath)
           if (!realFile.startsWith(realRoot) || !fs.statSync(realFile).isFile()) { res.statusCode = 403; res.end('Invalid result path'); return }
           if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
           if (filePath.endsWith('.txt')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
           if (filePath.endsWith('.csv')) res.setHeader('Content-Type', 'text/csv; charset=utf-8');
           if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
           if (filePath.endsWith('.zip')) res.setHeader('Content-Type', 'application/zip');
           
           res.setHeader('Cache-Control', 'public, max-age=0');
           res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(requestedFile)}"; filename*=UTF-8''${encodeURIComponent(requestedFile)}`);
           
           const readStream = fs.createReadStream(filePath);
           readStream.on('error', () => { if (!res.headersSent) { res.statusCode = 500; res.end('결과 파일을 읽지 못했습니다.'); } else res.destroy(); });
           res.on('close', () => readStream.destroy());
           readStream.pipe(res);
           return;
        }

        if (req.url?.startsWith('/api/ebsd-history')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'GET only' })); return }
          const key = new URL(req.url, 'http://localhost').searchParams.get('key')
          if (key && !/^[a-f0-9]{64}$/.test(key)) { res.statusCode = 400; res.end(JSON.stringify({ error: '잘못된 저장 결과 번호입니다.' })); return }
          const args = ['python/ebsd_cache.py', '--cache-dir', ebsdAnalysisCache, '--output', ebsdResultsRoot]
          if (key) args.push('--open', key)
          const child = spawnPythonProcess(resolvePythonCommand(), args, projectRoot)
          let stdout = ''
          let stderr = ''
          let ended = false
          child.stdout.setEncoding('utf8')
          child.stdout.on('data', (chunk: string) => { stdout += chunk })
          child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000) })
          child.on('error', error => { stderr = error.message })
          child.on('close', code => {
            ended = true
            if (res.destroyed || res.writableEnded) return
            try {
              if (code !== 0) throw new Error(stderr || '저장 결과를 확인하지 못했습니다.')
              const payload = JSON.parse(stdout)
              if (payload.error) res.statusCode = 404
              res.end(JSON.stringify(payload))
            } catch (error) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
            }
          })
          res.on('close', () => { if (!ended) child.kill() })
          return
        }

        if (req.url && req.url.startsWith('/api/run-ebsd')) {
          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')

          const urlObj = new URL(req.url, 'http://localhost')
          const useTemp = urlObj.searchParams.get('temp') === '1'
          const coWt = urlObj.searchParams.get('co_wt')
          const compMap = urlObj.searchParams.get('comp_map')
          const gammaMode = urlObj.searchParams.get('gamma_mode') ?? 'all_other'
          let analysisOptions: Record<string, unknown>
          try {
            analysisOptions = JSON.parse(urlObj.searchParams.get('analysis_options') || '{}')
            if (!analysisOptions || Array.isArray(analysisOptions) || typeof analysisOptions !== 'object') throw new Error('invalid')
          } catch {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '분석 설정을 읽지 못했습니다.' })}\n\n`); res.end(); return
          }
          const session = urlObj.searchParams.get('session') || ''
          const uploadDirectory = uploads.get(session)
          if (useTemp && (!uploadDirectory || activeUploads.has(session))) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '업로드 준비가 만료됐거나 이미 분석 중입니다. 파일을 다시 선택하고 실행하세요.' })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'done', code: 2 })}\n\n`)
            res.end()
            return
          }
          if (!['all_other', 'named', 'manual'].includes(gammaMode)) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '지원하지 않는 gamma상 분석 모드입니다.' })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'done', code: 2 })}\n\n`)
            res.end()
            return
          }
          
          const scriptName = 'run_ebsd.py'
          const pyPath = path.resolve(projectRoot, 'python', scriptName)
          const scriptRelPath = path.join('python', scriptName)

          if (!fs.existsSync(pyPath)) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: `Python script not found: ${pyPath}` })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'done', code: 2 })}\n\n`)
            res.end()
            return
          }
          
          res.write(`data: ${JSON.stringify({ type: 'info', message: `Starting Python Analyzer (${scriptName})...` })}\n\n`)
          
          try { fs.mkdirSync(ebsdResultsRoot, { recursive: true }) }
          catch (error) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'done', code: 2 })}\n\n`)
            res.end()
            return
          }
          const args = [scriptRelPath, '--output', ebsdResultsRoot, '--cache-dir', ebsdAnalysisCache]
          if (urlObj.searchParams.get('reuse_cache') === '0') args.push('--force-recompute')
          analysisOptions.eta_masks = useTemp ? etaMasks.get(session) || {} : {}
          args.push('--analysis-options', JSON.stringify(analysisOptions))
          args.push('--gamma-mode', gammaMode)
          if (useTemp) {
              args.push('--uploaded', uploadDirectory!)
              activeUploads.add(session)
              res.write(`data: ${JSON.stringify({ type: 'info', message: 'Using uploaded files...' })}\n\n`)
          } else {
              res.write(`data: ${JSON.stringify({ type: 'warning', message: 'PLEASE CHECK YOUR TASKBAR FOR THE FOLDER SELECTION WINDOW! (tkinter window)' })}\n\n`)
          }

          if (coWt) args.push('--co-wt', coWt)
          if (compMap) args.push('--comp-map', compMap)
          
          if (coWt || compMap) {
              res.write(`data: ${JSON.stringify({ type: 'info', message: `Composition Mode Enabled (Per-file override supported)` })}\n\n`)
          }

          const pythonCmd = resolvePythonCommand()
          res.write(`data: ${JSON.stringify({ type: 'info', message: `Python: ${path.basename(pythonCmd)}` })}\n\n`)
          const pythonProcess = spawnPythonProcess(pythonCmd, args, projectRoot)

          let receivedResults = false
          let finished = false
          const send = (payload: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`) }
          const decoder = new StringDecoder('utf8')
          let pending = ''
          const line = (value: string) => {
            if (!value.trim()) return
            if (value.startsWith('JSON_DATA:')) {
              try {
                const payload = JSON.parse(value.slice(10))
                if (payload.type === 'result_pack') receivedResults = true
                send(payload)
              } catch { send({ type: 'error', message: '분석 결과 메시지를 읽지 못했습니다.' }) }
            } else send({ type: 'log', message: value })
          }
          pythonProcess.stdout.on('data', (chunk) => {
            pending += decoder.write(chunk)
            let newline: number
            while ((newline = pending.indexOf('\n')) >= 0) {
              line(pending.slice(0, newline).replace(/\r$/, ''))
              pending = pending.slice(newline + 1)
            }
          })
          pythonProcess.stderr.on('data', (chunk) => send({ type: 'warning', message: chunk.toString() }))
          pythonProcess.on('error', (error) => {
            send({ type: 'error', message: error.message })
          })
          pythonProcess.on('close', (code) => {
            finished = true
            if (useTemp) {
              activeUploads.delete(session)
              void removeUpload(session).catch(error => console.warn('Upload cleanup:', error.message))
            }
            pending += decoder.end()
            line(pending)
            if (code === 0 && !receivedResults) send({ type: 'error', message: '분석 결과가 생성되지 않았습니다.' })
            send({ type: 'done', code: code === 0 && receivedResults ? 0 : (code || 1) })
            res.end()
          })

          res.on('close', () => {
             if (!finished) pythonProcess.kill()
          })
          return
        }
        next()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pythonRunnerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  // Keep each installation's cache outside OneDrive and separate from others.
  cacheDir: path.join(ebsdRuntimeRoot, 'vite-cache'),
  server: {
    host: '127.0.0.1',
    strictPort: true,
    cors: false,
    allowedHosts: ['localhost'],
    fs: { strict: true, allow: [projectRoot, path.join(ebsdRuntimeRoot, 'vite-cache')], deny: ['**/.env', '**/.env.*', '**/*.{crt,pem,key,pfx,p12}', '**/.git/**', '**/token.txt', '**/launcher.log', '**/*.{ps1,cmd,bat,osc,ang}', '**/.aws/**', '**/.codex/**', '**/.agents/**', '**/analysis_results/**', '**/distribution/**'] },
    watch: { ignored: ['**/.temp_ebsd/**', '**/analysis_results/**', '**/distribution/**', '**/dist/**', '**/_update_temp/**', '**/_tools/**', '**/__pycache__/**', '**/.numba_cache/**', '**/*.osc', '**/*.ang'] },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
      ],
    },
  },
})

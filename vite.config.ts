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

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

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
  const bundledPython = path.join(projectRoot, '_tools', 'python', 'python.exe')
  if (process.platform === 'win32' && fs.existsSync(bundledPython)) {
    return bundledPython
  }

  const envPython = process.env.PYTHON_EXE?.trim()
  if (envPython && !isWindowsStorePython(envPython)) {
    if (path.isAbsolute(envPython) && fs.existsSync(envPython)) return envPython
    if (!path.isAbsolute(envPython)) return envPython
  }

  return 'python'
}

function spawnPythonProcess(pythonCmd: string, args: string[], cwd: string) {
  return spawn(pythonCmd, ['-X', 'utf8', '-u', ...args], {
    cwd, windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' },
  })
}

function pythonRunnerPlugin(): Plugin {
  return {
    name: 'python-runner',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/clear-ebsd-temp')) {
            const tempPath = path.resolve(projectRoot, 'python', '.temp_ebsd');
            if (fs.existsSync(tempPath)) {
              const files = fs.readdirSync(tempPath);
              for (const file of files) {
                try {
                  fs.rmSync(path.join(tempPath, file), { recursive: true, force: true });
                } catch (err) {
                  console.error(`Failed to remove ${file}:`, err);
                }
              }
            } else {
              fs.mkdirSync(tempPath, { recursive: true });
            }
            res.end(JSON.stringify({ success: true }));
            return;
        }

        if (req.url && req.url.startsWith('/api/upload-ebsd')) {
           const urlObj = new URL(req.url, 'http://localhost');
           const filename = urlObj.searchParams.get('filename');
           if (!filename || path.basename(filename) !== filename || !/\.(ang|osc)$/i.test(filename)) {
               res.end('No filename');
               return;
           }
           
           const tempPath = path.resolve(projectRoot, 'python', '.temp_ebsd');
           if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });
           
           const destPath = path.join(tempPath, filename);
           const writeStream = fs.createWriteStream(destPath);
           req.pipe(writeStream);
           writeStream.on('error', (error) => { res.statusCode = 500; res.end(JSON.stringify({ success: false, error: error.message })); });
           writeStream.on('finish', () => {
             const lower = filename.toLowerCase();
             if (!lower.endsWith('.osc')) {
               res.end(JSON.stringify({ success: true, file: filename }));
               return;
             }
             // Auto-convert EDAX/TSL .osc → .ang (MTEX oscData port)
             const angName = filename.replace(/\.osc$/i, '.ang');
             const angPath = path.join(tempPath, angName);
             const converter = path.join('python', 'osc_to_ang.py');
             const tempRel = path.join('python', '.temp_ebsd');
             const args = [
               converter,
               path.join(tempRel, filename),
               '-o',
               path.join(tempRel, angName),
             ];
             const py = spawnPythonProcess(resolvePythonCommand(), args, projectRoot);
             let err = '';
             py.stderr.on('data', (d) => { err += String(d); });
             py.on('close', (code) => {
               if (code !== 0 || !fs.existsSync(angPath)) {
                 res.statusCode = 500;
                 res.end(JSON.stringify({ success: false, error: err || `osc_to_ang exit ${code}` }));
                 return;
               }
               res.end(JSON.stringify({ success: true, file: angName, convertedFrom: filename }));
             });
           });
           return;
        }

        if (req.url && req.url.startsWith('/api/ebsd-results/')) {
           const requestedFile = decodeURIComponent(req.url.replace('/api/ebsd-results/', '').split('?')[0]);
           const resultsRoot = path.resolve(projectRoot, 'python', '.temp_ebsd');
           const filePath = path.resolve(resultsRoot, requestedFile);
           if (!filePath.startsWith(resultsRoot + path.sep)) { res.statusCode = 403; res.end('Invalid result path'); return; }
           if (!fs.existsSync(filePath)) {
               res.statusCode = 404;
               res.end('Not found');
               return;
           }
           
           if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
           if (filePath.endsWith('.txt')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
           if (filePath.endsWith('.csv')) res.setHeader('Content-Type', 'text/csv; charset=utf-8');
           if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
           if (filePath.endsWith('.zip')) res.setHeader('Content-Type', 'application/zip');
           
           res.setHeader('Cache-Control', 'public, max-age=0');
           res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(requestedFile)}"; filename*=UTF-8''${encodeURIComponent(requestedFile)}`);
           
           const readStream = fs.createReadStream(filePath);
           readStream.pipe(res);
           return;
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
          if (!['all_other', 'named'].includes(gammaMode)) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: '지원하지 않는 gamma상 분석 모드입니다.' })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'done', code: 2 })}\n\n`)
            res.end()
            return
          }
          
          const scriptName = 'run_ebsd.py'
          const pyPath = path.resolve(projectRoot, 'python', scriptName)
          const scriptRelPath = path.join('python', scriptName)
          const tempRelPath = path.join('python', '.temp_ebsd')

          if (!fs.existsSync(pyPath)) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: `Python script not found: ${pyPath}` })}\n\n`)
            res.write(`data: ${JSON.stringify({ type: 'done', code: 2 })}\n\n`)
            res.end()
            return
          }
          
          res.write(`data: ${JSON.stringify({ type: 'info', message: `Starting Python Analyzer (${scriptName})...` })}\n\n`)
          
          // Use relative paths + cwd to avoid Windows Korean-path encoding issues in Python argv
          const args = [scriptRelPath, '--output', tempRelPath]
          args.push('--gamma-mode', gammaMode)
          if (useTemp) {
              args.push('--uploaded', tempRelPath)
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
  // Store Vite cache in system temp dir to avoid OneDrive EPERM errors
  cacheDir: path.join(os.tmpdir(), 'autocalculator-vite-cache'),
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
      ],
    },
  },
})

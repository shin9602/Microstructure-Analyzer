import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

function pythonRunnerPlugin(): Plugin {
  return {
    name: 'python-runner',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/api/clear-ebsd-temp')) {
            const tempPath = path.resolve(process.cwd(), 'python', '.temp_ebsd');
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
           if (!filename) {
               res.end('No filename');
               return;
           }
           
           const tempPath = path.resolve(process.cwd(), 'python', '.temp_ebsd');
           if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });
           
           const writeStream = fs.createWriteStream(path.join(tempPath, filename));
           req.pipe(writeStream);
           req.on('end', () => {
             res.end(JSON.stringify({ success: true }));
           });
           return;
        }

        if (req.url && req.url.startsWith('/api/ebsd-results/')) {
           const requestedFile = decodeURIComponent(req.url.replace('/api/ebsd-results/', '').split('?')[0]);
           const filePath = path.resolve(process.cwd(), 'python', '.temp_ebsd', requestedFile);
           if (!fs.existsSync(filePath)) {
               res.statusCode = 404;
               res.end('Not found');
               return;
           }
           
           if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
           if (filePath.endsWith('.txt')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
           if (filePath.endsWith('.csv')) res.setHeader('Content-Type', 'text/csv; charset=utf-8');
           
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
          const isAdvanced = req.url.includes('advanced')
          const useTemp = urlObj.searchParams.get('temp') === '1'
          const coWt = urlObj.searchParams.get('co_wt')
          const compMap = urlObj.searchParams.get('comp_map')
          
          const scriptName = isAdvanced ? 'advanced_microstructure.py' : 'microstructure_analysis.py'
          const pyPath = path.resolve(process.cwd(), 'python', scriptName)
          const tempPath = path.resolve(process.cwd(), 'python', '.temp_ebsd')
          
          res.write(`data: ${JSON.stringify({ type: 'info', message: `Starting Python Analyzer (${scriptName})...` })}\n\n`)
          
          const args = [pyPath]
          if (useTemp) {
              args.push('--uploaded', tempPath)
              res.write(`data: ${JSON.stringify({ type: 'info', message: 'Using uploaded files...' })}\n\n`)
          } else {
              res.write(`data: ${JSON.stringify({ type: 'warning', message: 'PLEASE CHECK YOUR TASKBAR FOR THE FOLDER SELECTION WINDOW! (tkinter window)' })}\n\n`)
          }

          if (coWt) args.push('--co-wt', coWt)
          if (compMap) args.push('--comp-map', compMap)
          
          if (coWt || compMap) {
              res.write(`data: ${JSON.stringify({ type: 'info', message: `Composition Mode Enabled (Per-file override supported)` })}\n\n`)
          }

          // Use PYTHON_EXE env var from launcher, or fallback to system python/py
          const pythonCmd = process.env.PYTHON_EXE || 'python'
          const pythonProcess = spawn(pythonCmd, ['-u', ...args])

          pythonProcess.stdout.on('data', (data) => {
            const str = data.toString()
            str.split('\n').forEach((line: string) => {
              if (line.trim()) {
                res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`)
              }
            })
          })

          pythonProcess.stderr.on('data', (data) => {
            const str = data.toString()
            str.split('\n').forEach((line: string) => {
              if (line.trim()) {
                res.write(`data: ${JSON.stringify({ type: 'error', message: line })}\n\n`)
              }
            })
          })

          pythonProcess.on('close', (code) => {
            if (code === 0) {
              try {
                const allFiles = fs.readdirSync(tempPath);
                const images = allFiles.filter((f: string) => f.toLowerCase().endsWith('.png'));
                const csvFiles = allFiles.filter((f: string) => f.toLowerCase().endsWith('.csv'));
                const txtFiles = allFiles.filter((f: string) => f.toLowerCase().endsWith('.txt'));
                const resultPack = {
                  type: 'result_pack',
                  mode: isAdvanced ? 'advanced' : 'basic',
                  images,
                  csv: csvFiles[0] || '',
                  txt: txtFiles[0] || '',
                };
                res.write(`data: ${JSON.stringify(resultPack)}\n\n`);
              } catch (err) {
                console.error('Failed to scan results directory:', err);
              }
            }
            res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`)
            res.end()
          })
          
          req.on('close', () => {
             pythonProcess.kill()
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

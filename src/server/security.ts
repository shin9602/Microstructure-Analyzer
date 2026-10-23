import type { IncomingMessage } from 'node:http';

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Browser requests must come from the actual loopback origin, not a rebound host. */
export function localRequestError(req: IncomingMessage): string | null {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) return 'Local connections only';
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return 'Untrusted host';
  let target: URL;
  try { target = new URL(`http://${host}`); } catch { return 'Invalid local address'; }
  if (Number(target.port || 80) !== req.socket.localPort) return 'Unexpected local port';
  if (req.headers.origin && req.headers.origin !== target.origin) return 'Cross-origin requests are not allowed';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed';
  return null;
}

/** Block private files before Vite's static, raw-import and filesystem handlers. */
export function privateRequestPath(raw: string): boolean {
  let pathname = raw.split('?')[0];
  try {
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch { return true; }
  if (pathname.includes('\0')) return true;
  const parts = pathname.replace(/\\/g, '/').toLowerCase().split('/')
    .map(part => part.split(':')[0].replace(/[. ]+$/, ''));
  return parts.some(part => /^\.env(?:\.|$)/.test(part)
    || ['.git', '.aws', '.codex', '.agents', '.claude', 'token.txt', 'launcher.log',
      'update-manifest.json', 'analysis_results', 'distribution', '__open-in-editor'].includes(part)
    || /\.(?:ps1|cmd|bat|osc|ang|pem|key|pfx|p12)$/.test(part));
}

export function validMeasurementFilename(name: string): boolean {
  return name.length <= 180 && !/[\\/:<>"|?*\x00-\x1f]/.test(name)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    && /\.(?:ang|osc)$/i.test(name);
}

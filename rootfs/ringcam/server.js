

// server.js - Ring → ffmpeg → HLS + Home Assistant events/state
import express from "express";
import cors from "cors";
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import minimist from 'minimist';
import { RingApi } from 'ring-client-api';

const argv = minimist(process.argv.slice(2), {
  string: ['token', 'name', 'quality', 'codec', 'hwaccel', 'ha-entity', 'ha-prefix'],
  boolean: ['debug', 'ha-integration'],
  default: {
    port: 8080, quality: 'high', debug: false, codec: 'auto', hwaccel: 'auto',
    'ha-integration': true, 'ha-entity': 'binary_sensor.ring_livestream_playing', 'ha-prefix': 'ring_livestream'
  }
});

const REFRESH_TOKEN = argv.token || process.env.RING_REFRESH_TOKEN || '';
const CAMERA_NAME   = argv.name || '';
const QUALITY       = String(argv.quality || 'high').toLowerCase();
const DEBUG         = Boolean(argv.debug);
const PORT          = Number(argv.port) || 8080;
const CODEC_PREF    = String(argv.codec || 'auto').toLowerCase();   // auto|copy|h264|h264_v4l2m2m
const HWACCEL_PREF  = String(argv.hwaccel || 'auto').toLowerCase(); // auto|none

const HA_ENABLED    = Boolean(argv['ha-integration']);
const HA_ENTITY_ID  = String(argv['ha-entity']);
const HA_PREFIX     = String(argv['ha-prefix']);

if (!REFRESH_TOKEN) {
  console.error('[ring] Missing --token');
  process.exit(2);
}

console.log('[ha] SUPERVISOR_TOKEN present:', Boolean(process.env.SUPERVISOR_TOKEN));


const OUT_DIR = '/ringcam/public';
const PLAYLIST = path.join(OUT_DIR, 'stream.m3u8');


// ------- HTTP server (status & health) -------
const app = express();

app.use(cors({ origin: "*", methods: ["GET", "HEAD"] }));

function noCache(res) {
  res.set("Cache-Control", "no-store, must-revalidate");
}

// Serve HLS playlists with proper MIME type
app.get(/\.m3u8$/, (req, res, next) => {
  res.type("application/vnd.apple.mpegurl");
  noCache(res);
  next();
});

// Serve MPEG-TS segments with proper MIME type
app.get(/\.ts$/, (req, res, next) => {
  res.type("video/mp2t");
  noCache(res);
  next();
});

app.use('/public', express.static(OUT_DIR, { fallthrough: false }));
app.get('/health', (_req, res) => {
  fs.stat(PLAYLIST, (err, st) => {
    if (err) return res.status(503).json({ ok: false, reason: 'no_playlist' });
    const age = Date.now() - st.mtimeMs;
    res.status(age < 15000 ? 200 : 503).json({ ok: age < 15000, age_ms: Math.round(age), updated_at: st.mtime.toISOString() });
  });
});
app.get('/status', (_req, res) => {
  res.json({ camera: CAMERA_NAME || '(first)', quality: QUALITY, entity_id: HA_ENTITY_ID, playlist: fs.existsSync(PLAYLIST) });
});
app.get('/ls', (_req, res) => {
  res.json({ files: fs.readdirSync(OUT_DIR), realpath: fs.realpathSync(OUT_DIR) });
});
app.get('/ha-ping', async (_req, res) => {
  const r = await haFetch('/');
  if (!r) return res.status(500).json({ ok:false, reason:'no_auth' });
  const j = await r.json();
  res.json({ ok:true, mode: (resolveHaAuth()||{}).mode, keys: Object.keys(j).slice(0,5) });
});

app.get('/ha-me', async (_req, res) => {
  const r = await haFetch('/config');
  if (!r) return res.status(500).json({ ok:false, reason:'no_auth' });
  res.json(await r.json());
});
const server = http.createServer(app);

// ------- utils -------
const log = (...a) => console.log(new Date().toISOString(), ...a);
const dbg = (...a) => { if (DEBUG) console.debug(new Date().toISOString(), '[debug]', ...a); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function prepareOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (/\.(m3u8|ts|m4s|mp4)$/.test(f)) { try { fs.unlinkSync(path.join(OUT_DIR, f)); } catch {} }
  }
}

// ------- HA integration helpers (Supervisor Core API proxy) -------
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || '';
const HA_BASE = 'http://supervisor/core/api';

function resolveHaAuth() {
  if (SUPERVISOR_TOKEN) {
    return { base: HA_BASE, token: SUPERVISOR_TOKEN, mode: 'supervisor' };
  }
  if (HA_BASE_OVERRIDE && HA_USER_TOKEN) {
    return { base: HA_BASE.replace(/\/+$/,'') , token: HA_USER_TOKEN, mode: 'user' };
  }
  return null;
}

async function haFetch(path, init = {}) {
  if (!HA_ENABLED) return null;
  const auth = resolveHaAuth();
  if (!auth) {
    console.error('[ha] No auth available: SUPERVISOR_TOKEN not set and no fallback token/base provided.');
    return null;
  }
  const headers = init.headers ? new Headers(init.headers) : new Headers();
  headers.set('Authorization', `Bearer ${auth.token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const url = `${auth.base}${path}`;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    console.error('[ha] request failed', res.status, res.statusText, 'mode=', auth.mode, 'url=', path);
  }
  return res;
}

// async function haFetch(path, init = {}) {
//   if (!HA_ENABLED) return null;
//   if (!SUPERVISOR_TOKEN) { console.error('[ha] SUPERVISOR_TOKEN not present; disable ha_integration or run as HA add-on.'); return null; }
//   const headers = init.headers ? new Headers(init.headers) : new Headers();
//   headers.set('Authorization', `Bearer ${SUPERVISOR_TOKEN}`);
//   headers.set('Content-Type', 'application/json');
//   const res = await fetch(`${HA_BASE}${path}`, { ...init, headers });
//   return res;
// }

async function haFireEvent(type, data) {
  if (!HA_ENABLED) return;
  try {
    const res = await haFetch(`/events/${encodeURIComponent(type)}`, { method: 'POST', body: JSON.stringify(data || {}) });
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    dbg('[ha] event fired:', type);
  } catch (e) {
    console.error(new Date().toISOString(), '[ha] fire event failed:', e?.message || e);
  }
}

async function haSetState(entityId, state, attributes) {
  if (!HA_ENABLED) return;
  try {
    const body = { state: String(state), attributes: attributes || {} };
    const res = await haFetch(`/states/${encodeURIComponent(entityId)}`, { method: 'POST', body: JSON.stringify(body) });
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    dbg('[ha] state set:', entityId, state);
  } catch (e) {
    console.error(new Date().toISOString(), '[ha] set state failed:', e?.message || e);
  }
}

// Convenience wrappers for our specific signals
async function signalPlaying(cameraName, codecUsed) {
  const playlistUrl = `http://homeassistant.local:${PORT}/public/stream.m3u8`;
  await Promise.all([
    haFireEvent(`${HA_PREFIX}_started`, { camera: cameraName, quality: QUALITY, codec: codecUsed, playlist: playlistUrl }),
    haSetState(HA_ENTITY_ID, 'on', {
      friendly_name: 'Ring Livestream Playing',
      device_class: 'running',   // cosmetic only
      camera: cameraName,
      quality: QUALITY,
      codec: codecUsed,
      playlist: playlistUrl,
      last_change: new Date().toISOString()
    })
  ]);
}

async function signalStopped(cameraName, reason = 'stopped') {
  await Promise.all([
    haFireEvent(`${HA_PREFIX}_stopped`, { camera: cameraName, reason }),
    haSetState(HA_ENTITY_ID, 'off', {
      friendly_name: 'Ring Livestream Playing',
      device_class: 'running',
      camera: cameraName,
      reason,
      last_change: new Date().toISOString()
    })
  ]);
}

// ------- Streaming config -------
function qualityBaseArgs(q) {
  switch (q) {
    case 'low':    return ['-vf','scale=w=854:h=480:force_original_aspect_ratio=decrease','-g','48','-keyint_min','48','-b:a','96k'];
    case 'medium': return ['-vf','scale=w=1280:h=720:force_original_aspect_ratio=decrease','-g','60','-keyint_min','60','-b:a','128k'];
    default:       return ['-g','60','-keyint_min','60','-b:a','128k'];
  }
}
function codecCandidates() { return (CODEC_PREF !== 'auto') ? [CODEC_PREF] : ['copy','h264_v4l2m2m','h264']; }
function codecArgs(codec, q) {
  switch (codec) {
    case 'copy':          return ['-c:v','copy','-c:a','aac'];
    case 'h264_v4l2m2m':  return ['-c:v','h264_v4l2m2m','-b:v', q==='low'?'1200k':q==='medium'?'2500k':'4500k','-c:a','aac'];
    case 'h264':
    default:              return ['-c:v','libx264','-preset','veryfast','-b:v', q==='low'?'1200k':q==='medium'?'2500k':'4500k','-c:a','aac'];
  }
}
function hwaccelArgs(hw) { return (hw === 'none') ? [] : ['-hwaccel','auto']; }
function hlsArgs(target) {
  return ['-f','hls','-hls_time','2','-hls_list_size','5',
          '-hls_flags','delete_segments+append_list+program_date_time+independent_segments',
          '-hls_delete_threshold','10', target, "-loglevel", "debug"];
}

async function selectCamera(api) {
  const cams = await api.getCameras();
  if (!cams.length) throw new Error('No Ring cameras found.');
  if (!CAMERA_NAME) { log(`[ring] Using first camera: ${cams[0].name}`); return cams[0]; }
  const c = cams.find(x => (x.name||'').toLowerCase() === CAMERA_NAME.toLowerCase());
  if (!c) throw new Error(`Camera "${CAMERA_NAME}" not found. Have: ${cams.map(x=>x.name).join(', ')}`);
  return c;
}

async function tryStart(camera, codec) {
  const args = [...hwaccelArgs(HWACCEL_PREF), ...codecArgs(codec, QUALITY), ...qualityBaseArgs(QUALITY), ...hlsArgs(PLAYLIST)];
  log(`[ring] Starting stream "${camera.name}" codec=${codec} quality=${QUALITY}`);
  log('ffmpeg args:', args.join(' '));
  const stream = await camera.streamVideo({ output: args });
  const stop = typeof stream === 'function' ? stream : (stream?.stop ? () => stream.stop() : () => {});
  return { stop, used: codec };
}

async function startStreaming(camera) {
  const order = codecCandidates();
  for (let i = 0; i < order.length; i++) {
    try {
      return await tryStart(camera, order[i]);
    } catch (e) {
      console.error(new Date().toISOString(), `[ring] Start failed with codec=${order[i]}:`, e?.message || e);
      if (i === order.length - 1) throw e;
      log('[ring] Falling back to next codec…');
    }
  }
  throw new Error('No codec worked');
}

// ------- main -------
async function main() {
  prepareOutDir();

  const api = new RingApi({
    refreshToken: REFRESH_TOKEN,
    cameraDingPollingSeconds: 0,
    logger: DEBUG ? console : undefined,
    ffmpegPath: "ffmpeg"
  });

  if (typeof api.onRefreshTokenUpdated === 'function') {
    api.onRefreshTokenUpdated(({ newRefreshToken, oldRefreshToken }) => {
      if (newRefreshToken && newRefreshToken !== oldRefreshToken) {
        log('[ring] Refresh token rotated (not persisted by this add-on).');
      }
    });
  }

  const cam = await selectCamera(api);

  server.listen(PORT, () => {
    log(`[http] HLS under /public on port ${PORT}`);
    log(`[http] Playlist: http://homeassistant.local:${PORT}/public/stream.m3u8`);
  });

  let stopping = false;
  process.on('SIGTERM', async () => { stopping = true; server.close(() => log('[http] closed')); await signalStopped(cam.name, 'shutdown'); });

  // Push initial "off" so the entity exists immediately (nice for dashboards)
  if (HA_ENABLED) await haSetState(HA_ENTITY_ID, 'off', { friendly_name: 'Ring Livestream Playing', device_class: 'running' });

  let backoff = 3000;
  const MAX_BACKOFF = 30000;

  while (!stopping) {
    let stopper = null;
    let usedCodec = 'unknown';
    try {
      const started = await startStreaming(cam);
      stopper = started.stop;
      usedCodec = started.used;
      backoff = 3000;

      // mark as playing as soon as playlist begins to update
      let last = 0;
      let announced = false;

      while (!stopping) {
        await sleep(5000);
        const st = fs.existsSync(PLAYLIST) ? fs.statSync(PLAYLIST) : null;
        const mt = st ? st.mtimeMs : 0;

        if (mt && !last) {
          log('[ring] HLS playlist created.');
        }
        if (!announced && mt) {
          announced = true;
          await signalPlaying(cam.name, usedCodec);
        }
        if (last && mt && mt === last) {
          throw new Error('HLS stalled');
        }
        last = mt;
      }
    } catch (e) {
      console.error(new Date().toISOString(), '[ring] Stream error:', e?.message || e);
      await signalStopped(cam.name, 'error_or_stall');
    } finally {
      try { await Promise.resolve(typeof stopper === 'function' ? stopper() : null); } catch {}
    }

    if (stopping) break;
    log(`[ring] Restarting in ${(backoff/1000)|0}s…`);
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  }
  log('[sys] Exit.');
}

main().catch(async e => {
  console.error(new Date().toISOString(), '[fatal]', e?.stack || e);
  // Best-effort "stopped" signal on fatal
  try { await signalStopped(CAMERA_NAME || '(unknown)', 'fatal'); } catch {}
  process.exit(1);
});

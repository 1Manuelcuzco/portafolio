import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

const base = 'https://1manuelcuzco.github.io/portafolio/para-ti/';
const branch = 'para-ti-envios';
const path = 'registro.json';
const repo = process.env.GITHUB_REPOSITORY;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const idOk = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
function urlOk(value) {
  const url = new URL(value);
  if (!value.startsWith(base) || url.origin !== 'https://1manuelcuzco.github.io' ||
      !url.pathname.startsWith('/portafolio/para-ti/') || url.username || url.password || url.search || url.hash) throw Error('URL fuera de Para ti');
  return url;
}
async function github(route, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${route}`, {
    method, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw Error(`GitHub: HTTP ${response.status}`);
  return response.json();
}
async function published(url, expected) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(urlOk(url), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.equals(expected)) return;
      }
    } catch { /* La publicación puede tardar en estar disponible. */ }
    if (attempt < 11) await sleep(10000);
  }
  throw Error(`La copia publicada no coincide: ${url}`);
}
async function main() {
  const raw = await readFile('public/para-ti/catalogo.json');
  const catalog = JSON.parse(raw);
  if (catalog.version !== 1 || !Array.isArray(catalog.detalles)) throw Error('Catálogo inválido');
  const ids = new Set(), ads = new Set();
  for (const detail of catalog.detalles) {
    if (!idOk(detail.id) || ids.has(detail.id)) throw Error('ID de detalle inválido o repetido');
    ids.add(detail.id); urlOk(detail.url); urlOk(detail.imagen);
    const ad = detail.notificacion;
    if (ad) {
      if (!idOk(ad.id) || ads.has(ad.id)) throw Error('ID de anuncio inválido o repetido');
      ads.add(ad.id);
      if (typeof ad.titulo !== 'string' || !ad.titulo.trim() || ad.titulo.length > 120 ||
          typeof ad.mensaje !== 'string' || !ad.mensaje.trim() || ad.mensaje.length > 400) throw Error('Texto de aviso inválido');
    }
  }
  if (process.argv.includes('--comprobar')) {
    console.log('Catálogo y payload comprobados localmente; sin red ni envío.'); return;
  }
  await published(`${base}catalogo.json`, raw);
  const candidates = catalog.detalles.filter(d => d.visible === true && d.notificacion?.habilitada === true);
  for (const d of candidates) {
    for (const value of [d.url, d.imagen]) {
      const url = urlOk(value);
      const relative = decodeURIComponent(url.pathname.slice('/portafolio/para-ti/'.length));
      if (relative.split('/').some(part => part === '..' || part.includes('\\'))) throw Error('Ruta inválida');
      await published(value, await readFile(`public/para-ti/${relative}${url.pathname.endsWith('/') ? 'index.html' : ''}`));
    }
  }
  if (!await github(`git/ref/heads/${branch}`)) {
    await github('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: process.env.GITHUB_SHA });
  }
  let file = await github(`contents/${path}?ref=${branch}`);
  const state = file ? JSON.parse(Buffer.from(file.content, 'base64').toString()) : { version: 1, anuncios: {} };
  if (state.version !== 1 || !state.anuncios) throw Error('Registro inválido');
  async function save(message) {
    const result = await github(`contents/${path}`, 'PUT', { message, branch,
      content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'), ...(file ? { sha: file.sha } : {}) });
    file = result.content;
  }
  const pending = candidates.filter(d => !state.anuncios[d.notificacion.id]);
  if (!pending.length) { console.log('Sin anuncios nuevos.'); return; }
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')}`;
  const auth = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }), signal: AbortSignal.timeout(15000) });
  if (!auth.ok) throw Error(`Autenticación Firebase: HTTP ${auth.status}`);
  const { access_token: token } = await auth.json();
  if (!token || !/^[a-z0-9-]+$/.test(account.project_id)) throw Error('Configuración Firebase inválida');
  for (const d of pending) {
    const ad = d.notificacion;
    // Reservar ANTES de enviar: un resultado incierto requiere revisión, nunca reenvío automático.
    state.anuncios[ad.id] = { estado: 'pendiente_revision', detalleId: d.id, fecha: new Date().toISOString(), run: process.env.GITHUB_RUN_ID };
    await save(`Reservar aviso ${ad.id}`);
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { topic: 'fisioapp_para_ti', data: { detalleId: d.id, anuncioId: ad.id,
        titulo: ad.titulo, mensaje: ad.mensaje, imagen: d.imagen }, android: { priority: 'normal', ttl: '86400s' } } }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error(`FCM: HTTP ${response.status}; revisar reserva ${ad.id} antes de reintentar`);
    const result = await response.json();
    if (!result.name) throw Error('Respuesta FCM incierta; revisar reserva');
    state.anuncios[ad.id].estado = 'aceptado_fcm';
    state.anuncios[ad.id].mensaje = result.name;
    await save(`Registrar aviso ${ad.id}`);
    console.log(`Aceptado por FCM: ${ad.id}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

/* ================================================================
   Conexión con OneDrive (Microsoft Graph)
   - Login con tu cuenta Microsoft usando OAuth 2.0 + PKCE (sin secretos)
   - El archivo de datos vive en TU OneDrive; acá sólo se lee y se escribe
   - Cada guardado usa el eTag del archivo: si cambió desde que lo leímos,
     el guardado se rechaza en vez de pisar lo que haya
   ================================================================ */
const CFG_KEY = 'prestamos.cfg';
const TOK_KEY = 'prestamos.rt';
const AUTORIDAD = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const AMBITO = 'offline_access User.Read Files.ReadWrite';
const GRAPH = 'https://graph.microsoft.com/v1.0';

const cfgLeer = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } };
const cfgGuardar = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { } };
let CFG = Object.assign({ clientId: '', ruta: 'PRÉSTAMOS/prestamos.json', carpeta: 'PRÉSTAMOS' }, cfgLeer());

/* dirección exacta a registrar en Azure como URI de redirección */
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');

let TOKEN = null, TOKEN_EXP = 0, USUARIO = null;
let ETAG = null;                       // versión del archivo que tenemos cargado
let ESTADO = 'inicio';                 // inicio | sin-config | desconectado | cargando | listo | error
let ERROR = '';

/* ---------- PKCE ---------- */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function aleatorio(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
async function reto(verifier) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); }

async function iniciarLogin() {
  if (!CFG.clientId) throw new Error('Falta el ID de aplicación');
  const verifier = aleatorio(48), estado = aleatorio(12);
  sessionStorage.setItem('pkce', verifier);
  sessionStorage.setItem('pkce_estado', estado);
  const p = new URLSearchParams({
    client_id: CFG.clientId, response_type: 'code', redirect_uri: REDIRECT,
    response_mode: 'query', scope: AMBITO, state: estado,
    code_challenge: await reto(verifier), code_challenge_method: 'S256'
  });
  location.href = AUTORIDAD + '/authorize?' + p;
}

async function pedirToken(cuerpo) {
  const r = await fetch(AUTORIDAD + '/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: CFG.clientId, redirect_uri: REDIRECT }, cuerpo))
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Error de autenticación');
  TOKEN = j.access_token; TOKEN_EXP = Date.now() + (j.expires_in - 120) * 1000;
  if (j.refresh_token) { try { localStorage.setItem(TOK_KEY, j.refresh_token); } catch (e) { } }
  return TOKEN;
}

/* devuelve un token válido, renovándolo si hace falta */
async function token() {
  if (TOKEN && Date.now() < TOKEN_EXP) return TOKEN;
  const rt = localStorage.getItem(TOK_KEY);
  if (!rt) return null;
  try { return await pedirToken({ grant_type: 'refresh_token', refresh_token: rt, scope: AMBITO }); }
  catch (e) { localStorage.removeItem(TOK_KEY); return null; }
}

/* si volvemos del login, canjea el código por el token */
async function procesarVuelta() {
  const q = new URLSearchParams(location.search);
  if (q.get('error')) { limpiarURL(); throw new Error(q.get('error_description') || q.get('error')); }
  const code = q.get('code'); if (!code) return false;
  const verifier = sessionStorage.getItem('pkce');
  if (q.get('state') !== sessionStorage.getItem('pkce_estado')) { limpiarURL(); throw new Error('Respuesta de login inválida'); }
  await pedirToken({ grant_type: 'authorization_code', code, code_verifier: verifier });
  sessionStorage.removeItem('pkce'); sessionStorage.removeItem('pkce_estado');
  limpiarURL();
  return true;
}
const limpiarURL = () => history.replaceState(null, '', REDIRECT + location.hash);

function desconectar() {
  TOKEN = null; TOKEN_EXP = 0; USUARIO = null; ETAG = null;
  localStorage.removeItem(TOK_KEY);
  location.hash = '#/conexion'; location.reload();
}

/* ---------- Graph ---------- */
async function api(url, opt) {
  const t = await token();
  if (!t) throw new Error('Sesión vencida');
  opt = opt || {};
  const r = await fetch(url.startsWith('http') ? url : GRAPH + url, Object.assign({}, opt, {
    headers: Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {})
  }));
  if (r.status === 401) { TOKEN = null; throw new Error('Sesión vencida'); }
  return r;
}
const rutaAPI = (ruta) => '/me/drive/root:/' + ruta.split('/').map(encodeURIComponent).join('/');

async function quienSoy() {
  const r = await api('/me');
  if (!r.ok) return null;
  const j = await r.json();
  USUARIO = j.userPrincipalName || j.mail || j.displayName;
  return USUARIO;
}

/* lee el archivo de datos; devuelve null si todavía no existe */
async function bajarDatos() {
  const m = await api(rutaAPI(CFG.ruta));
  if (m.status === 404) return null;
  if (!m.ok) throw new Error('No se pudo leer el archivo (' + m.status + ')');
  const meta = await m.json();
  ETAG = meta.eTag;
  const c = await api(rutaAPI(CFG.ruta) + ':/content');
  if (!c.ok) throw new Error('No se pudo bajar el contenido (' + c.status + ')');
  return await c.json();
}

/* escribe el archivo. Si alguien lo cambió desde que lo leímos, no lo pisa. */
async function subirDatos(datos, forzar) {
  datos.actualizado = new Date().toISOString();
  const cabeceras = { 'Content-Type': 'application/json' };
  if (ETAG && !forzar) cabeceras['if-match'] = ETAG;
  const r = await api(rutaAPI(CFG.ruta) + ':/content', {
    method: 'PUT', headers: cabeceras, body: JSON.stringify(datos)
  });
  if (r.status === 412) { const e = new Error('conflicto'); e.conflicto = true; throw e; }
  if (!r.ok) throw new Error('No se pudo guardar (' + r.status + ')');
  const meta = await r.json();
  ETAG = meta.eTag;
  return meta;
}

/* deja un archivo cualquiera (por ejemplo un xlsx del cierre) en una carpeta */
async function subirArchivo(carpeta, nombre, blob, tipo) {
  const r = await api(rutaAPI(carpeta + '/' + nombre) + ':/content', {
    method: 'PUT', headers: { 'Content-Type': tipo || 'application/octet-stream' }, body: blob
  });
  if (!r.ok) throw new Error('No se pudo subir ' + nombre + ' (' + r.status + ')');
  return await r.json();
}

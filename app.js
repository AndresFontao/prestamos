/* ================================================================
   Préstamos — gestión de créditos
   ================================================================ */
let DB = null;   // se carga desde OneDrive
const $ = (s, r) => (r || document).querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------- formato ------------------------- */
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $$ = (n) => n == null || isNaN(n) ? '—' : '$ ' + nf0.format(Math.round(n));
const pct = (n, d = 2) => n == null ? '—' : (n * 100).toFixed(d).replace('.', ',') + '%';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const D = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fDate = (s) => s ? (() => { const d = D(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })() : '—';
const fLargo = (s) => { const d = D(s); return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); };
const mKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const mLabel = (k) => { const [y, m] = k.split('-').map(Number); return MES3[m - 1] + '-' + String(y).slice(2); };
const mLargo = (k) => { const [y, m] = k.split('-').map(Number); return MESES[m - 1] + ' ' + y; };
const addM = (k, n) => { let [y, m] = k.split('-').map(Number); const t = (y * 12 + m - 1) + n; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); };
const mDiff = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by * 12 + bm) - (ay * 12 + am); };

const HOY = new Date();
const MES_HOY = mKey(HOY);

/* ------------------------- reglas del negocio ------------------------- */
// Última cuota = FIN.MES(entregado; n) - 10   (fórmula del libro madre)
const eomonth = (d, k) => new Date(d.getFullYear(), d.getMonth() + k + 1, 0);
const menos10 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 10);
const fechaCobro = (entregado, i) => menos10(eomonth(D(entregado), i));
const techo = (x) => Math.ceil(x - 1e-9);

function tasaVigente(fechaIso) {
  let t = DB.tasas[0];
  for (const x of DB.tasas) if (x.desde <= fechaIso) t = x;
  return t;
}
function calcular(capital, ncuot, tasa, gasto) {
  gasto = gasto || 0;
  const tem = tasa.tem;
  const factor = tem * ncuot + 1;
  const devol = capital * factor;
  const pura = techo(capital / ncuot);
  const cuota = techo(devol / ncuot + gasto / ncuot);
  const interes = devol - capital;
  const intCuota = cuota - pura;
  const adm = intCuota * (tasa.tAdm / tem);
  const inv = intCuota * (tasa.tInv / tem);
  return { tem, factor, devol, pura, cuota, interes, intCuota, adm, inv, emp: intCuota - adm - inv };
}
// Cuotas: la nº i se imputa al mes (entrega + i-1) y se cobra el 20/21 del mes siguiente
function cuotasDe(p) {
  const out = [];
  const m0 = D(p.entregado); const base = mKey(m0);
  for (let i = 1; i <= p.ncuot; i++) {
    out.push({ i, mes: addM(base, i - 1), cobro: iso(fechaCobro(p.entregado, i)), importe: p.cuota });
  }
  return out;
}
const persona = (id) => DB.personas.find(x => x.id === id) || {};
const numSiEs = (v) => v && /^\d+$/.test(String(v).trim()) ? +String(v).trim() : (v || '');
const nombreDe = (p) => (persona(p.pid).nombre) || '—';
const activo = (p, ref) => p.ultCuota > (ref || iso(HOY));
function cuotasPagadas(p, ref) {
  const r = ref || iso(HOY); let k = 0;
  for (const c of cuotasDe(p)) if (c.cobro <= r) k++;
  return Math.min(k, p.ncuot);
}
function saldo(p, ref) { return (p.ncuot - cuotasPagadas(p, ref)) * p.cuota; }

/* Retiros: el interés de cada cuota se reparte en Administración, Empresa e Inversión.
   El retiro de un mes es la suma de esas partes de las cuotas imputadas a ese mes,
   y se cobra el 20 del mes siguiente. */
function retiros() {
  const m = new Map();
  DB.prestamos.forEach(p => cuotasDe(p).forEach(c => {
    const o = m.get(c.mes) || { mes: c.mes, adm: 0, emp: 0, inv: 0 };
    o.adm += p.adm || 0; o.emp += p.emp || 0; o.inv += p.inv || 0;
    m.set(c.mes, o);
  }));
  /* Para los meses ya cobrados manda lo efectivamente retirado, que quedó registrado
     en el libro histórico. De hoy en adelante, la proyección calculada. */
  const hoy = iso(HOY);
  const real = new Map((DB.retiros || []).map(r => [r.fecha, r]));
  const salida = [];
  [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes)).forEach(o => {
    const fecha = addM(o.mes, 1) + '-20';
    const h = real.get(fecha);
    const usarReal = fecha <= hoy && h && (h.adm || h.emp || h.inv);
    const dif = usarReal && (Math.abs(h.adm - o.adm) > 1 || Math.abs(h.emp - o.emp) > 1 || Math.abs(h.inv - o.inv) > 1);
    salida.push({
      mes: o.mes, fecha,
      adm: usarReal ? h.adm : o.adm, emp: usarReal ? h.emp : o.emp, inv: usarReal ? h.inv : o.inv,
      real: !!usarReal, proyectado: fecha > hoy,
      calc: dif ? o : null
    });
  });
  return salida;
}

/* flujo: mes -> importe total a cobrar */
function flujoPorMes(lista) {
  const m = new Map();
  for (const p of (lista || DB.prestamos)) for (const c of cuotasDe(p)) m.set(c.mes, (m.get(c.mes) || 0) + c.importe);
  return m;
}

/* ------------------------- números en letras ------------------------- */
const UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE'];
const DEC = ['', '', 'VEINTI', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function centenas(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  let s = '';
  const c = Math.floor(n / 100), r = n % 100;
  if (c) s += CEN[c];
  if (r) {
    if (s) s += ' ';
    if (r <= 20) s += UNI[r];
    else {
      const d = Math.floor(r / 10), u = r % 10;
      s += d === 2 ? 'VEINTI' + UNI[u].toLowerCase().toUpperCase() : DEC[d] + (u ? ' Y ' + UNI[u] : '');
      if (d === 2 && !u) s = s.replace('VEINTI', 'VEINTE');
    }
  }
  return s;
}
function enLetras(n) {
  n = Math.round(n);
  if (n === 0) return 'CERO';
  const mill = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), res = n % 1000;
  let s = '';
  if (mill) s += (mill === 1 ? 'UN MILLON' : centenas(mill) + ' MILLONES');
  if (mil) s += (s ? ' ' : '') + (mil === 1 ? 'MIL' : centenas(mil) + ' MIL');
  if (res) s += (s ? ' ' : '') + centenas(res);
  return s;
}

/* ------------------------- gráficos ------------------------- */
function showTip(e, html) { const t = $('#tip'); if (!t) return; t.innerHTML = html; t.style.opacity = 1; moveTip(e); }
function moveTip(e) {
  const t = $('#tip'); if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.left = Math.min(e.clientX + 12, innerWidth - r.width - 8) + 'px';
  t.style.top = Math.max(8, e.clientY - r.height - 10) + 'px';
}
const hideTip = () => { const t = $('#tip'); if (t) t.style.opacity = 0; };

const kFmt = (v) => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',') + 'M' : nf0.format(Math.round(v / 1000)) + 'k';

function ejeY(max, W, PL, PT, PB, H, tick) {
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const y = PT + (H - PB - PT) * (i / 2);
    g += `<line class="gl" x1="${PL}" y1="${y}" x2="${W - 4}" y2="${y}"/>`;
    g += `<text x="${PL - 7}" y="${y + 4}" text-anchor="end">${(tick || kFmt)(max * (1 - i / 2))}</text>`;
  }
  return g;
}

function barChart(datos, opt) {
  opt = opt || {};
  const W = Math.max(320, opt.W || 640), H = opt.px || 190, PL = 46, PB = 24, PT = 10;
  const max = Math.max(1, ...datos.map(d => d.v));
  const n = datos.length, bw = (W - PL - 4) / n;
  const paso = Math.ceil(n / Math.max(3, Math.floor((W - PL) / 62)));
  let bars = '', labs = '';
  datos.forEach((d, i) => {
    const h = (H - PB - PT) * (d.v / max);
    const x = PL + i * bw + bw * 0.15, w = Math.max(2, bw * 0.7), y = H - PB - h;
    bars += `<rect class="bar" x="${x.toFixed(1)}" y="${(d.v > 0 ? y : H - PB - 1).toFixed(1)}" width="${w.toFixed(1)}"
      height="${Math.max(d.v > 0 ? h : 0, d.v > 0 ? 2 : 0).toFixed(1)}" rx="2"
      data-t="${esc('<b>' + d.label + '</b> · ' + $$(d.v) + (d.sub ? ' · ' + d.sub : ''))}"></rect>`;
    if (i % paso === 0) labs += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
    ${ejeY(max, W, PL, PT, PB, H, opt.tick)}
    <line class="ax" x1="${PL}" y1="${H - PB}" x2="${W - 4}" y2="${H - PB}"/>${bars}${labs}</svg>`;
}

function multiLine(series, labels, opt) {
  opt = opt || {};
  const W = Math.max(320, opt.W || 640), H = opt.px || 190, PL = 46, PB = 24, PT = 10;
  const max = Math.max(1, ...series.flatMap(s => s.v));
  const n = labels.length;
  const X = i => PL + (W - PL - 8) * (n === 1 ? .5 : i / (n - 1));
  const Y = v => H - PB - (H - PB - PT) * (v / max);
  const paso = Math.ceil(n / Math.max(3, Math.floor((W - PL) / 58)));
  let paths = '', hit = '', labs = '';
  series.forEach(s => {
    paths += `<path d="${s.v.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')}"
      fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  labels.forEach((l, i) => {
    hit += `<rect x="${(X(i) - (W - PL) / n / 2).toFixed(1)}" y="0" width="${((W - PL) / n).toFixed(1)}" height="${H - PB}"
      fill="transparent" data-t="${esc('<b>' + l + '</b><br>' + series.map(s => s.name + ': ' + $$(s.v[i])).join('<br>'))}"></rect>`;
    if (i % paso === 0) labs += `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
    ${ejeY(max, W, PL, PT, PB, H, opt.tick)}
    <line class="ax" x1="${PL}" y1="${H - PB}" x2="${W - 4}" y2="${H - PB}"/>${paths}${hit}${labs}</svg>`;
}

/* dibuja midiendo el ancho real del contenedor (y redibuja al cambiar de tamaño) */
let REDRAW = [], CH_COL = [], CH_RET = [];
function pintarChart(sel, fn) {
  const n = $(sel); if (!n) return;
  const go = () => { n.innerHTML = fn(n.clientWidth || 640); };
  go(); REDRAW.push(go);
}
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => REDRAW.forEach(f => f()), 180); });

/* ------------------------- navegación ------------------------- */
const ICON = {
  inicio: '<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1z"/>',
  prest: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 8h14M7 12h6"/>',
  pers: '<circle cx="10" cy="7" r="3"/><path d="M4 17c0-3.3 2.7-5 6-5s6 1.7 6 5"/>',
  cierre: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2v4M13 2v4M7.5 12.5l2 2 3.5-4"/>',
  anal: '<path d="M3 17V9M8 17V4M13 17v-6M18 17v-9"/>',
  calc: '<rect x="4" y="2" width="12" height="16" rx="2"/><path d="M7 6h6M7 10h1.5M7 13.5h1.5M11.5 10H13M11.5 13.5H13"/>',
  nube: '<path d="M6 16h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 5.5 8 3.5 3.5 0 0 0 6 16z"/>'
};
const PAGES = [
  ['', 'Inicio', 'inicio'], ['prestamos', 'Préstamos', 'prest'], ['personas', 'Personas', 'pers'],
  ['cierre', 'Cierre de mes', 'cierre'], ['analisis', 'Análisis', 'anal'], ['calculador', 'Calculador', 'calc'],
  ['conexion', 'Conexión', 'nube']
];
function renderNav(cur) {
  $('#nav').innerHTML =
    `<div class="brand"><div><b>Préstamos</b><span>Gestión de créditos</span></div></div>` +
    PAGES.map(([h, t, i]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[i]}</svg>
      <span>${t}</span></a>`).join('');
}

/* ================================================================
   PANTALLAS
   ================================================================ */

function vInicio() {
  const act = DB.prestamos.filter(p => activo(p));
  const cartera = act.reduce((a, p) => a + saldo(p), 0);
  const anio = HOY.getFullYear();
  const delAnio = DB.prestamos.filter(p => p.entregado.startsWith(anio));
  const fl = flujoPorMes();
  const aCobrar = fl.get(MES_HOY) || 0;

  const meses = []; for (let i = 23; i >= 0; i--) meses.push(addM(MES_HOY, -i));
  const colocado = new Map();
  DB.prestamos.forEach(p => { const k = p.entregado.slice(0, 7); colocado.set(k, (colocado.get(k) || 0) + p.capital); });
  CH_COL = meses.map(k => ({ label: mLabel(k), v: colocado.get(k) || 0 }));

  const dup = duplicados(MES_HOY);
  const term = porTerminar(3);
  const ult = [...DB.prestamos].slice(-8).reverse();

  return `
  <div class="head"><div><h1>Inicio</h1><p>${mLargo(MES_HOY)} · ${DB.prestamos.length} préstamos históricos</p></div></div>
  <div class="grid tiles">
    <div class="tile"><div class="k">Cartera activa</div><div class="v">${$$(cartera)}</div><div class="s">${act.length} préstamos vigentes</div></div>
    <div class="tile"><div class="k">A cobrar este mes</div><div class="v">${$$(aCobrar)}</div><div class="s">imputado a ${mLabel(MES_HOY)}</div></div>
    <div class="tile"><div class="k">Colocado en ${anio}</div><div class="v">${$$(delAnio.reduce((a, p) => a + p.capital, 0))}</div><div class="s">${delAnio.length} préstamos</div></div>
    <div class="tile"><div class="k">Tasa vigente</div><div class="v">${pct(tasaVigente(iso(HOY)).tem)}</div><div class="s">mensual · TEA ${pct(Math.pow(1 + tasaVigente(iso(HOY)).tem, 12) - 1, 1)}</div></div>
  </div>

  <div class="sec"><h2>Capital colocado por mes</h2>
    <div class="card pad"><div id="ch-col"></div></div>
  </div>

  <div class="two sec">
    <div><h2>Requieren atención</h2>
      ${dup.length ? `<div class="warnbox"><b>${dup.length} persona${dup.length > 1 ? 's' : ''} con más de un descuento en ${mLabel(MES_HOY)}</b><br>
        ${dup.map(d => esc(d.nombre) + ' — ' + d.cuotas.length + ' cuotas, ' + $$(d.total)).join('<br>')}</div>` : ''}
      <div class="card"><div class="tw"><table>
        <thead><tr><th>Termina en ≤3 meses</th><th>Última cuota</th><th class="num">Saldo</th></tr></thead>
        <tbody>${term.length ? term.slice(0, 8).map(p => `<tr class="click" data-go="#/prestamo/${p.id}">
          <td>${esc(nombreDe(p))}</td><td>${fDate(p.ultCuota)}</td><td class="num">${$$(saldo(p))}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">Nada por vencer</td></tr>'}</tbody></table></div></div>
    </div>
    <div><h2>Últimos préstamos</h2>
      <div class="card"><div class="tw"><table>
        <thead><tr><th>N°</th><th>Persona</th><th class="num">Capital</th><th>Entrega</th></tr></thead>
        <tbody>${ult.map(p => `<tr class="click" data-go="#/prestamo/${p.id}"><td>${esc(p.oc)}</td>
          <td>${esc(nombreDe(p))}</td><td class="num">${$$(p.capital)}</td><td>${fDate(p.entregado)}</td></tr>`).join('')}
        </tbody></table></div></div>
    </div>
  </div>`;
}

/* ------------------------- préstamos ------------------------- */
let fPrest = { q: '', estado: '', empresa: '', anio: '' };
let selPrest = new Set(), soloSel = false;
function vPrestamos() {
  const anios = [...new Set(DB.prestamos.map(p => p.entregado.slice(0, 4)))].sort().reverse();
  return `
  <div class="head"><div><h1>Préstamos</h1><p>${DB.prestamos.length} en total</p></div>
    <a class="btn pri" href="#/nuevo"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>Nuevo préstamo</a></div>
  <div class="f">
    <input class="search" type="text" id="q" placeholder="Buscar por nombre, N° o CUIL…" value="${esc(fPrest.q)}">
    <select id="estado"><option value="">Todos</option><option value="a">Activos</option><option value="p">Pagados</option></select>
    <select id="empresa"><option value="">Toda empresa</option>${DB.empresas.map(e => `<option>${esc(e)}</option>`).join('')}</select>
    <select id="anio"><option value="">Todo año</option>${anios.map(a => `<option>${a}</option>`).join('')}</select>
    <button class="btn" id="copiar">Copiar tabla</button>
    <span class="hint" id="pmsg" style="margin:0"></span>
  </div>
  <div id="lista"></div>`;
}
function filtrar() {
  const q = fPrest.q.trim().toLowerCase();
  return DB.prestamos.filter(p => {
    const pe = persona(p.pid);
    if (fPrest.estado === 'a' && !activo(p)) return false;
    if (fPrest.estado === 'p' && activo(p)) return false;
    if (fPrest.empresa && pe.empresa !== fPrest.empresa) return false;
    if (fPrest.anio && !p.entregado.startsWith(fPrest.anio)) return false;
    if (q && !((pe.nombre || '').toLowerCase().includes(q) || String(p.oc).includes(q) || (pe.cuil || '').includes(q))) return false;
    if (soloSel && !selPrest.has(p.id)) return false;
    return true;
  }).reverse();
}
function pintarLista() {
  const r = filtrar();
  const tot = r.reduce((a, p) => a + p.capital, 0);
  const vis = r.slice(0, 400);
  const todosMarcados = vis.length && vis.every(p => selPrest.has(p.id));
  $('#lista').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 9px">
      <span style="color:var(--muted);font-size:13px">${r.length} préstamos · ${$$(tot)} de capital</span>
      ${selPrest.size ? `<span class="pill act">${selPrest.size} seleccionado${selPrest.size > 1 ? 's' : ''}</span>
        <button class="btn" id="verSel" style="padding:4px 10px;font-size:12.5px">${soloSel ? 'Ver todos' : 'Ver sólo estos'}</button>
        <button class="btn" id="limpiarSel" style="padding:4px 10px;font-size:12.5px">Limpiar</button>` : ''}
    </div>
    <div class="card"><div class="tw"><table>
      <thead><tr><th style="width:34px"><input type="checkbox" id="chkAll" ${todosMarcados ? 'checked' : ''}></th>
        <th>N°</th><th>Persona</th><th>Empresa</th><th class="num">Capital</th><th class="num">Cuotas</th>
        <th class="num">Cuota</th><th>Entrega</th><th>Últ. cuota</th><th>Estado</th></tr></thead>
      <tbody>${vis.map(p => { const pe = persona(p.pid), a = activo(p), m = selPrest.has(p.id);
        return `<tr class="click" data-go="#/prestamo/${p.id}"${m ? ' style="background:var(--accent-soft)"' : ''}>
          <td><input type="checkbox" class="chk" data-id="${p.id}" ${m ? 'checked' : ''}></td>
          <td>${esc(p.oc)}</td><td>${esc(pe.nombre)}</td><td style="color:var(--ink-2)">${esc(pe.empresa || '—')}</td>
          <td class="num">${$$(p.capital)}</td><td class="num">${p.ncuot}</td><td class="num">${$$(p.cuota)}</td>
          <td>${fDate(p.entregado)}</td><td>${fDate(p.ultCuota)}</td>
          <td><span class="pill dot ${a ? 'act' : 'pag'}">${a ? 'Activo' : 'Pagado'}</span></td></tr>`; }).join('')}
      </tbody></table></div></div>
    ${r.length > 400 ? '<p class="hint">Mostrando los primeros 400 en pantalla. El botón Copiar usa los ' + r.length + ' filtrados.</p>' : ''}`;

  $('#lista').querySelectorAll('.chk').forEach(c => c.addEventListener('change', e => {
    const id = +e.target.dataset.id;
    e.target.checked ? selPrest.add(id) : selPrest.delete(id);
    if (soloSel && !selPrest.size) soloSel = false;
    pintarLista();
  }));
  on('#chkAll', 'change', e => {
    vis.forEach(p => e.target.checked ? selPrest.add(p.id) : selPrest.delete(p.id));
    if (soloSel && !selPrest.size) soloSel = false;
    pintarLista();
  });
  on('#verSel', 'click', () => { soloSel = !soloSel; pintarLista(); });
  on('#limpiarSel', 'click', () => { selPrest.clear(); soloSel = false; pintarLista(); });
}

/* copia los préstamos filtrados como tabla, lista para pegar en un mail o una planilla */
async function copiarPrestamos() {
  const r = filtrar();
  if (!r.length) { aviso('No hay préstamos para copiar', true); return; }
  const cab = ['N°', 'PERSONA', 'CAPITAL', 'CUIL', 'TELEFONO', 'EMPRESA'];
  const filas = r.map(p => { const x = persona(p.pid);
    return [String(p.oc), x.nombre || '', nf0.format(p.capital), x.cuil || '', x.telefono || '', x.empresa || '']; });
  const bd = '1px solid #d0d0d0';
  const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">
    <tr>${cab.map((c, i) => `<th style="border:${bd};background:#f2f2f2;padding:4px 9px;text-align:${i === 2 ? 'right' : 'left'}">${c}</th>`).join('')}</tr>
    ${filas.map(f => `<tr>${f.map((c, j) => `<td style="border:${bd};padding:4px 9px;text-align:${j === 2 ? 'right' : 'left'}">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  const texto = [cab.join('\t'), ...filas.map(f => f.join('\t'))].join('\n');
  const msg = (t) => { const n = $('#pmsg'); if (n) { n.textContent = t; setTimeout(() => { if (n) n.textContent = ''; }, 3500); } };
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([texto], { type: 'text/plain' })
    })]);
    msg(r.length + ' préstamos copiados ✓  pegalos con Ctrl+V');
  } catch (e) {
    try { await navigator.clipboard.writeText(texto); msg('Copiados como texto ✓'); }
    catch (e2) { msg('No se pudo copiar'); }
  }
}

function vPrestamo(id) {
  const p = DB.prestamos.find(x => x.id === +id);
  if (!p) return `<div class="empty">No encontrado</div>`;
  const pe = persona(p.pid), a = activo(p), pag = cuotasPagadas(p);
  const cs = cuotasDe(p);
  return `
  <div class="head"><div>
    <h1>Préstamo N° ${esc(p.oc)}</h1>
    <p>${esc(pe.nombre)} · ${esc(pe.empresa || 'sin empresa')} · <span class="pill dot ${a ? 'act' : 'pag'}">${a ? 'Activo' : 'Pagado'}</span></p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn" href="#/persona/${pe.id}">Ver persona</a>
      <a class="btn" href="#/editar/${p.id}">Corregir</a>
      <a class="btn pri" href="#/doc/${p.id}">Documentos</a></div></div>

  <div class="two">
    <div class="card pad"><h3 style="margin-bottom:11px">Condiciones</h3><dl class="dl">
      <dt>Capital</dt><dd>${$$(p.capital)}</dd>
      <dt>Tasa mensual</dt><dd>${pct(p.tem)}</dd>
      <dt>Cuotas</dt><dd>${p.ncuot}</dd>
      <dt>Factor</dt><dd>${p.factor ? p.factor.toFixed(6).replace('.', ',') : '—'}</dd>
      <dt>Devolución</dt><dd>${$$(p.devol)}</dd>
      <dt>Interés total</dt><dd>${$$(p.interes)}</dd>
      <dt>Cuota</dt><dd>${$$(p.cuota)}</dd>
      <dt>Capital / cuota</dt><dd>${$$(p.pura)}</dd>
      <dt>Interés / cuota</dt><dd>${$$(p.intCuota)}</dd>
    </dl></div>
    <div class="card pad"><h3 style="margin-bottom:11px">Estado y reparto</h3><dl class="dl">
      <dt>Entregado</dt><dd>${fDate(p.entregado)}</dd>
      <dt>Última cuota</dt><dd>${fDate(p.ultCuota)}</dd>
      <dt>Cuotas cobradas</dt><dd>${pag} de ${p.ncuot}</dd>
      <dt>Saldo</dt><dd>${$$(saldo(p))}</dd>
      <dt>Autorizado</dt><dd>${p.autorizado ? 'Sí' : 'No'}</dd>
      <dt>Adm. / cuota</dt><dd>${$$(p.adm)}</dd>
      <dt>Empresa / cuota</dt><dd>${$$(p.emp)}</dd>
      <dt>Inversión / cuota</dt><dd>${$$(p.inv)}</dd>
    </dl></div>
  </div>

  <div class="sec"><h2>Plan de cuotas</h2>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>#</th><th>Se imputa a</th><th>Se cobra el</th><th class="num">Importe</th><th class="num">Capital</th><th class="num">Interés</th><th>Estado</th></tr></thead>
      <tbody>${cs.map(c => `<tr><td>${c.i}</td><td>${mLargo(c.mes)}</td><td>${fDate(c.cobro)}</td>
        <td class="num">${$$(c.importe)}</td><td class="num">${$$(p.pura)}</td><td class="num">${$$(p.intCuota)}</td>
        <td><span class="pill ${c.cobro <= iso(HOY) ? 'pag' : 'act'}">${c.cobro <= iso(HOY) ? 'cobrada' : 'pendiente'}</span></td></tr>`).join('')}
      </tbody></table></div></div>
    <p class="hint">La cuota se imputa al mes de trabajo y se descuenta del sueldo que se cobra el mes siguiente.</p>
  </div>`;
}

/* ---- combobox de personas con buscador ---- */
function comboPersona(id, onPick) {
  const cont = $('#' + id); if (!cont) return;
  const inp = $('#' + id + '-q'), lista = $('#' + id + '-l'), hid = $('#' + id + '-v');
  let opts = [], marca = -1;
  const datos = [...DB.personas].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const cerrar = () => { lista.style.display = 'none'; marca = -1; };
  const pintar = () => {
    const q = inp.value.trim().toLowerCase();
    opts = datos.filter(x => !q || x.nombre.toLowerCase().includes(q) || (x.cuil || '').includes(q) || (x.dni || '').includes(q)).slice(0, 60);
    lista.innerHTML = opts.length ? opts.map((x, i) =>
      `<div data-i="${i}" class="${i === marca ? 'sel' : ''}">${esc(x.nombre)}
        <small>${esc([x.empresa || 'sin empresa', x.cuil ? 'CUIL ' + x.cuil : 'sin CUIL'].join(' · '))}</small></div>`).join('')
      : `<div class="nada">Sin resultados</div>`;
    lista.style.display = 'block';
  };
  const elegir = (i) => {
    const x = opts[i]; if (!x) return;
    hid.value = x.id; inp.value = x.nombre; cerrar(); onPick && onPick(x);
  };
  inp.addEventListener('focus', pintar);
  inp.addEventListener('input', () => { hid.value = ''; marca = -1; pintar(); onPick && onPick(null); });
  inp.addEventListener('keydown', e => {
    if (lista.style.display !== 'block') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); marca = Math.max(0, Math.min(opts.length - 1, marca + (e.key === 'ArrowDown' ? 1 : -1)));
      pintar(); const n = lista.children[marca]; if (n) n.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); elegir(marca < 0 ? 0 : marca); }
    else if (e.key === 'Escape') cerrar();
  });
  lista.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); elegir(+d.dataset.i); } });
  document.addEventListener('mousedown', e => { if (!cont.contains(e.target)) cerrar(); });
}
const htmlCombo = (id, ph) => `<div class="cbox" id="${id}">
  <input type="text" id="${id}-q" placeholder="${ph}" autocomplete="off">
  <input type="hidden" id="${id}-v">
  <div class="list" id="${id}-l" style="display:none"></div></div>`;

/* ------------------------- alta ------------------------- */
function vNuevo() {
  const t = tasaVigente(iso(HOY));
  return `
  <div class="head"><div><h1>Nuevo préstamo</h1><p>Tasa vigente ${pct(t.tem)} mensual · desde ${fDate(t.desde)}</p></div></div>

  <div class="two">
    <div class="card pad">
      <div class="fg"><label class="fl">Persona</label>
        ${htmlCombo('np', 'Buscar por nombre, CUIL o DNI…')}
        <div class="hint" id="npi">Escribí para buscar entre las ${DB.personas.length} personas del maestro.</div></div>
      <div class="fg"><label class="fl">Capital</label><input type="number" id="ncap" value="500000" step="10000" min="1000"></div>
      <div class="fg"><label class="fl">Cantidad de cuotas</label><input type="number" id="nc" value="6" min="1" max="24"></div>
      <div class="fg"><label class="fl">Fecha de entrega</label><input type="date" id="nf" value="${iso(HOY)}"></div>
      <div class="fg"><label class="fl">Gastos administrativos</label><input type="number" id="ng" value="0" step="1000">
        <div class="hint">Se prorratea en la cuota. Normalmente 0.</div></div>
      <button class="btn pri" id="nsave">Registrar préstamo</button>
    </div>
    <div><div class="card pad" id="nprev"></div>
      <div class="card pad" style="margin-top:14px" id="nplan"></div></div>
  </div>`;
}
function previewNuevo() {
  const cap = +$('#ncap').value || 0, n = +$('#nc').value || 1, f = $('#nf').value || iso(HOY), g = +$('#ng').value || 0;
  const t = tasaVigente(f), c = calcular(cap, n, t, g);
  const pid = +($('#np-v') || {}).value; const pe = pid ? persona(pid) : null;
  $('#npi').textContent = pe ? [pe.cuil ? 'CUIL ' + pe.cuil : 'sin CUIL', pe.dni ? 'DNI ' + pe.dni : 'sin DNI', pe.telefono || 'sin teléfono'].join(' · ')
    : `Escribí para buscar entre las ${DB.personas.length} personas del maestro.`;
  const uc = iso(menos10(eomonth(D(f), n)));
  const prox = DB.prestamos.reduce((a, p) => Math.max(a, Math.floor(p.n || 0)), 0) + 1;
  $('#nprev').innerHTML = `<h3 style="margin-bottom:11px">Cálculo · N° ${prox}</h3><dl class="dl">
    <dt>Tasa aplicada</dt><dd>${pct(t.tem)} <span style="color:var(--muted);font-weight:400">mensual</span></dd>
    <dt>Factor</dt><dd>${c.factor.toFixed(6).replace('.', ',')}</dd>
    <dt>Devolución</dt><dd>${$$(c.devol)}</dd>
    <dt>Interés total</dt><dd>${$$(c.interes)}</dd>
    <dt style="color:var(--ink);font-weight:650">Cuota</dt><dd style="font-size:19px">${$$(c.cuota)}</dd>
    <dt>Última cuota</dt><dd>${fDate(uc)}</dd>
    <dt>Adm/Emp/Inv</dt><dd style="font-size:12.5px">${$$(c.adm)} / ${$$(c.emp)} / ${$$(c.inv)}</dd></dl>`;
  const base = f.slice(0, 7);
  $('#nplan').innerHTML = `<h3 style="margin-bottom:11px">Plan de cuotas</h3><table>
    <thead><tr><th>#</th><th>Mes</th><th>Cobro</th><th class="num">Importe</th></tr></thead><tbody>
    ${Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td><td>${mLargo(addM(base, i))}</td>
      <td>${fDate(iso(fechaCobro(f, i + 1)))}</td><td class="num">${$$(c.cuota)}</td></tr>`).join('')}
    </tbody></table>`;
}

/* ------------------------- personas ------------------------- */
let qPers = '';
function vPersonas() {
  return `<div class="head"><div><h1>Personas</h1><p>${DB.personas.length} en el maestro</p></div>
    <a class="btn pri" href="#/persona-nueva"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>Nueva persona</a></div>
  <div class="f"><input class="search" type="text" id="qp" placeholder="Buscar por nombre, CUIL o DNI…" value="${esc(qPers)}"></div>
  <div id="lp"></div>`;
}
function pintarPersonas() {
  const q = qPers.trim().toLowerCase();
  const stats = new Map();
  DB.prestamos.forEach(p => {
    const s = stats.get(p.pid) || { n: 0, cap: 0, act: 0, ult: '' };
    s.n++; s.cap += p.capital; if (activo(p)) s.act++;
    if (p.entregado > s.ult) s.ult = p.entregado;
    stats.set(p.pid, s);
  });
  const r = DB.personas.filter(x => !q || (x.nombre.toLowerCase().includes(q) || (x.cuil || '').includes(q) || (x.dni || '').includes(q)))
    .sort((a, b) => (stats.get(b.id)?.ult || '').localeCompare(stats.get(a.id)?.ult || ''));
  $('#lp').innerHTML = `<p style="color:var(--muted);font-size:13px;margin:0 0 9px">${r.length} personas</p>
    <div class="card"><div class="tw"><table>
    <thead><tr><th>Nombre</th><th>Empresa</th><th>CUIL</th><th class="num">Préstamos</th><th class="num">Total prestado</th><th>Último</th><th>Estado</th></tr></thead>
    <tbody>${r.map(x => { const s = stats.get(x.id) || { n: 0, cap: 0, act: 0, ult: '' };
      return `<tr class="click" data-go="#/persona/${x.id}"><td>${esc(x.nombre)}</td>
        <td style="color:var(--ink-2)">${esc(x.empresa || '—')}</td><td style="font-variant-numeric:tabular-nums">${esc(x.cuil || '—')}</td>
        <td class="num">${s.n}</td><td class="num">${$$(s.cap)}</td><td>${s.ult ? fDate(s.ult) : '—'}</td>
        <td>${s.act ? '<span class="pill dot act">Con saldo</span>' : '<span class="pill pag">Al día</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
}
function vPersonaNueva() {
  return `<div class="head"><div><h1>Nueva persona</h1><p>Alta en el maestro</p></div>
    <a class="btn" href="#/personas">← Volver</a></div>

  <div class="two">
    <div class="card pad">
      <div class="fg"><label class="fl">Apellido y nombre</label><input type="text" id="pn" placeholder="APELLIDO, NOMBRE"></div>
      <div class="fg"><label class="fl">CUIL</label><input type="text" id="pc" placeholder="20123456789" inputmode="numeric"></div>
      <div class="fg"><label class="fl">DNI</label><input type="text" id="pd" placeholder="12345678" inputmode="numeric"></div>
      <div class="fg"><label class="fl">Teléfono</label><input type="text" id="pt" placeholder="2615566163"></div>
    </div>
    <div class="card pad">
      <div class="fg"><label class="fl">Empresa</label>
        <select id="pe"><option value="">— Sin asignar —</option>${DB.empresas.map(e => `<option>${esc(e)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">Provincia</label><input type="text" id="pp" value="MENDOZA"></div>
      <div class="fg"><label class="fl">Sexo</label><select id="ps"><option value="">— Sin especificar —</option><option>F</option><option>M</option></select></div>
      <div class="fg"><label class="fl">Estado</label><select id="pst"><option>Activo</option><option>BAJA</option></select></div>
      <button class="btn pri" id="pgo">Dar de alta</button>
      <div class="hint" id="pmsg"></div>
    </div>
  </div>`;
}
function altaPersona() {
  const nombre = $('#pn').value.trim();
  if (!nombre) { $('#pmsg').textContent = 'Falta el apellido y nombre.'; $('#pn').focus(); return; }
  const dup = DB.personas.find(x => x.nombre.trim().toLowerCase() === nombre.toLowerCase());
  if (dup) { $('#pmsg').innerHTML = `Ya existe <b>${esc(dup.nombre)}</b> en el maestro.`; return; }
  const soloNum = (v) => String(v || '').replace(/\D/g, '') || null;
  const p = {
    id: Math.max(0, ...DB.personas.map(x => x.id)) + 1, nombre,
    cuil: soloNum($('#pc').value), dni: soloNum($('#pd').value), telefono: soloNum($('#pt').value),
    empresa: $('#pe').value || null, provincia: $('#pp').value.trim() || null,
    sexo: $('#ps').value || null, status: $('#pst').value
  };
  DB.personas.push(p);
  guardar('Persona dada de alta ✓');
  location.hash = '#/persona/' + p.id;
}

function vPersona(id) {
  const x = persona(+id);
  if (!x.id) return `<div class="empty">No encontrada</div>`;
  const ps = DB.prestamos.filter(p => p.pid === x.id).reverse();
  const cap = ps.reduce((a, p) => a + p.capital, 0);
  const act = ps.filter(p => activo(p));
  return `<div class="head"><div><h1>${esc(x.nombre)}</h1>
    <p>${esc(x.empresa || 'sin empresa')} · ${ps.length} préstamos · ${$$(cap)} prestado en total</p></div></div>
  <div class="two">
    <div class="card pad"><h3 style="margin-bottom:11px">Datos</h3>
      <div class="fg"><label class="fl">Apellido y nombre</label><input type="text" id="ed-nombre" value="${esc(x.nombre)}"></div>
      <div class="fg"><label class="fl">CUIL</label><input type="text" id="ed-cuil" value="${esc(x.cuil || '')}" placeholder="sin cargar"></div>
      <div class="fg"><label class="fl">DNI</label><input type="text" id="ed-dni" value="${esc(x.dni || '')}" placeholder="sin cargar"></div>
      <div class="fg"><label class="fl">Teléfono</label><input type="text" id="ed-tel" value="${esc(x.telefono || '')}" placeholder="sin cargar"></div>
      <div class="fg"><label class="fl">Empresa</label>
        <select id="ed-emp"><option value="">— Sin asignar —</option>${DB.empresas.map(e => `<option ${e === x.empresa ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">Provincia</label><input type="text" id="ed-prov" value="${esc(x.provincia || '')}" placeholder="sin cargar"></div>
      <div class="fg"><label class="fl">Estado</label>
        <select id="ed-st"><option ${x.status !== 'BAJA' ? 'selected' : ''}>Activo</option><option ${x.status === 'BAJA' ? 'selected' : ''}>BAJA</option></select></div>
      <button class="btn pri" id="ed-go">Guardar cambios</button>
    </div>
    <div><div class="card pad"><h3 style="margin-bottom:11px">Resumen</h3><dl class="dl">
      <dt>Préstamos</dt><dd>${ps.length}</dd>
      <dt>Vigentes</dt><dd>${act.length}</dd>
      <dt>Saldo actual</dt><dd>${$$(act.reduce((a, p) => a + saldo(p), 0))}</dd>
      <dt>Capital promedio</dt><dd>${$$(ps.length ? cap / ps.length : 0)}</dd>
      <dt>Cuotas promedio</dt><dd>${ps.length ? (ps.reduce((a, p) => a + p.ncuot, 0) / ps.length).toFixed(1).replace('.', ',') : '—'}</dd>
      <dt>Primer préstamo</dt><dd>${ps.length ? fDate(ps[ps.length - 1].entregado) : '—'}</dd></dl></div></div>
  </div>
  <div class="sec"><h2>Historial</h2><div class="card"><div class="tw"><table>
    <thead><tr><th>N°</th><th class="num">Capital</th><th class="num">Cuotas</th><th class="num">Cuota</th><th>Entrega</th><th>Últ. cuota</th><th>Estado</th></tr></thead>
    <tbody>${ps.map(p => `<tr class="click" data-go="#/prestamo/${p.id}"><td>${esc(p.oc)}</td>
      <td class="num">${$$(p.capital)}</td><td class="num">${p.ncuot}</td><td class="num">${$$(p.cuota)}</td>
      <td>${fDate(p.entregado)}</td><td>${fDate(p.ultCuota)}</td>
      <td><span class="pill dot ${activo(p) ? 'act' : 'pag'}">${activo(p) ? 'Activo' : 'Pagado'}</span></td></tr>`).join('')}
    </tbody></table></div></div></div>`;
}

/* ------------------------- análisis ------------------------- */
function duplicados(mes) {
  const m = new Map();
  DB.prestamos.forEach(p => cuotasDe(p).forEach(c => {
    if (c.mes !== mes) return;
    const k = p.pid; const o = m.get(k) || { pid: k, nombre: nombreDe(p), cuotas: [], total: 0 };
    o.cuotas.push({ oc: p.oc, importe: c.importe, i: c.i, n: p.ncuot }); o.total += c.importe; m.set(k, o);
  }));
  return [...m.values()].filter(o => o.cuotas.length > 1).sort((a, b) => b.total - a.total);
}
function porTerminar(meses) {
  const lim = iso(new Date(HOY.getFullYear(), HOY.getMonth() + meses, HOY.getDate()));
  return DB.prestamos.filter(p => activo(p) && p.ultCuota <= lim).sort((a, b) => a.ultCuota.localeCompare(b.ultCuota));
}
/* número en formato wa.me (Argentina) */
function waNumero(tel) {
  let n = String(tel || '').replace(/\D/g, '');
  if (n.length < 8) return null;
  if (n.startsWith('549')) return n;
  if (n.startsWith('54')) return '549' + n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  if (n.startsWith('15')) n = n.slice(2);
  return '549' + n;
}
const TXT_PROPUESTA = 'Hola. Estás por terminar de cancelar tu préstamo. Avisame si necesitás renovar. Saludos.';

/* tabla de capital nominal: año x mes */
function capitalPorMes() {
  const m = new Map();
  DB.prestamos.forEach(p => {
    const y = p.entregado.slice(0, 4), mm = +p.entregado.slice(5, 7) - 1;
    const o = m.get(y) || { cap: new Array(12).fill(0), q: new Array(12).fill(0) };
    o.cap[mm] += p.capital; o.q[mm]++; m.set(y, o);
  });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

let mesAnalisis = MES_HOY;
function vAnalisis() {
  const rs = retiros();
  const iProy = rs.findIndex(r => r.mes >= MES_HOY);
  const cpm = capitalPorMes();
  const ultAnio = cpm[cpm.length - 1], prevAnio = cpm[cpm.length - 2];
  const mesActual = +MES_HOY.slice(5) - 1, anioActual = String(HOY.getFullYear());

  const porAnio = new Map();
  DB.prestamos.forEach(p => {
    const y = p.entregado.slice(0, 4); const o = porAnio.get(y) || { cap: 0, n: 0, int: 0, cuot: 0 };
    o.cap += p.capital; o.n++; o.int += p.interes || 0; o.cuot += p.ncuot; porAnio.set(y, o);
  });
  const anios = [...porAnio.keys()].sort();

  const varia = (i) => {
    if (!prevAnio) return null;
    if (ultAnio[0] === anioActual && i > mesActual) return null;   // mes que todavía no ocurrió
    const a = ultAnio[1].cap[i], b = prevAnio[1].cap[i];
    return b ? a / b - 1 : null;
  };
  const totUlt = ultAnio[1].cap.reduce((a, b) => a + b, 0), totPrev = prevAnio ? prevAnio[1].cap.reduce((a, b) => a + b, 0) : 0;

  return `<div class="head"><div><h1>Análisis</h1><p>${DB.prestamos.length} préstamos desde 2018</p></div></div>

  <div class="sec"><h2>Retiros</h2>
    <div class="card"><div class="tw" id="twret" style="max-height:none"><table>
      <thead><tr><th style="left:0;position:sticky;z-index:2;background:var(--surface)">RETIROS</th>
        ${rs.map((r, i) => `<th class="num" style="${iProy >= 0 && i >= iProy ? 'color:var(--accent)' : ''}">${fDate(r.fecha)}</th>`).join('')}</tr></thead>
      <tbody>${[['ADMINISTRACIÓN', 'adm'], ['EMPRESA', 'emp'], ['INVERSIÓN', 'inv']].map(([t, k]) =>
        `<tr><td style="left:0;position:sticky;background:var(--surface);font-weight:600">${t}</td>
        ${rs.map(r => `<td class="num"${r.calc ? ` style="border-bottom:2px solid var(--serious)" data-t="${
          esc('Retirado ' + nf0.format(Math.round(r[k])) + '<br>Calculado ' + nf0.format(Math.round(r.calc[k])))}"` : ''
        }>${nf0.format(Math.round(r[k] || 0))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>
    <p class="hint">Cada retiro es la suma de las partes de interés de las cuotas imputadas a ese mes, y se cobra el 20 del mes siguiente.
      Hasta hoy se muestra lo efectivamente retirado; ${iProy >= 0 ? `desde ${fDate(rs[iProy].fecha)}` : 'hacia adelante'} es proyección de los préstamos ya colocados.
      ${rs.filter(r => r.calc).length ? `<b>${rs.filter(r => r.calc).length} meses</b> (subrayados) tienen un retiro distinto del calculado — pasá el mouse para ver los dos.` : ''}
      Total: ${$$(rs.reduce((a, r) => a + r.adm + r.emp + r.inv, 0))}.</p></div>

  <div class="sec"><h2>Capital nominal por mes</h2>
    <div class="card"><div class="tw" id="twcap" style="max-height:340px"><table class="tcomp">
      <thead><tr><th>AÑO</th><th>Values</th>${MES3.map(m => `<th class="num">${m}</th>`).join('')}
        <th class="num">Total</th></tr></thead>
      <tbody>
      ${cpm.map(([y, o]) => { const g = y === anioActual ? ' style="background:var(--surface-2)"' : '';
        return `<tr${g}><td rowspan="2" style="font-weight:650;vertical-align:top">${y}</td>
          <td style="color:var(--ink-2);white-space:nowrap">Suma de CAPITAL</td>
          ${o.cap.map(v => `<td class="num">${v ? nf0.format(v) : 0}</td>`).join('')}
          <td class="num"><b>${nf0.format(o.cap.reduce((a, b) => a + b, 0))}</b></td></tr>
        <tr${g}><td style="color:var(--ink-2);white-space:nowrap">Cant. préstamos</td>
          ${o.q.map(v => `<td class="num">${v}</td>`).join('')}
          <td class="num"><b>${o.q.reduce((a, b) => a + b, 0)}</b></td></tr>`; }).join('')}
      <tr><td></td><td style="font-weight:650;white-space:nowrap">VAR% interanual</td>
        ${MESES.map((_, i) => { const v = varia(i);
          return `<td class="num" style="color:${v == null ? 'var(--muted)' : v < 0 ? 'var(--crit)' : 'var(--good)'}">${
            v == null ? '—' : (v > 0 ? '+' : '') + pct(v, 0)}</td>`; }).join('')}
        <td class="num" style="font-weight:650;color:${!totPrev ? 'var(--muted)' : totUlt / totPrev - 1 < 0 ? 'var(--crit)' : 'var(--good)'}">${
          totPrev ? ((totUlt / totPrev - 1 > 0 ? '+' : '') + pct(totUlt / totPrev - 1, 0)) : '—'}</td></tr>
      </tbody></table></div></div>
    <p class="hint">La variación compara ${ultAnio[0]} contra ${prevAnio ? prevAnio[0] : '—'}. Los meses de ${anioActual} que todavía no ocurrieron quedan sin dato.</p></div>

  <div class="sec"><h2>Capital y rentabilidad por año</h2><div class="card"><div class="tw"><table>
    <thead><tr><th>Año</th><th class="num">Préstamos</th><th class="num">Capital</th><th class="num">Interés</th>
      <th class="num">Rentab.</th><th class="num">Capital prom.</th><th class="num">Cuotas prom.</th></tr></thead>
    <tbody>${anios.map(y => { const o = porAnio.get(y);
      return `<tr><td><b>${y}</b></td><td class="num">${o.n}</td><td class="num">${$$(o.cap)}</td>
        <td class="num">${$$(o.int)}</td><td class="num">${pct(o.int / o.cap, 1)}</td>
        <td class="num">${$$(o.cap / o.n)}</td><td class="num">${(o.cuot / o.n).toFixed(1).replace('.', ',')}</td></tr>`; }).join('')}
    </tbody></table></div></div>
    <p class="hint">Rentabilidad = interés total sobre capital colocado, nominal y sin ajustar por inflación.</p></div>

  <div class="sec"><h2>Más de un descuento en el mismo mes</h2>
    <div class="f"><input type="month" id="ma" value="${mesAnalisis}"><span class="hint" style="margin:0">Personas a las que se les descuenta más de una cuota</span></div>
    <div id="dupbox"></div></div>

  <div class="sec"><h2>Clientes que están terminando de pagar</h2>
    <div class="card"><div class="tw"><table>
      <thead><tr><th>Persona</th><th>Empresa</th><th>N°</th><th class="num">Cuotas restantes</th>
        <th class="num">Saldo</th><th>Última cuota</th><th></th></tr></thead>
      <tbody>${porTerminar(4).map(p => { const x = persona(p.pid), w = waNumero(x.telefono);
        return `<tr><td class="click" data-go="#/prestamo/${p.id}">${esc(x.nombre)}</td>
        <td style="color:var(--ink-2)">${esc(x.empresa || '—')}</td><td>${esc(p.oc)}</td>
        <td class="num">${p.ncuot - cuotasPagadas(p)}</td><td class="num">${$$(saldo(p))}</td><td>${fDate(p.ultCuota)}</td>
        <td>${w ? `<a class="btn" style="padding:5px 11px;font-size:12.5px" target="_blank" rel="noopener"
            href="https://wa.me/${w}?text=${encodeURIComponent(TXT_PROPUESTA)}">Enviar propuesta</a>`
          : `<span class="hint" style="margin:0">sin teléfono</span>`}</td></tr>`; }).join('')
      || '<tr><td colspan="7" class="empty">Sin préstamos por terminar en 4 meses</td></tr>'}</tbody></table></div></div>
    <p class="hint">Candidatos naturales para ofrecer una renovación.</p></div>`;
}
function pintarDup() {
  const d = duplicados(mesAnalisis);
  $('#dupbox').innerHTML = d.length ? `<div class="card"><div class="tw"><table>
    <thead><tr><th>Persona</th><th class="num">Descuentos</th><th>Detalle</th><th class="num">Total del mes</th></tr></thead>
    <tbody>${d.map(o => `<tr><td>${esc(o.nombre)}</td><td class="num">${o.cuotas.length}</td>
      <td style="color:var(--ink-2);font-size:12.5px">${o.cuotas.map(c => `N° ${esc(c.oc)} (cuota ${c.i}/${c.n}) ${$$(c.importe)}`).join(' · ')}</td>
      <td class="num"><b>${$$(o.total)}</b></td></tr>`).join('')}</tbody></table></div></div>`
    : `<div class="card"><div class="empty">Nadie con más de un descuento en ${mLargo(mesAnalisis)}</div></div>`;
}

/* ------------------------- calculador ------------------------- */
function vCalculador() {
  const t = tasaVigente(iso(HOY));
  return `<div class="head"><div><h1>Calculador</h1><p>Tasa vigente ${pct(t.tem)} mensual</p></div></div>
  <div class="two">
    <div class="card pad">
      <div class="fg"><label class="fl">Capital</label><input type="number" id="ccap" value="500000" step="50000"></div>
      <div class="fg"><label class="fl">Tasa mensual</label><input type="number" id="ctem" value="${(t.tem * 100).toFixed(4)}" step="0.1">
        <div class="hint">En porcentaje. Por defecto, la vigente.</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg"><label class="fl">Cuotas desde</label><input type="number" id="cmin" value="4" min="1" max="60"></div>
        <div class="fg"><label class="fl">Cuotas hasta</label><input type="number" id="cmax" value="7" min="1" max="60"></div>
      </div>
      <div id="cout"></div>
    </div>
    <div class="card pad"><h3 style="margin-bottom:11px">Comparativa de plazos</h3><div id="ccmp"></div></div>
  </div>
  <div class="sec"><h2>Imagen para mandar por WhatsApp</h2>
    <div class="f"><button class="btn pri" id="cshare">Compartir / copiar imagen</button>
      <button class="btn" id="cdown">Descargar PNG</button><span class="hint" id="cmsg" style="margin:0"></span></div>
    <div class="card pad" style="display:flex;justify-content:center"><div id="cprev"></div></div>
    <p class="hint">Desde el celular abre el menú de compartir y podés mandarla directo a un contacto de WhatsApp.
      Desde la computadora se copia al portapapeles y la pegás en el chat con Ctrl+V.</p></div>`;
}
function rangoCuotas() {
  let a = Math.round(+$('#cmin').value) || 1, b = Math.round(+$('#cmax').value) || 1;
  a = Math.min(60, Math.max(1, a)); b = Math.min(60, Math.max(1, b));
  if (b < a) { const z = a; a = b; b = z; }
  return [a, Math.min(b, a + 23)];
}
function tablaCalc() {
  const cap = +$('#ccap').value || 0;
  // el input muestra la tasa redondeada; si no la tocaste, usamos la exacta
  const exacta = tasaVigente(iso(HOY)).tem, vista = (+$('#ctem').value || 0) / 100;
  const tem = Math.abs(vista - exacta) < 5e-7 ? exacta : vista;
  const [a, b] = rangoCuotas();
  const t = { tem, tAdm: tem * 0.296552, tInv: tem * 0.271724 };
  const filas = [];
  for (let n = a; n <= b; n++) filas.push(Object.assign({ n }, calcular(cap, n, t, 0)));
  return { cap, tem, filas };
}
function calcular2() {
  const { cap, tem, filas } = tablaCalc();
  const tea = Math.pow(1 + tem, 12) - 1;
  $('#cout').innerHTML = `<dl class="dl"><dt>TEM</dt><dd>${pct(tem)}</dd>
    <dt>TEA equivalente</dt><dd>${pct(tea, 1)}</dd>
    <dt>TNA (simple)</dt><dd>${pct(tem * 12, 1)}</dd></dl>`;
  $('#ccmp').innerHTML = `<table><thead><tr><th class="num">Cuotas</th><th class="num">Cuota</th>
    <th class="num">Devolución</th><th class="num">Interés</th><th class="num">Costo</th></tr></thead><tbody>
    ${filas.map(f => `<tr><td class="num"><b>${f.n}</b></td><td class="num">${$$(f.cuota)}</td><td class="num">${$$(f.devol)}</td>
      <td class="num">${$$(f.interes)}</td><td class="num">${cap ? pct(f.interes / cap, 0) : '—'}</td></tr>`).join('')}
    </tbody></table>`;
  dibujarImagen();
}

/* ---- imagen para WhatsApp ---- */
function canvasCalc() {
  const { cap, filas } = tablaCalc();
  const R = 3, W = 250, padX = 17, headH = 52, thH = 32, rowH = 44, padB = 8;
  const H = headH + thH + filas.length * rowH + padB;
  const cv = document.createElement('canvas');
  cv.width = W * R; cv.height = H * R; cv.style.width = '100%'; cv.style.maxWidth = W + 'px'; cv.style.height = 'auto';
  const c = cv.getContext('2d'); c.scale(R, R);
  const F = (p, w) => `${w || 400} ${p}px system-ui,-apple-system,"Segoe UI",sans-serif`;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
  /* encabezado — se achica solo si el capital es muy largo */
  const enc = 'Capital = ' + nf0.format(Math.round(cap));
  let fs = 18;
  c.font = F(fs, 650);
  while (c.measureText(enc).width > W - padX * 2 && fs > 11) { fs -= .5; c.font = F(fs, 650); }
  c.fillStyle = '#0b0b0b'; c.textAlign = 'left'; c.fillText(enc, padX, 34);
  /* títulos */
  const ty = headH;
  c.fillStyle = '#f3f5f8'; c.fillRect(0, ty, W, thH);
  c.fillStyle = '#6b6b68'; c.font = F(10, 650);
  c.textAlign = 'left'; c.fillText('CUOTAS', padX, ty + 21);
  c.textAlign = 'right'; c.fillText('IMPORTE', W - padX, ty + 21);
  /* filas */
  filas.forEach((f, i) => {
    const y = ty + thH + i * rowH;
    if (i % 2) { c.fillStyle = '#fafbfc'; c.fillRect(0, y, W, rowH); }
    c.strokeStyle = '#e9eaec'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y + .5); c.lineTo(W, y + .5); c.stroke();
    c.fillStyle = '#0b0b0b'; c.textAlign = 'left'; c.font = F(22, 650);
    c.fillText(String(f.n), padX, y + 30);
    c.textAlign = 'right'; c.font = F(22, 650);
    c.fillText(nf0.format(f.cuota), W - padX, y + 30);
  });
  c.strokeStyle = '#dfe1e4'; c.lineWidth = 1; c.strokeRect(.5, .5, W - 1, H - 1);
  return cv;
}
function dibujarImagen() {
  const box = $('#cprev'); if (!box) return;
  box.innerHTML = ''; box.appendChild(canvasCalc());
}
const cmsg = (t) => { const n = $('#cmsg'); if (n) { n.textContent = t; setTimeout(() => { if (n) n.textContent = ''; }, 3000); } };
function blobCalc() { return new Promise(r => canvasCalc().toBlob(r, 'image/png')); }
async function compartirImagen() {
  const blob = await blobCalc();
  const file = new File([blob], 'prestamo.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] }); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    cmsg('Imagen copiada ✓  pegala con Ctrl+V');
  } catch (e) { descargarImagen(); cmsg('Se descargó el PNG'); }
}
async function descargarImagen() {
  const blob = await blobCalc();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `prestamo ${nf0.format(+$('#ccap').value || 0)}.png`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ------------------------- documentos ------------------------- */
function vDoc(id) {
  const p = DB.prestamos.find(x => x.id === +id);
  if (!p) return `<div class="empty">No encontrado</div>`;
  const x = persona(p.pid);
  const ciudad = (x.provincia || DB.entidad.ciudad || 'MENDOZA').toUpperCase();
  const linea = (t) => `<span class="fill">&nbsp;${esc(t || '')}&nbsp;</span>`;
  const E = DB.entidad;
  const cab = `<div class="hd">
      <img class="l" src="logo.jpg" alt=""><img class="r" src="logo2.jpg" alt="">
      <b>${esc(E.nombre.replace(' Argentina', ''))}</b><b>Argentina</b>
      <small>${esc(E.matricula)}</small><small>${esc(E.direccion)}</small>
      <a>${esc(E.email)}</a></div>`;
  return `
  <div class="docbar noprint">
    <a class="btn" href="#/prestamo/${p.id}">← Volver</a>
    <button class="btn pri" onclick="print()">Imprimir / Guardar PDF</button>
    <span class="hint" style="margin:0">3 páginas: orden de crédito, recibo y pagaré</span>
  </div>

  <div class="doc"> ${cab}
    <div style="text-align:right;margin-bottom:5mm">${esc(ciudad)},&nbsp; ${fLargo(p.entregado)}</div>
    <div class="row"><span>ORDEN DE CRÉDITO N°:</span><b>${esc(p.oc)}</b><span style="margin-left:auto">ASOCIADO N°:</span>${linea(x.asociado)}</div>
    <div class="row"><span>EMPRESA:</span><b>${esc(x.empresa || '')}</b><span>CUIT:</span><b>${esc(x.cuil || '')}</b>
      <span style="margin-left:auto">LEGAJO N°:</span>${linea(x.legajo)}</div>
    <p style="margin-top:8mm">Señores:<br><b>${esc(E.marca)}</b><br>S.______//______D.</p>
    <p>De nuestra consideración:</p>
    <p style="text-indent:12mm">Tenemos el agrado de dirigirnos a Uds., a fin de solicitarles hagan entrega a nuestro
      asociado, el Sr.: <b>${esc(x.nombre)}</b>, DNI: <b>${esc(x.dni || '')}</b>
      de la cantidad de PESOS <b>${enLetras(p.capital)}.-</b> CON 00/100 &nbsp; $ <b>${nf0.format(p.capital)}</b>
      en <b>${p.ncuot}</b> cuotas mensuales de PESOS <b>${enLetras(p.cuota)}.-</b> CON 00/100 &nbsp; $ <b>${nf0.format(p.cuota)}</b></p>
    <div class="sign"><div>Recibí conforme</div><div>Nombre y Apellido</div><div>N° D.N.I.</div></div>
    <p class="legal">Yo, ${esc(x.nombre)}, DNI ${esc(x.dni || '')} declaro en mi carácter de asociado a AMSPA N°_______,
      autorizo que se me descuente de mis haberes mensuales, el monto correspondiente a la cuota de la presente orden de crédito,
      en caso de perder mi condición de asociado, (por desvinculación de la empresa o por renuncia a la mutual) la mutual podrá
      exigir la retención del saldo total adeudado de mi liquidación final y/o exigir el pago por la vía legal correspondiente.</p>
    <p class="legal">Yo_______________________________ _____DNI:_______________ me constituyo en fiador solidario, principal pagador,
      renunciando a los beneficios excusión división, en los términos del art. 2013 del Código Civil de todas las obligaciones y deudas
      que tuviere el sr._________________________DNI:_______________ con AMSPA, como consecuencia de la presente Orden de compra,
      incluyendo capital, intereses compensatorios y punitorios, accesorias, costos y costas en caso de acción judicial, hasta el
      efectivo pago, firmando al pie de la presente, prueba de ello. Asimismo autorizo se me descuente de mis haberes y/o liquidación
      final, el monto que corresponda en virtud de la obligación asumida en mi carácter de garante.-</p>
    <div class="sign"><div>Recibí conforme</div><div>Nombre y Apellido</div><div>N° D.N.I.</div></div>
    <div class="sign"><div>Recibí conforme</div><div>Nombre y Apellido</div><div>N° D.N.I.</div></div>
  </div>

  <div class="doc">
    <div style="text-align:center;margin:14mm 0 18mm">${esc(ciudad)},&nbsp; ${fLargo(p.entregado)}</div>
    <p>Por la presente, declaro haber recibido un crédito por la suma de
      <b style="float:right">$ ${nf0.format(p.capital)}</b><br>
      (pesos <b>${enLetras(p.capital)}.-</b>) en efectivo, correspondiente a la<br>
      Orden de crédito N° <b>${esc(p.oc)}</b></p>
    <div style="margin-top:26mm;text-align:right;line-height:3">
      Firma:_____________________<br>Aclaración__________________________<br>D.N.I. N°____________________</div>
  </div>

  <div class="doc">
    <img class="pg" src="pagare.jpg" alt="Pagaré">

  </div>`;
}

/* ------------------------- cierre de mes ------------------------- */
let mesCierre = MES_HOY;
let cfgCierre = { nInicial: 514 };
function vCierre() {
  return `<div class="head"><div><h1>Cierre de mes</h1></div></div>
  <div class="f">
    <input type="month" id="mc" value="${mesCierre}">
    <button class="btn pri" id="gsub">Generar y guardar en OneDrive</button>
    <button class="btn" id="gen">Descargar los dos archivos</button>
    <button class="btn" id="genGer">Solo informe de gerencias</button>
  </div>
  <div id="cout"></div>`;
}
function datosCierre(mes) {
  const fin = iso(new Date(+mes.slice(0, 4), +mes.slice(5) , 0));
  const incl = DB.prestamos.filter(p => p.entregado <= fin);
  const flujoMes = new Map();
  incl.forEach(p => cuotasDe(p).forEach(c => flujoMes.set(c.mes, (flujoMes.get(c.mes) || 0) + c.importe)));
  const delMes = incl.filter(p => p.entregado.slice(0, 7) === mes);
  const act = incl.filter(p => activo(p, fin));
  const filas = incl.filter(p => Math.floor(p.n || 0) >= cfgCierre.nInicial);
  /* el rango de meses arranca en la primera cuota de la primera fila mostrada */
  let minMes = mes, maxMes = mes;
  filas.forEach(p => { const cs = cuotasDe(p); if (!cs.length) return;
    if (cs[0].mes < minMes) minMes = cs[0].mes;
    if (cs[cs.length - 1].mes > maxMes) maxMes = cs[cs.length - 1].mes; });
  const meses = []; for (let k = minMes; mDiff(k, maxMes) >= 0; k = addM(k, 1)) meses.push(k);
  const aCobrar = flujoMes.get(mes) || 0;
  const dup = duplicados(mes);
  return { fin, incl, delMes, act, meses, filas, aCobrar, dup, flujoMes };
}
function pintarCierre() {
  const d = datosCierre(mesCierre);
  const iM = d.meses.indexOf(mesCierre);
  const vent = d.meses.slice(Math.max(0, iM - 2), iM + 4);
  const int = d.act.reduce((a, p) => ({ adm: a.adm + (p.adm || 0), emp: a.emp + (p.emp || 0), inv: a.inv + (p.inv || 0) }), { adm: 0, emp: 0, inv: 0 });
  $('#cout').innerHTML = `
  <div class="grid tiles" style="margin-bottom:18px">
    <div class="tile"><div class="k">A cobrar en ${mLabel(mesCierre)}</div><div class="v">${$$(d.aCobrar)}</div>
      <div class="s">${d.filas.length} filas en el flujo</div></div>
    <div class="tile"><div class="k">Colocado en el mes</div><div class="v">${$$(d.delMes.reduce((a, p) => a + p.capital, 0))}</div>
      <div class="s">${d.delMes.length} préstamos nuevos</div></div>
    <div class="tile"><div class="k">Cartera al ${fDate(d.fin)}</div><div class="v">${$$(d.act.reduce((a, p) => a + saldo(p, d.fin), 0))}</div>
      <div class="s">${d.act.length} vigentes</div></div>
    <div class="tile"><div class="k">Hoja ENTREGA</div><div class="v">${d.incl.length}</div><div class="s">préstamos hasta el cierre</div></div>
  </div>
  ${d.dup.length ? `<div class="warnbox"><b>Antes de mandarlo:</b> ${d.dup.length} persona${d.dup.length > 1 ? 's tienen' : ' tiene'} más de un descuento este mes —
    ${d.dup.map(o => esc(o.nombre) + ' (' + $$(o.total) + ')').join(', ')}.</div>` : ''}
  <div class="two">
    <div class="card pad"><h3 style="margin-bottom:9px">Liquidación de descuentos</h3>
      <p style="color:var(--ink-2);font-size:13px;margin:0 0 11px">
        <code>${esc(String(+mesCierre.slice(5)).padStart(2, '0'))}-${mesCierre.slice(0, 4)} DESCUENTO DE PRESTAMOS.xlsx</code></p>
      <dl class="dl"><dt>Hoja ENTREGA</dt><dd>${d.incl.length} filas × 14 columnas</dd>
        <dt>Hoja FLUJO DE COBRO</dt><dd>${d.filas.length} filas × ${6 + d.meses.length} columnas</dd>
        <dt>Meses mostrados</dt><dd>${mLabel(d.meses[0])} a ${mLabel(d.meses[d.meses.length - 1])}</dd>
        <dt>Total del mes</dt><dd>${$$(d.aCobrar)}</dd></dl></div>
    <div class="card pad"><h3 style="margin-bottom:9px">Informe de gerencias</h3>
      <p style="color:var(--ink-2);font-size:13px;margin:0 0 11px"><code>PRESTAMOS al ${fDate(d.fin).replace(/\//g, '.')}.xlsx</code></p>
      <dl class="dl"><dt>Resumen del mes</dt><dd>colocado, cobrado, cartera</dd>
        <dt>Hoja RETIROS</dt><dd>${$$(int.adm)} / ${$$(int.emp)} / ${$$(int.inv)}</dd>
        <dt>Cartera activa</dt><dd>${d.act.length} préstamos</dd>
        <dt>Colocaciones del mes</dt><dd>${d.delMes.length} préstamos</dd></dl>
      </div>
  </div>
  <div class="sec"><h2>Previsualización del flujo de cobro</h2>
  <div class="card"><div class="tw"><table><thead><tr><th>N°</th><th>Persona</th><th>Empresa</th>
    ${vent.map(m => `<th class="num" style="${m === mesCierre ? 'color:var(--accent)' : ''}">${mLabel(m)}</th>`).join('')}</tr></thead>
    <tbody>${d.filas.slice(-14).map(p => { const cs = new Map(cuotasDe(p).map(c => [c.mes, c.importe]));
      return `<tr><td>${esc(p.oc)}</td><td>${esc(nombreDe(p))}</td><td style="color:var(--ink-2)">${esc(persona(p.pid).empresa || '—')}</td>
      ${vent.map(m => `<td class="num">${cs.has(m) ? nf0.format(cs.get(m)) : ''}</td>`).join('')}</tr>`; }).join('')}
    <tr style="border-top:2px solid var(--axis)"><td colspan="3" style="font-weight:650">Total del mes</td>
      ${vent.map(m => `<td class="num" style="font-weight:650;${m === mesCierre ? 'color:var(--accent)' : ''}">${
        nf0.format(Math.round(d.flujoMes.get(m) || 0))}</td>`).join('')}</tr>
    </tbody></table></div></div>
  <p class="hint">Se muestran las últimas 14 filas; los totales son de la tabla completa,
    que arranca en el préstamo N° ${cfgCierre.nInicial} (${mLabel(d.meses[0])}).</p></div>

  <div class="sec"><h2>Descuentos duplicados, para pegar en el mail</h2>
    <div id="mailbox"></div></div>`;
}

/* tabla lista para copiar al cuerpo de un mail */
function tablaMail(mes) {
  const d = duplicados(mes);
  if (!d.length) return null;
  const cab = ['APELLIDO Y NOMBRE', 'N°', 'Suma de ' + mLabel(mes)];
  const filas = [];
  d.forEach(o => o.cuotas.forEach((c, i) => filas.push([i ? '' : o.nombre, c.oc, nf0.format(c.importe)])));
  filas.push(['Total general', '', nf0.format(d.reduce((a, o) => a + o.total, 0))]);
  return { cab, filas, total: d.reduce((a, o) => a + o.total, 0) };
}
function pintarMail() {
  const box = $('#mailbox'); if (!box) return;
  const t = tablaMail(mesCierre);
  if (!t) { box.innerHTML = `<div class="card"><div class="empty">Nadie con más de un descuento en ${mLargo(mesCierre)}</div></div>`; return; }
  box.innerHTML = `<div class="f"><button class="btn pri" id="cmail">Copiar tabla</button>
      <span class="hint" id="mmsg" style="margin:0"></span></div>
    <div class="card"><table id="tmail">
      <thead><tr>${t.cab.map((c, i) => `<th class="${i ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${t.filas.map((f, i) => `<tr${i === t.filas.length - 1 ? ' style="font-weight:650"' : ''}>
        ${f.map((c, j) => `<td class="${j ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  on('#cmail', 'click', copiarMail);
}
async function copiarMail() {
  const t = tablaMail(mesCierre); if (!t) return;
  const bd = '1px solid #d0d0d0';
  const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">
    <tr>${t.cab.map((c, i) => `<th style="border:${bd};background:#f2f2f2;padding:4px 9px;text-align:${i ? 'right' : 'left'}">${c}</th>`).join('')}</tr>
    ${t.filas.map((f, i) => `<tr>${f.map((c, j) => `<td style="border:${bd};padding:4px 9px;text-align:${j ? 'right' : 'left'}${
      i === t.filas.length - 1 ? ';font-weight:bold' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
  const texto = [t.cab.join('\t'), ...t.filas.map(f => f.join('\t'))].join('\n');
  const msg = (x) => { const n = $('#mmsg'); if (n) { n.textContent = x; setTimeout(() => { if (n) n.textContent = ''; }, 3000); } };
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([texto], { type: 'text/plain' })
    })]);
    msg('Tabla copiada ✓  pegala en el mail con Ctrl+V');
  } catch (e) {
    try { await navigator.clipboard.writeText(texto); msg('Copiada como texto ✓'); }
    catch (e2) { msg('No se pudo copiar'); }
  }
}

/* --------- generación de los xlsx (motor propio, sin internet) --------- */
function bajar(buf, nombre) {
  const b = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const S = { hdr: 1, txt: 2, txtB: 3, num: 4, numB: 5, numAm: 6, fchB: 7, fch: 8, hdrC: 9, hdrM: 10,
  mes: 11, totN: 12, totT: 13, fchC: 14, titulo: 15, plano: 16,
  gTxt: 17, gTxtB: 18, gNum: 19, gNumB: 20, gFchB: 21, gFch: 22 };

function genDescuentos(mes, alaNube) {
  const d = datosCierre(mes);
  /* --- hoja ENTREGA (las altas del mes cerrado van en gris) --- */
  const colsE = [5.5, 35.5, 9, 8.5, 7.7, 7.2, 13.2, 11.3, 5.5, 10.7, 8.5, 12, 16.3, 13];
  const fE = [['N°', 'APELLIDO Y NOMBRE', 'CAPITAL', 'N CUOT', 'CUOTA', 'AUTORIZADO', 'ENTREGADO', 'MES', 'AÑO',
    'Ult cuota', 'STATUS', 'CUIL', 'TELEFONO', 'EMPRESA'].map(v => ({ v, s: S.hdr }))];
  d.incl.forEach(p => {
    const x = persona(p.pid), f = D(p.entregado), g = p.entregado.slice(0, 7) === mes;
    fE.push([
      { v: Math.floor(p.n) || p.oc, s: g ? S.gTxtB : S.txtB }, { v: x.nombre, s: g ? S.gTxtB : S.txtB },
      { v: p.capital, s: g ? S.gNumB : S.numB }, { v: p.ncuot, s: g ? S.gNum : S.num },
      { v: p.cuota, s: S.numAm }, { v: p.autorizado ? 'SI' : 'NO', s: g ? S.gTxtB : S.txtB },
      { v: f, s: g ? S.gFchB : S.fchB }, { v: MESES[f.getMonth()], s: g ? S.gTxt : S.txt },
      { v: f.getFullYear(), s: g ? S.gTxt : S.txt }, { v: D(p.ultCuota), s: g ? S.gFch : S.fch },
      { v: p.ultCuota > d.fin ? 'Activo' : 'Pagado', s: g ? S.gTxt : S.txt },
      { v: numSiEs(x.cuil) || 0, s: g ? S.gTxt : S.txt }, { v: numSiEs(x.telefono), s: g ? S.gTxt : S.txt },
      { v: x.empresa || '', s: g ? S.gTxt : S.txt }]);
  });
  /* --- hoja FLUJO DE COBRO (sin la columna Check) --- */
  const colsF = [4.5, 10.2, 12.8, 13.3, 13.3, 30, ...d.meses.map(() => 13)];
  const fF = [[{ v: 'N°', s: S.txt }, { v: 'Q Cuotas', s: S.txt },
    { v: 'Otorgado', s: S.hdrC }, { v: 'CUIL', s: S.hdrC }, { v: 'EMPRESA', s: S.hdrC },
    { v: 'APELLIDO Y NOMBRE', s: S.hdrC }, ...d.meses.map(m => ({ v: mLabel(m), s: S.hdrM }))]];
  d.filas.forEach(p => {
    const x = persona(p.pid), cs = new Map(cuotasDe(p).map(c => [c.mes, c.importe]));
    fF.push([{ v: Math.floor(p.n), s: S.txt }, { v: p.ncuot, s: S.txt },
      { v: D(p.entregado), s: S.fchC }, { v: numSiEs(x.cuil) || 0, s: S.txt }, { v: x.empresa || '', s: S.txt },
      { v: x.nombre, s: S.txt }, ...d.meses.map(m => cs.has(m) ? { v: cs.get(m), s: S.mes } : null)]);
  });
  const ci = 7 + d.meses.indexOf(mes), ft = fF.length + 1, tot = [];
  if (ci > 7) tot[ci - 2] = { v: 'TOTAL ' + MES3[+mes.slice(5) - 1].toUpperCase(), s: S.totT };
  tot[ci - 1] = { f: `SUM(${COL(ci)}2:${COL(ci)}${ft - 1})`, s: S.totN };
  fF.push(tot);
  /* vista al abrir: ENTREGA en el final de la tabla, FLUJO sobre el mes cerrado */
  const filaE = Math.max(2, fE.length - 24);
  const buf = libroXLSX([
    { nombre: 'ENTREGA', filas: fE, opt: { cols: colsE, freeze: [0, 1], gridOff: true, topLeft: 'A' + filaE } },
    { nombre: 'FLUJO DE COBRO', filas: fF, opt: { cols: colsF, freeze: [6, 1], filtro: 'A1:F1',
      topLeft: COL(ci) + Math.max(2, ft - 22) } }]);
  const nombre = `${String(+mes.slice(5)).padStart(2, '0')}-${mes.slice(0, 4)} DESCUENTO DE PRESTAMOS.xlsx`;
  return alaNube ? { buf, nombre, carpeta: CFG.carpeta + '/Liquidaciones Descuentos' } : (bajar(buf, nombre), null);
}

function genGerencias(mes, alaNube) {
  const d = datosCierre(mes);
  const int = d.act.reduce((a, p) => ({ adm: a.adm + (p.adm || 0), emp: a.emp + (p.emp || 0), inv: a.inv + (p.inv || 0) }), { adm: 0, emp: 0, inv: 0 });
  const R = [[{ v: 'Préstamos — cierre al ' + fDate(d.fin), s: S.titulo }], []];
  const bloque = (t, filas) => {
    R.push([{ v: t, s: S.hdr }, { v: '', s: S.hdr }]);
    filas.forEach(([k, v]) => R.push([{ v: k, s: S.plano }, { v, s: S.mes }]));
    R.push([]);
  };
  bloque('Actividad del mes', [
    ['Préstamos otorgados', d.delMes.length],
    ['Capital colocado', d.delMes.reduce((a, p) => a + p.capital, 0)],
    ['Cobranza imputada al mes', d.aCobrar]]);
  bloque('Cartera al cierre', [
    ['Préstamos vigentes', d.act.length],
    ['Capital promedio', Math.round(d.act.length ? d.act.reduce((a, p) => a + p.capital, 0) / d.act.length : 0)]]);
  bloque('Evolución de los últimos 6 meses', Array.from({ length: 6 }, (_, i) => {
    const m = addM(mes, i - 5);
    return ['Cobranza ' + mLargo(m), Math.round(d.flujoMes.get(m) || 0)];
  }));

  const cab = (ts) => [ts.map(t => ({ v: t, s: S.hdr }))];
  const A = cab(['N°', 'Persona', 'Empresa', 'Capital', 'Cuota', 'Cuotas', 'Cobradas', 'Saldo', 'Última cuota']);
  d.act.forEach(p => A.push([{ v: Math.floor(p.n), s: S.txt }, { v: persona(p.pid).nombre, s: S.txt },
    { v: persona(p.pid).empresa || '', s: S.txt }, { v: p.capital, s: S.num }, { v: p.cuota, s: S.num },
    { v: p.ncuot, s: S.txt }, { v: cuotasPagadas(p, d.fin), s: S.txt }, { v: saldo(p, d.fin), s: S.num },
    { v: D(p.ultCuota), s: S.fch }]));
  const N = cab(['N°', 'Persona', 'Empresa', 'Capital', 'Cuotas', 'Cuota', 'Devolución', 'Entregado']);
  d.delMes.forEach(p => N.push([{ v: Math.floor(p.n), s: S.txt }, { v: persona(p.pid).nombre, s: S.txt },
    { v: persona(p.pid).empresa || '', s: S.txt }, { v: p.capital, s: S.num }, { v: p.ncuot, s: S.txt },
    { v: p.cuota, s: S.num }, { v: Math.round(p.devol), s: S.num }, { v: D(p.entregado), s: S.fch }]));

  /* hoja Retiros: mismo formato que en el libro madre (un mes por columna) */
  const rs = retiros().filter(r => r.fecha <= d.fin);   // real hasta hoy, proyectado después
  const RET = [
    [{ v: 'RETIROS', s: S.txtB }, ...rs.map(r => ({ v: D(r.fecha), s: S.fchB }))],
    [{ v: 'ADMINISTRACIÓN', s: S.txtB }, ...rs.map(r => ({ v: Math.round(r.adm || 0), s: S.num }))],
    [{ v: 'EMPRESA', s: S.txtB }, ...rs.map(r => ({ v: Math.round(r.emp || 0), s: S.num }))],
    [{ v: 'INVERSIÓN', s: S.txtB }, ...rs.map(r => ({ v: Math.round(r.inv || 0), s: S.num }))]];

  const buf = libroXLSX([
    { nombre: 'Resumen', filas: R, opt: { cols: [34, 20], gridOff: true } },
    { nombre: 'Cartera activa', filas: A, opt: { cols: [7, 34, 16, 13, 12, 8, 10, 13, 13], freeze: [0, 1] } },
    { nombre: 'Colocaciones del mes', filas: N, opt: { cols: [7, 34, 16, 13, 8, 12, 14, 12], freeze: [0, 1] } },
    { nombre: 'Retiros', filas: RET, opt: { cols: [22, ...rs.map(() => 13)], freeze: [1, 1], topLeft: COL(Math.max(2, rs.length - 9)) + '2' } }]);
  const nombre = `PRESTAMOS al ${fDate(d.fin).replace(/\//g, '.')}.xlsx`;
  return alaNube ? { buf, nombre, carpeta: CFG.carpeta + '/Liquidaciones Gerencias' } : (bajar(buf, nombre), null);
}


/* ================================================================
   GUARDADO
   ================================================================ */
function aviso(texto, malo) {
  let n = $('#toast');
  if (!n) { n = el('<div id="toast"></div>'); document.body.appendChild(n); }
  n.textContent = texto; n.className = malo ? 'malo on' : 'on';
  clearTimeout(aviso.t); aviso.t = setTimeout(() => n.className = '', 4000);
}
let GUARDANDO = false;
async function guardar(msgOk) {
  if (GUARDANDO) return;
  GUARDANDO = true; aviso('Guardando…');
  try {
    await subirDatos(DB);
    aviso(msgOk || 'Guardado ✓');
  } catch (e) {
    if (e.conflicto) {
      aviso('El archivo cambió en OneDrive desde que lo abriste', true);
      if (confirm('El archivo de datos cambió en OneDrive desde que abriste la app (¿lo editaste en otro dispositivo?).\n\n' +
        'Aceptar: vuelvo a cargar la versión de OneDrive y perdés este cambio.\n' +
        'Cancelar: guardo igual y piso lo que haya del otro lado.')) { location.reload(); }
      else { try { await subirDatos(DB, true); aviso('Guardado, sobrescribiendo ✓'); } catch (e2) { aviso(e2.message, true); } }
    } else aviso('No se pudo guardar: ' + e.message, true);
  } finally { GUARDANDO = false; }
}

function altaPrestamo() {
  const pid = +($('#np-v') || {}).value;
  if (!pid) { aviso('Elegí una persona', true); $('#np-q').focus(); return; }
  const cap = +$('#ncap').value || 0, n = +$('#nc').value || 0, f = $('#nf').value, g = +$('#ng').value || 0;
  if (cap <= 0) { aviso('Falta el capital', true); return; }
  if (n <= 0) { aviso('Falta la cantidad de cuotas', true); return; }
  if (!f) { aviso('Falta la fecha de entrega', true); return; }
  const t = tasaVigente(f), c = calcular(cap, n, t, g);
  const num = DB.prestamos.reduce((a, p) => Math.max(a, Math.floor(p.n || 0)), 0) + 1;
  const p = {
    id: DB.prestamos.reduce((a, x) => Math.max(a, x.id || 0), 0) + 1,
    n: num, oc: String(num), pid, capital: cap, ncuot: n, tem: t.tem,
    factor: c.factor, devol: c.devol, cuota: c.cuota, pura: c.pura, interes: c.interes,
    intCuota: c.intCuota, adm: c.adm, emp: c.emp, inv: c.inv, gasto: g,
    autorizado: true, entregado: f, ultCuota: iso(menos10(eomonth(D(f), n)))
  };
  DB.prestamos.push(p);
  guardar('Préstamo N° ' + num + ' registrado ✓');
  location.hash = '#/prestamo/' + p.id;
}


/* ---- edición de persona ---- */
function guardarPersona(id) {
  const x = persona(+id); if (!x.id) return;
  const nom = $('#ed-nombre').value.trim();
  if (!nom) { aviso('El nombre no puede quedar vacío', true); return; }
  const num = (v) => String(v || '').replace(/\D/g, '') || null;
  x.nombre = nom;
  x.cuil = num($('#ed-cuil').value); x.dni = num($('#ed-dni').value); x.telefono = num($('#ed-tel').value);
  x.empresa = $('#ed-emp').value || null;
  x.provincia = $('#ed-prov').value.trim() || null;
  x.status = $('#ed-st').value;
  guardar('Datos actualizados ✓');
  ruta();
}

/* ---- corrección y baja de un préstamo ---- */
function vEditar(id) {
  const p = DB.prestamos.find(x => x.id === +id);
  if (!p) return `<div class="empty">No encontrado</div>`;
  const x = persona(p.pid);
  return `<div class="head"><div><h1>Corregir préstamo N° ${esc(p.oc)}</h1>
    <p>${esc(x.nombre)} · entregado el ${fDate(p.entregado)}</p></div>
    <a class="btn" href="#/prestamo/${p.id}">← Volver</a></div>
  <div class="note">Se recalcula todo con la tasa que tenía este préstamo cuando se otorgó
    (<b>${pct(p.tem)}</b> mensual), no con la vigente hoy. Así una corrección no altera la historia.</div>
  <div class="two">
    <div class="card pad">
      <div class="fg"><label class="fl">N° de orden de crédito</label><input type="text" id="e-oc" value="${esc(p.oc)}"></div>
      <div class="fg"><label class="fl">Capital</label><input type="number" id="e-cap" value="${p.capital}" step="10000"></div>
      <div class="fg"><label class="fl">Cantidad de cuotas</label><input type="number" id="e-nc" value="${p.ncuot}" min="1" max="24"></div>
      <div class="fg"><label class="fl">Fecha de entrega</label><input type="date" id="e-f" value="${p.entregado}"></div>
      <div class="fg"><label class="fl">Gastos administrativos</label><input type="number" id="e-g" value="${p.gasto || 0}" step="1000"></div>
      <div class="fg"><label class="fl">Autorizado</label>
        <select id="e-aut"><option value="1" ${p.autorizado ? 'selected' : ''}>Sí</option><option value="0" ${p.autorizado ? '' : 'selected'}>No</option></select></div>
      <div class="f" style="margin:0"><button class="btn pri" id="e-go">Guardar cambios</button>
        <button class="btn" id="e-del" style="color:var(--crit)">Eliminar préstamo</button></div>
    </div>
    <div class="card pad" id="e-prev"></div>
  </div>`;
}
function previewEditar(id) {
  const p = DB.prestamos.find(x => x.id === +id); if (!p) return;
  const cap = +$('#e-cap').value || 0, n = +$('#e-nc').value || 1, g = +$('#e-g').value || 0;
  const f = $('#e-f').value || p.entregado;
  const c = calcular(cap, n, { tem: p.tem, tAdm: p.tem * (p.adm / (p.intCuota || 1)), tInv: p.tem * (p.inv / (p.intCuota || 1)) }, g);
  $('#e-prev').innerHTML = `<h3 style="margin-bottom:11px">Cómo queda</h3><dl class="dl">
    <dt>Factor</dt><dd>${c.factor.toFixed(6).replace('.', ',')}</dd>
    <dt>Devolución</dt><dd>${$$(c.devol)}</dd>
    <dt>Interés total</dt><dd>${$$(c.interes)}</dd>
    <dt style="color:var(--ink);font-weight:650">Cuota</dt><dd style="font-size:19px">${$$(c.cuota)}
      ${c.cuota !== p.cuota ? `<span style="font-size:12px;color:var(--muted);font-weight:400"> antes ${$$(p.cuota)}</span>` : ''}</dd>
    <dt>Última cuota</dt><dd>${fDate(iso(menos10(eomonth(D(f), n))))}</dd></dl>`;
}
function guardarEditar(id) {
  const p = DB.prestamos.find(x => x.id === +id); if (!p) return;
  const cap = +$('#e-cap').value || 0, n = +$('#e-nc').value || 0, f = $('#e-f').value, g = +$('#e-g').value || 0;
  if (cap <= 0 || n <= 0 || !f) { aviso('Revisá capital, cuotas y fecha', true); return; }
  const rAdm = p.adm / (p.intCuota || 1), rInv = p.inv / (p.intCuota || 1);
  const c = calcular(cap, n, { tem: p.tem, tAdm: p.tem * rAdm, tInv: p.tem * rInv }, g);
  Object.assign(p, {
    oc: $('#e-oc').value.trim() || p.oc, capital: cap, ncuot: n, entregado: f, gasto: g,
    autorizado: $('#e-aut').value === '1',
    factor: c.factor, devol: c.devol, cuota: c.cuota, pura: c.pura, interes: c.interes,
    intCuota: c.intCuota, adm: c.adm, emp: c.emp, inv: c.inv,
    ultCuota: iso(menos10(eomonth(D(f), n)))
  });
  guardar('Préstamo corregido ✓');
  location.hash = '#/prestamo/' + p.id;
}
function borrarPrestamo(id) {
  const p = DB.prestamos.find(x => x.id === +id); if (!p) return;
  if (!confirm(`¿Eliminar el préstamo N° ${p.oc} de ${nombreDe(p)}?\n\n` +
    `Capital ${$$(p.capital)}, ${p.ncuot} cuotas de ${$$(p.cuota)}.\n\n` +
    'Desaparece de la app y de todos los cierres futuros. Si ya lo mandaste en una liquidación, ' +
    'esa liquidación no cambia, pero las próximas no lo van a incluir.')) return;
  DB.prestamos = DB.prestamos.filter(x => x.id !== p.id);
  guardar('Préstamo eliminado ✓');
  location.hash = '#/prestamos';
}

/* ================================================================
   PANTALLA DE CONEXIÓN
   ================================================================ */
function vConexion() {
  const conectado = !!USUARIO;
  return `<div class="head"><div><h1>Conexión</h1><p>Tus datos viven en tu OneDrive; la app sólo los lee y los escribe</p></div></div>
  <div class="two">
    <div class="card pad"><h3 style="margin-bottom:12px">Estado</h3><dl class="dl">
      <dt>Cuenta</dt><dd>${conectado ? esc(USUARIO) : '<span style="color:var(--muted);font-weight:400">sin conectar</span>'}</dd>
      <dt>Archivo</dt><dd style="font-weight:400;font-size:12.5px">${esc(CFG.ruta)}</dd>
      <dt>Datos</dt><dd>${DB ? DB.prestamos.length + ' préstamos · ' + DB.personas.length + ' personas' : '—'}</dd>
      <dt>Última escritura</dt><dd style="font-weight:400;font-size:12.5px">${DB && DB.actualizado ? new Date(DB.actualizado).toLocaleString('es-AR') : '—'}</dd>
    </dl>
    <div class="f" style="margin:16px 0 0">
      <button class="btn" id="krec">Volver a cargar</button>
      ${conectado ? '<button class="btn" id="kout">Desconectar</button>' : ''}
    </div></div>

    <div class="card pad"><h3 style="margin-bottom:12px">Configuración</h3>
      <div class="fg"><label class="fl">ID de aplicación (Azure)</label>
        <input type="text" id="kid" value="${esc(CFG.clientId)}" placeholder="00000000-0000-0000-0000-000000000000">
        <div class="hint">Lo obtenés registrando la aplicación una sola vez. Está explicado en el README.</div></div>
      <div class="fg"><label class="fl">Ruta del archivo de datos en OneDrive</label>
        <input type="text" id="kruta" value="${esc(CFG.ruta)}"></div>
      <div class="fg"><label class="fl">Carpeta donde se guardan los cierres</label>
        <input type="text" id="kcarp" value="${esc(CFG.carpeta)}"></div>
      <button class="btn pri" id="kguardar">Guardar configuración</button>
      <div class="fg" style="margin-top:18px"><label class="fl">URI de redirección a registrar en Azure</label>
        <input type="text" readonly value="${esc(REDIRECT)}" onclick="this.select()">
        <div class="hint">Copiala tal cual en el registro de la aplicación, como plataforma "Single-page application".</div></div>
    </div>
  </div>`;
}
function pintarConexion() {
  on('#krec', 'click', () => location.reload());
  on('#kout', 'click', desconectar);
  on('#kguardar', 'click', () => {
    CFG.clientId = $('#kid').value.trim();
    CFG.ruta = $('#kruta').value.trim() || CFG.ruta;
    CFG.carpeta = $('#kcarp').value.trim() || CFG.carpeta;
    cfgGuardar(CFG); aviso('Configuración guardada ✓'); setTimeout(() => location.reload(), 700);
  });
}

/* ================================================================
   ARRANQUE
   ================================================================ */
function pantalla(titulo, cuerpo, acciones) {
  document.body.innerHTML = `<div class="arranque"><div class="card pad" style="max-width:520px">
    <h2 style="margin-bottom:8px">${titulo}</h2>
    <div style="color:var(--ink-2);font-size:14px;line-height:1.55">${cuerpo}</div>
    <div class="f" style="margin:18px 0 0">${acciones || ''}</div></div></div>`;
}
async function arrancar() {
  try { await procesarVuelta(); }
  catch (e) {
    return pantalla('No se pudo iniciar sesión', esc(e.message) +
      '<br><br>Revisá que el ID de aplicación y la URI de redirección sean los correctos.',
      `<button class="btn" onclick="location.href=REDIRECT+'#/conexion'">Ir a Conexión</button>`);
  }
  if (!CFG.clientId) {
    pantalla('Falta conectar con OneDrive',
      'Todavía no cargaste el <b>ID de aplicación</b>. Es un paso de una sola vez: se registra la app en tu cuenta Microsoft ' +
      'para que pueda leer y escribir el archivo de datos en tu OneDrive. Los pasos están en el README.' +
      `<br><br><label class="fl" style="margin-top:6px">ID de aplicación</label>
       <input type="text" id="bid" placeholder="00000000-0000-0000-0000-000000000000" style="width:100%">
       <div class="hint">URI de redirección a registrar: <b>${esc(REDIRECT)}</b></div>`,
      `<button class="btn pri" id="bok">Guardar y conectar</button>`);
    on('#bok', 'click', () => {
      const v = $('#bid').value.trim();
      if (!v) return;
      CFG.clientId = v; cfgGuardar(CFG); iniciarLogin().catch(e => aviso(e.message, true));
    });
    $('#bid').focus();
    return;
  }
  const t = await token();
  if (!t) {
    pantalla('Conectate con tu cuenta Microsoft',
      'La app va a pedirte permiso para leer y escribir <b>tus</b> archivos de OneDrive. Los datos nunca salen de tu cuenta.',
      `<button class="btn pri" id="bin">Conectar</button>
       <button class="btn" onclick="location.href=REDIRECT+'#/conexion'">Configuración</button>`);
    on('#bin', 'click', () => iniciarLogin().catch(e => aviso(e.message, true)));
    return;
  }
  pantalla('Cargando…', 'Buscando el archivo de datos en tu OneDrive.');
  try {
    await quienSoy();
    const d = await bajarDatos();
    if (!d) {
      pantalla('No encuentro el archivo',
        `Busqué <b>${esc(CFG.ruta)}</b> en tu OneDrive y no está. Subí el archivo <b>prestamos.json</b> a esa ruta, ` +
        'o corregí la ruta en Configuración.',
        `<button class="btn" onclick="location.reload()">Reintentar</button>
         <button class="btn" onclick="location.href=REDIRECT+'#/conexion'">Configuración</button>`);
      return;
    }
    DB = d;
    document.body.innerHTML = `<div class="app"><nav class="side" id="nav"></nav><main id="main"></main></div><div id="tip"></div>`;
    ruta();
  } catch (e) {
    pantalla('No se pudieron cargar los datos', esc(e.message),
      `<button class="btn pri" onclick="location.reload()">Reintentar</button>
       <button class="btn" onclick="location.href=REDIRECT+'#/conexion'">Configuración</button>`);
  }
}

/* ================================================================
   ROUTER
   ================================================================ */
function on(sel, ev, fn) { const n = $(sel); if (n) n.addEventListener(ev, fn); }
function ruta() {
  const h = (location.hash || '#/').slice(2).split('/');
  const p = h[0] || '', arg = h[1];
  const M = $('#main');
  renderNav(['prestamo', 'nuevo', 'editar'].includes(p) ? 'prestamos'
    : ['persona', 'persona-nueva'].includes(p) ? 'personas' : p === 'doc' ? 'prestamos' : p);
  REDRAW = [];
  if (p === '') { M.innerHTML = vInicio(); pintarChart('#ch-col', W => barChart(CH_COL, { W })); }
  else if (p === 'prestamos') { M.innerHTML = vPrestamos(); pintarLista();
    on('#q', 'input', e => { fPrest.q = e.target.value; pintarLista(); });
    ['estado', 'empresa', 'anio'].forEach(k => { const n = $('#' + k); n.value = fPrest[k]; n.addEventListener('change', e => { fPrest[k] = e.target.value; pintarLista(); }); });
    on('#copiar', 'click', copiarPrestamos);
  }
  else if (p === 'prestamo') M.innerHTML = vPrestamo(arg);
  else if (p === 'nuevo') { M.innerHTML = vNuevo(); previewNuevo();
    ['#ncap', '#nc', '#nf', '#ng'].forEach(s => { on(s, 'input', previewNuevo); on(s, 'change', previewNuevo); });
    comboPersona('np', previewNuevo);
    on('#nsave', 'click', altaPrestamo);
  }
  else if (p === 'personas') { M.innerHTML = vPersonas(); pintarPersonas();
    on('#qp', 'input', e => { qPers = e.target.value; pintarPersonas(); }); }
  else if (p === 'persona') { M.innerHTML = vPersona(arg); on('#ed-go', 'click', () => guardarPersona(arg)); }
  else if (p === 'editar') { M.innerHTML = vEditar(arg); previewEditar(arg);
    ['#e-cap', '#e-nc', '#e-f', '#e-g'].forEach(k => { on(k, 'input', () => previewEditar(arg)); on(k, 'change', () => previewEditar(arg)); });
    on('#e-go', 'click', () => guardarEditar(arg));
    on('#e-del', 'click', () => borrarPrestamo(arg)); }
  else if (p === 'persona-nueva') { M.innerHTML = vPersonaNueva(); $('#pn').focus();
    on('#pgo', 'click', altaPersona);
    on('#pn', 'keydown', e => { if (e.key === 'Enter') altaPersona(); }); }
  else if (p === 'analisis') { M.innerHTML = vAnalisis(); pintarDup();
    const tr = $('#twret'); if (tr) tr.scrollLeft = tr.scrollWidth;
    const tc = $('#twcap'); if (tc) tc.scrollTop = tc.scrollHeight;
    on('#ma', 'change', e => { mesAnalisis = e.target.value; pintarDup(); }); }
  else if (p === 'calculador') { M.innerHTML = vCalculador(); calcular2();
    ['#ccap', '#ctem', '#cmin', '#cmax'].forEach(s => { on(s, 'input', calcular2); on(s, 'change', calcular2); });
    on('#cshare', 'click', compartirImagen); on('#cdown', 'click', descargarImagen); }
  else if (p === 'cierre') {
    M.innerHTML = vCierre(); pintarCierre(); pintarMail();
    on('#mc', 'change', e => { mesCierre = e.target.value; pintarCierre(); pintarMail(); });
    on('#gen', 'click', e => { const b = e.target;
      try { genDescuentos(mesCierre); genGerencias(mesCierre); b.textContent = 'Listo ✓'; }
      catch (err) { alert('No se pudo generar el Excel: ' + err.message); }
      finally { setTimeout(() => b.textContent = 'Generar los dos archivos', 2500); } });
    on('#genGer', 'click', () => { try { genGerencias(mesCierre); } catch (err) { alert('No se pudo generar: ' + err.message); } });
    on('#gsub', 'click', async e => {
      const b = e.target; b.disabled = true; b.textContent = 'Generando…';
      try {
        const XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        for (const x of [genDescuentos(mesCierre, true), genGerencias(mesCierre, true)]) {
          b.textContent = 'Subiendo ' + x.nombre.slice(0, 18) + '…';
          await subirArchivo(x.carpeta, x.nombre, new Blob([x.buf], { type: XL }), XL);
        }
        aviso('Los dos archivos quedaron en tu OneDrive ✓');
      } catch (err) { aviso('No se pudo guardar: ' + err.message, true); }
      finally { b.disabled = false; b.textContent = 'Generar y guardar en OneDrive'; }
    });
  }
  else if (p === 'doc') M.innerHTML = vDoc(arg);
  else if (p === 'conexion') { M.innerHTML = vConexion(); pintarConexion(); }
  else M.innerHTML = `<div class="empty">Página no encontrada</div>`;
  scrollTo(0, 0);
}
addEventListener('hashchange', () => { if (DB) ruta(); });
document.addEventListener('click', e => {
  if (e.target.closest('input,button,select,label,a')) return;
  const r = e.target.closest('[data-go]');
  if (r) location.hash = r.dataset.go;
});
document.addEventListener('mouseover', e => { const t = e.target.dataset && e.target.dataset.t; if (t) showTip(e, t); });
document.addEventListener('mousemove', e => { const t = $('#tip'); if (t && t.style.opacity == 1) { if (!(e.target.dataset && e.target.dataset.t)) hideTip(); else moveTip(e); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
arrancar();

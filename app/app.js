/* Predictamen de Equivalencias — todo corre local en el navegador. */
(() => {
'use strict';

const PLANES = window.PLANES_IUV;
// Nombre de la institución para el encabezado del dictamen (vacío = no se muestra)
const INST = '';
const CFG = window.CONFIG_IUV;
const SIM_MIN = CFG.SIMILITUD_MINIMA_PROPUESTA;       // 0.60
const SIM_ALTA = CFG.SIMILITUD_ALTA;                  // 0.85
const MAX_PCT = CFG.PORCENTAJE_MAX_ADEUDO;            // 0.30
const MAX_ADEUDO = CFG.MAX_MATERIAS_ADEUDADAS;        // 6
const MAX_CICLO = CFG.MAX_MATERIAS_MISMO_CICLO;       // 2
const STORE = 'iuv_expedientes';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------------- Estado ---------------- */
let S = nuevoEstado();
function nuevoEstado() {
  return {
    alumno: { nombre: '', tramite: 'Equivalencia', institucion: '', expediente: siguienteExpediente() },
    planId: null,
    minima: 6,
    origen: [],          // [{n, cal, per}]
    asig: {},            // índice materia IUV -> [índices origen]
    conf: {},            // índice materia IUV -> true (revisado por asesor)
    manual: {},          // índice materia IUV -> [id de materias de origen] decidido por el asesor (no se recalcula)
    seq: 0,              // para dar un id fijo a cada materia de origen
    notas: {},           // índice materia IUV -> texto "periodo para cursarla"
    sim: {},             // índice materia IUV -> similitud del emparejamiento automático
    periodo: null,
    inicio: 0,
  };
}
const plan = () => PLANES.find(p => p.id === S.planId);

/* ---------------- Similitud de nombres ---------------- */
const STOP = new Set(['de','la','el','y','los','las','en','a','para','del','al','e','con','por','o','u','su','sus']);
const ROMAN = {i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10};
function tokens(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map(t => ROMAN[t] ? String(ROMAN[t]) : t).filter(t => !STOP.has(t));
}
// Basado en similitudTextos() del Apps Script del Sheets (misma normalización, mismos umbrales y misma
// regla de materias seriadas), con estas mejoras de precisión:
//  • cada palabra pesa según qué tan distintiva es dentro del plan IUV destino ("educación física" se repite
//    en casi todo el plan de Educación Física y pesa poco; "logística" aparece una vez y pesa mucho);
//  • comparación simétrica: las palabras de más en cualquiera de los dos nombres bajan el puntaje
//    (antes "Comercio electrónico" = "Logística en el comercio electrónico" daba 100%);
//  • plurales, género y erratas/OCR ("coporal", "motiz") cuentan como la misma palabra;
//  • "Informática" / "Computación" = "Tecnologías de la información";
//  • número de serie en un solo lado ("Taller de radio" vs "Taller de radio I") nunca es automático.
const ROMANOS = [['xii',12],['xi',11],['x',10],['ix',9],['viii',8],['vii',7],['vi',6],['v',5],['iv',4],['iii',3],['ii',2],['i',1]];
function normalizarParaComparacion(texto) {
  let t = String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Civil I -> civil nivel1 ; Civil 1 -> civil nivel1
  ROMANOS.forEach(([r, n]) => { t = t.replace(new RegExp('\\b' + r + '\\b', 'g'), 'nivel' + n); });
  for (let n = 12; n >= 1; n--) t = t.replace(new RegExp('\\b' + n + '\\b', 'g'), 'nivel' + n);
  return t.replace(/[.,;:()\/\-°º]/g, ' ')
    .replace(/\b(de|del|la|las|el|los|y|en|para|con|a)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}
const INTRO = new Set(['fundamentos', 'introduccion', 'principios', 'nociones']);
const SINONIMOS = { fundamentos: ['introduccion'], principios: ['introduccion'], nociones: ['introduccion'], informatica: ['tecnologias', 'informacion'], computacion: ['tecnologias', 'informacion'], tic: ['tecnologias', 'informacion'], tics: ['tecnologias', 'informacion'] };
const VACIAS = new Set(['al','e','o','u','por','sus','su','un','una','sobre','entre']);
// Raíz de una palabra: sin plural y sin terminación de género ("financieros" = "financiera")
function raiz(w) {
  if (w.length > 5 && /[lrndz]es$/.test(w)) w = w.slice(0, -2);          // funciones → funcion, actividades → actividad
  else if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);          // aprendizajes → aprendizaje
  if (w.length > 6 && /[ao]$/.test(w)) w = w.slice(0, -1);
  return w;
}
const GENERICAS = new Set(['derecho','teoria','general','introduccion','fundamentos','principios','basico','basica','avanzado','avanzada','aplicado','aplicada','estudio','temas','especiales']
  .map(w => raiz(w)));
// Áreas de conocimiento: materias con nombres distintos que suelen ser equivalentes
// ("Computación básica" ≈ "Sistemas y tecnologías de la información", "Lectura y redacción…" ≈ "Estrategias para
// el estudio y la comunicación"). Sólo sirven para PROPONER (quedan en "Revisar"), nunca como equivalencia automática.
// Se buscan sobre el nombre ya normalizado (sin acentos ni "de/la/y…").
const AREAS = [
  ['idioma', /\b(ingles|frances|lengua extranjera|idioma|english)\b/],
  ['tic', /\b(informatica|computacion|computo|ofimatica|tics?|herramientas digitales|tecnologias? informacion|tecnologias? digitales|sistemas informacion)\b/],
  ['lectoescritura', /\b(lectura|redaccion|escritura|ortografia|expresion oral|expresion escrita|comunicacion oral|comunicacion escrita|estrategias estudio comunicacion)\b/],
  ['pensamiento', /\b(pensamiento critico|habilidades pensamiento|pensamiento creativo|pensamiento logico|razonamiento|logica)\b/],
  ['estadistica', /\b(estadistica|probabilidad|bioestadistica)\b/],
  ['investigacion', /\b(metodologia investigacion|metodos investigacion|metodologia ciencia|taller investigacion|fundamentos investigacion|seminario investigacion|investigacion documental|seminario tesis|protocolo investigacion)\b/],
  ['etica', /\b(etica|valores|deontologia|responsabilidad social)\b/],
  ['desarrollo_personal', /\b(desarrollo humano|crecimiento personal|desarrollo personal|autoconocimiento|inteligencia emocional)\b/],
  ['emprendimiento', /\b(emprendimiento|emprendedor|emprendedores|creacion empresas|plan negocios|planeacion negocios|ideas? negocios?|modelos? negocios?)\b/],
  ['administracion_general', /\b(fundamentos administracion|introduccion administracion|principios administracion|administracion organizaciones|proceso administrativo|teoria (general )?administracion|pensamiento administrativo)\b/],
  ['derecho_laboral', /\b(derecho laboral|relaciones laborales|legislacion laboral|derecho trabajo)\b/],
  ['derecho_mercantil', /\b(derecho mercantil|relaciones comerciales|derecho civil mercantil|legislacion mercantil)\b/],
  ['fiscal', /\b(impuestos?|tributari[oa]s?|fiscal(es)?|contribuciones)\b/],
  ['internacional', /\b(comercio exterior|comercio internacional|negocios internacionales|mercados internacionales)\b/],
  ['recursos_humanos', /\b(recursos humanos|capital humano|talento humano|desarrollo personal|administracion personal|compensaciones|prevision social)\b/],
  ['operaciones', /\b(cadena suministros?|logistica|administracion operaciones|gestion produccion|administracion produccion)\b/],
  ['contabilidad', /\b(contabilidad|contables?)\b/],
  ['economia', /\b(economia|microeconomia|macroeconomia|macroeconomico|entorno economico)\b/],
  ['matematicas', /\b(matematicas? (administrativas?|administracion|negocios|basicas?|generales?)|algebra|precalculo)\b/],
  ['mercadotecnia', /\b(mercadotecnia|marketing|mercadeo)\b/],
  ['calculo', /\b(calculo|precalculo)\b/],
  ['amparo', /\bamparo\b/],
  ['globalizacion', /\b(globalizacion|organismos internacionales|tratados internacionales)\b/],
  ['sociologia', /\b(sociologia|dinamica social|sociedad|escuela contexto social|contexto social)\b/],
  ['desarrollo_humano', /\b(desarrollo (evolutivo|infantil|adolescentes?|humano)|psicologia desarrollo|crecimiento desarrollo|ninez|adolescencia)\b/],
  ['curriculum', /\b(curriculum|curricular|planes? programas? estudio|propositos contenidos|diseno curricular)\b/],
  ['historia_educacion', /\b(sistema educativo|educacion desarrollo historico|historia (general )?educacion|desarrollo educacion|politica educativa)\b/],
  ['practica_docente', /\b(practica docente|observacion practica|practicas? profesionales?|practicum)\b/],
  ['motricidad', /\b(motricidad|psicomotricidad|desarrollo motor|perceptivo motriz|desarrollo corporal)\b/],
  // Arquitectura, diseño e ingeniería civil
  ['historia_arquitectura', /\b(historia|historico|historica)\b.*\b(arquitectura|urbanismo|ciudad|arte|diseno)\b/],
  ['teoria_arquitectura', /\b(teoria (de )?(la )?arquitectura|composicion arquitectonica|fundamentos (del )?diseno|teoria (del )?diseno)\b/],
  ['dibujo', /\b(dibujo (y )?expresion|representacion arquitectonica|expresion grafica|dibujo arquitectonico|dibujo tecnico|geometria descriptiva|perspectiva)\b/],
  ['dibujo_digital', /\b(dibujo (asistido|por computadora)|computadora|modelos? digital(es)?|modelado|cad|bim)\b/],
  ['taller_diseno', /\b(taller (de )?diseno|proyecto arquitectonico|proyectos arquitectonicos|diseno arquitectonico)\b/],
  ['estructuras', /\b(estructuras?|estructural(es)?|mecanica (de )?(estructuras|materiales)|resistencia (de )?materiales|estatica|elementos (de )?(concreto|acero)|concreto|acero estructural)\b/],
  ['mecanica_materiales', /\b(resistencia (de )?materiales|mecanica (de )?(estructuras|materiales|solidos)|estatica)\b/],
  ['construccion', /\b(construccion|materiales (y )?elementos|edificacion|procedimientos constructivos|taller (de )?construccion)\b/],
  ['urbanismo', /\b(urbanismo|urbano|urbana|planeacion urbana|ciudad)\b/],
  ['sustentabilidad', /\b(sustentab\w*|sostenib\w*|bioclimatic\w*|eficientes energeticamente|medio ambiente)\b/],
  ['geometria', /\b(geometria|trigonometria)\b/],
  ['costos_obra', /\b(costos (y )?presupuestos|administracion (de )?obras?|administracion (de )?proyectos (de )?construccion|presupuestos (de )?obra)\b/],
  ['psicologia', /\b(psicologia|comportamiento humano)\b/],
];
const _analisis = new Map();
function analizar(texto) {
  let r = _analisis.get(texto);
  if (r) return r;
  const norm = normalizarParaComparacion(texto), palabras = new Set(), numeros = new Set();
  norm.split(' ').filter(Boolean).forEach(w => {
    const n = w.match(/^nivel(\d+)$/);
    if (n) return numeros.add(+n[1]);
    if (VACIAS.has(w) || w.length < 2) return;
    (SINONIMOS[w] || [w]).forEach(x => palabras.add(raiz(x)));
  });
  const intro = norm.split(' ').filter(w => INTRO.has(w)).sort().join(',');
  r = { norm, intro, palabras: [...palabras], numeros: [...numeros].sort().join(','), areas: AREAS.filter(([, re]) => re.test(norm)).map(([k]) => k) };
  _analisis.set(texto, r);
  return r;
}
// Pesos de las palabras dentro de un plan IUV: menos peso mientras más materias del plan la usan
function pesosDePlan(materias) {
  const df = new Map();
  materias.forEach(m => new Set(analizar(m.n).palabras).forEach(w => df.set(w, (df.get(w) || 0) + 1)));
  return df;
}
function peso(w, df) {
  if (GENERICAS.has(w)) return 0.25;
  const n = df ? (df.get(w) || 1) : 1;
  return Math.max(0.5, 1 / (1 + Math.log(n)));   // una palabra importante nunca pesa menos de la mitad
}
// Erratas / OCR: misma inicial, a lo más una letra de diferencia en largo y ≥85% igual ("coporal" = "corporal")
// Misma raíz larga: "administrativas" ~ "administración", "tributario" ~ "tributaria"
const mismaPalabra = (a, b) => a === b || (a.length >= 6 && b.length >= 6 && a[0] === b[0] && Math.abs(a.length - b.length) <= 1 && ratio(a, b) >= 0.85)
  || mismaRaiz(a, b);
const mismaRaiz = (a, b) => a !== b && a.length >= 9 && b.length >= 9 && a.slice(0, 8) === b.slice(0, 8);
// Distancia de edición; dos letras volteadas cuentan como un solo error ("Estadísitca" = "Estadística")
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let ant = null, prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      if (ant && i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) cur[j] = Math.min(cur[j], ant[j-2] + 1);
    }
    ant = prev; prev = cur;
  }
  return prev[n];
}
const ratio = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
// Dice ponderado: peso de lo común (de ambos lados) / peso total. Además, qué parte de cada nombre quedó cubierta.
function coincidencia(A, B, df) {
  const pA = A.map(w => peso(w, df)), pB = B.map(w => peso(w, df));
  const usadas = new Set(); let comunA = 0, comunB = 0, comunDistintivas = 0, porRaiz = 0;
  A.forEach((w, i) => {
    const k = B.findIndex((x, j) => !usadas.has(j) && mismaPalabra(w, x));
    if (k < 0) return;
    usadas.add(k); comunA += pA[i]; comunB += pB[k];
    if (mismaRaiz(w, B[k]) && ratio(w, B[k]) < 0.85) porRaiz++;
    if (!GENERICAS.has(w)) comunDistintivas++;
  });
  const totA = pA.reduce((t, x) => t + x, 0), totB = pB.reduce((t, x) => t + x, 0);
  return { dice: (comunA + comunB) / (totA + totB || 1), cobertura: Math.min(comunA / (totA || 1), comunB / (totB || 1)), comunDistintivas, porRaiz };
}
function similitud(texto1, texto2, df = null) {
  const s = similitudNombre(texto1, texto2, df);
  if (s >= 0.65) return s;
  // Nombres distintos de la misma área de conocimiento: se proponen para que el asesor lo confirme (65–70%)
  const a = analizar(texto1), b = analizar(texto2);
  const comunes = a.areas.filter(x => b.areas.includes(x)).length;
  if (!comunes) return s;
  if (a.numeros && b.numeros && a.numeros !== b.numeros) return s;   // "Inglés I" no es "Inglés III"
  // mismo número de serie (Historia … I ↔ Análisis histórico … I) pesa un poco más
  return (comunes >= 2 ? 0.70 : 0.65) + (a.numeros && a.numeros === b.numeros ? 0.07 : 0);
}
function similitudNombre(texto1, texto2, df = null) {
  const a = analizar(texto1), b = analizar(texto2);
  if (!a.norm || !b.norm) return 0;
  if (a.norm === b.norm) return 1;
  const A = a.palabras, B = b.palabras;
  if (!A.length || !B.length) return 0;
  const { dice, cobertura, comunDistintivas, porRaiz } = coincidencia(A, B, df);
  // Protección contra falsas coincidencias: ninguna palabra distintiva en común
  const distA = A.some(w => !GENERICAS.has(w)), distB = B.some(w => !GENERICAS.has(w));
  if (distA && distB && !comunDistintivas) return 0.30;
  let s = dice;
  // "Fundamentos de derecho" vs "Introducción al derecho": muy probable, pero que lo confirme el asesor
  if (a.intro !== b.intro) s = Math.min(s, 0.84);
  // "Administración" / "administrativo": misma raíz pero no siempre lo mismo ("Derecho administrativo" ≠ "Administración")
  if (porRaiz) s = Math.min(s, 0.84);
  // "Base de datos" vs "Base de datos avanzadas": distinto nivel, revisar
  if (A.includes(raiz('avanzada')) !== B.includes(raiz('avanzada'))) s = Math.min(s, 0.80);
  // Si a uno de los nombres le sobra una parte importante ("Economía" / "Economía de la salud") nunca es automática
  if (cobertura < 0.8) s = Math.min(s, 0.84);
  // Materias seriadas (igual que el Sheets): Amparo II ↔ Amparo II ≥ 90%, ↔ Amparo III 70%, ↔ Amparo I 30%
  if (a.numeros && b.numeros) {
    if (a.numeros === b.numeros) { if (s >= 0.70) s = Math.max(s, 0.90); }
    else {
      const d = Math.abs(+a.numeros.split(',')[0] - +b.numeros.split(',')[0]);
      s = s >= 0.70 ? (d === 1 ? 0.70 : 0.30) : Math.min(s, 0.30);
    }
  } else if (a.numeros || b.numeros) s = Math.min(s, 0.80);   // "Taller de radio" vs "Taller de radio I": revisar
  else {
    // Un nombre es el inicio del otro ("Derecho financiero" / "Derecho financiero y tributario"): proponer para revisión
    const [corto, largo] = a.norm.length < b.norm.length ? [a.norm, b.norm] : [b.norm, a.norm];
    if (largo.startsWith(corto + ' ') && corto.split(' ').length >= 2) s = Math.max(s, 0.80);
  }
  return Math.round(s * 100) / 100;
}

/* ---------------- Emparejamiento automático ---------------- */
const acreditada = o => o.cal != null && o.cal >= S.minima;
const tramiteInterno = () => /reincorporaci|cambio de carrera/i.test(S.alumno.tramite);
// Memoria: equivalencias ya validadas (dictámenes del Excel + expedientes guardados aquí)
const MEMO = 'iuv_memoria';
const clave = (o, m) => tokens(o).join(' ') + '→' + tokens(m).join(' ');
function memoria() {
  let propias = []; try { propias = JSON.parse(localStorage.getItem(MEMO)) || []; } catch {}
  return new Set([...(window.EQUIV_CONOCIDAS || []), ...propias].map(([o, m]) => clave(o, m)));
}
function aprender() {
  const p = plan(); let propias = []; try { propias = JSON.parse(localStorage.getItem(MEMO)) || []; } catch {}
  const ya = memoria();
  Object.entries(S.asig).forEach(([mi, os]) => { if (!S.conf[mi]) return; os.forEach(oi => {
    const o = S.origen[oi]?.n, m = p.materias[mi].n;
    if (o && !ya.has(clave(o, m)) && similitud(o, m) < 1) propias.push([o, m]);
  }); });
  guardarLS(MEMO, propias);
}
// Motor de emparejamiento (función pura: no toca la pantalla). Devuelve { asig, sim, bitacora }.
// origen: [{n, cal}] sólo acreditadas en `usar`; materias: materias del plan IUV destino.
function proponer(origen, usar, materias, memo, sim = similitud) {
  const asig = {}, simMi = {}, bitacora = [], df = pesosDePlan(materias);
  // Cada materia acreditada se propone a su materia IUV más parecida (si llega al mínimo), como en el Sheets.
  const cands = {};
  origen.forEach((o, oi) => {
    if (!usar(o)) return;
    let mejor = -1, puntaje = 0, aprendida = false;
    materias.forEach((m, mi) => {
      const enMemoria = memo.has(clave(o.n, m.n)), s = enMemoria ? 1 : sim(o.n, m.n, df);
      if (s > puntaje) { puntaje = s; mejor = mi; aprendida = enMemoria; }
    });
    bitacora.push({ oi, mi: puntaje >= SIM_MIN ? mejor : -1, s: puntaje, aprendida });
    if (mejor >= 0 && puntaje >= SIM_MIN) (cands[mejor] ||= []).push({ oi, s: puntaje });
  });
  // La mejor coincidencia decide el estatus. Otras materias se integran (promedio) sólo si también son
  // coincidencia alta; las dudosas no se agregan solas: quedan en "no utilizadas" para que el asesor decida.
  Object.entries(cands).forEach(([mi, cs]) => {
    cs.sort((a, b) => b.s - a.s);
    asig[mi] = [cs[0].oi, ...cs.slice(1).filter(c => c.s >= SIM_ALTA).map(c => c.oi)];
    simMi[mi] = cs[0].s;
    // Equivalencia integrada por cobertura: si juntas cubren mejor el nombre IUV que cada una sola
    // ("Cálculo diferencial" + "Cálculo integral" = "Cálculo diferencial e integral"), se integran.
    if (simMi[mi] >= SIM_ALTA) return;
    for (const c of cs.slice(1)) {
      if (asig[mi].includes(c.oi)) continue;
      const juntas = [...asig[mi], c.oi].map(oi => origen[oi].n).join(' ');
      const sj = sim(juntas, materias[mi].n, df);
      if (sj >= simMi[mi] + 0.05) { asig[mi].push(c.oi); simMi[mi] = sj; }
    }
  });
  // Segunda ronda: las materias que se quedaron sin lugar (su mejor opción ya la tomó otra) buscan su siguiente
  // mejor opción entre las materias destino que siguen libres.
  const usadas = new Set(Object.values(asig).flat());
  const libres = origen.map((o, oi) => oi).filter(oi => usar(origen[oi]) && !usadas.has(oi));
  const opciones = [];
  libres.forEach(oi => materias.forEach((m, mi) => {
    if (asig[mi]) return;
    const s = memo.has(clave(origen[oi].n, m.n)) ? 1 : sim(origen[oi].n, m.n, df);
    if (s >= SIM_MIN) opciones.push({ oi, mi, s });
  }));
  opciones.sort((a, b) => b.s - a.s);
  const tomadas = new Set();
  for (const { oi, mi, s } of opciones) {
    if (tomadas.has(oi) || asig[mi]) continue;
    asig[mi] = [oi]; simMi[mi] = s; tomadas.add(oi);
    const b = bitacora.find(x => x.oi === oi); if (b) { b.mi = mi; b.s = s; }
  }
  return { asig, sim: simMi, bitacora };
}
// Recalcula las propuestas automáticas SIN perder lo que el asesor ya decidió a mano (S.manual).
function emparejar() {
  const p = plan(); if (!p) return;
  S.manual ||= {}; S.seq ||= 0;
  S.origen.forEach(o => { if (!o.id) o.id = ++S.seq; });
  const r = proponer(S.origen, acreditada, p.materias, memoria());
  const idx = new Map(S.origen.map((o, i) => [o.id, i]));
  S.conf = {};
  Object.entries(S.manual).forEach(([mi, ids]) => {
    if (!p.materias[mi]) return;
    const os = ids.map(id => idx.get(id)).filter(i => i != null);
    if (os.length) { r.asig[mi] = os; S.conf[mi] = true; } else delete r.asig[mi];
  });
  S.asig = r.asig; S.sim = r.sim;
  S.periodo = null;
  return r;
}
// Guarda como decisión del asesor lo que hoy tiene la materia destino mi
const fijar = mi => { S.manual ||= {}; S.manual[mi] = (S.asig[mi] || []).map(oi => S.origen[oi].id); S.conf[mi] = true; };

/* ---------------- Cálculos del dictamen ---------------- */
function estado(mi) {
  const a = (S.asig[mi] || []).filter(oi => S.origen[oi]);
  if (!a.length) return 'pend';
  return (S.conf[mi] || (S.sim[mi] ?? 0) >= SIM_ALTA) ? 'eq' : 'posible';
}
function califIUV(mi) {
  const a = (S.asig[mi] || []).map(oi => S.origen[oi]).filter(Boolean);
  if (!a.length) return null;
  return Math.round(a.reduce((t, o) => t + o.cal, 0) / a.length * 100) / 100;
}
const ciclos = p => [...new Set(p.materias.map(m => m.c))].sort((a, b) => a - b);

function evaluar(k) {
  const p = plan(), total = p.materias.length;
  const previas = p.materias.map((m, i) => ({...m, i})).filter(m => m.c < k);
  const pend = previas.filter(m => estado(m.i) !== 'eq');   // sólo las EQUIVALENTES cubren
  const porCiclo = {};
  pend.forEach(m => porCiclo[m.c] = (porCiclo[m.c] || 0) + 1);
  const maxCiclo = Math.max(0, ...Object.values(porCiclo));
  const pct = pend.length / total;
  const motivos = [];
  if (pend.length > MAX_ADEUDO) motivos.push(`adeuda ${pend.length} materias (máx. ${MAX_ADEUDO})`);
  if (maxCiclo > MAX_CICLO) motivos.push(`adeuda ${maxCiclo} de un mismo ciclo (máx. ${MAX_CICLO})`);
  if (pct > MAX_PCT) motivos.push(`adeuda ${(pct*100).toFixed(0)}% del plan (máx. ${MAX_PCT*100}%)`);
  return { k, previas: previas.length, pend, pct, cumple: !motivos.length, motivos };
}
function periodoSugerido() {
  // Avanza ciclo por ciclo mientras se cumplan las reglas (igual que calcularPeriodoSugerido)
  const cs = ciclos(plan());
  let mejor = cs[0];
  for (let i = 1; i < cs.length; i++) { if (evaluar(cs[i]).cumple) mejor = cs[i]; else break; }
  return mejor;
}
function resumen() {
  const p = plan();
  const idx = p.materias.map((_, i) => i);
  const eq = idx.filter(i => estado(i) === 'eq').length;
  const pos = idx.filter(i => estado(i) === 'posible').length;
  const usadas = new Set(Object.values(S.asig).flat());
  const noUsadas = S.origen.map((o, i) => ({...o, i})).filter(o => !usadas.has(o.i) && !(tramiteInterno() && o.cal == null));
  const k = S.periodo ?? periodoSugerido();
  const ev = evaluar(k), cs = ciclos(p);
  // Si no puede avanzar más allá del primer ciclo: NO CUMPLE (como en el Sheets)
  if (k === cs[0] && cs.length > 1) { ev.cumple = false; ev.motivos.push(`no cumple los criterios para ingresar después del ${cs[0]}° ${p.unidad}`); }
  return { total: p.materias.length, eq, pos, pend: p.materias.length - eq - pos, noUsadas, ev, k };
}

/* ---------------- Calendario (Generación) ---------------- */
function periodosCal(unidad) {
  return unidad === 'semestre' ? [['Enero-Junio', 0], ['Agosto-Diciembre', 7]] : [['Enero-Abril', 0], ['Mayo-Agosto', 4], ['Septiembre-Diciembre', 8]];
}
function opcionesInicio(unidad) {
  const ps = periodosCal(unidad), hoy = new Date(); const out = [];
  let y = hoy.getFullYear(), j = ps.findIndex(([, m], x) => x === ps.length - 1 || hoy.getMonth() < ps[x + 1][1]);
  for (let n = 0; n < 8; n++) { out.push(`${ps[j][0]} ${y}`); if (++j === ps.length) { j = 0; y++; } }
  return out;
}
function terminoDe(unidad, inicioTxt, salto) {
  const ps = periodosCal(unidad).map(x => x[0]);
  const [nom, y] = [inicioTxt.replace(/ \d+$/, ''), +inicioTxt.match(/\d+$/)[0]];
  const pos = ps.indexOf(nom) + salto;
  return `${ps[pos % ps.length]} ${y + Math.floor(pos / ps.length)}`;
}

/* ---------------- Lectura de archivos ---------------- */
function aNumero(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (isNaN(n)) return null;
  if (n > 10 && n <= 100) return Math.round(n) / 10;   // escala 0-100
  return n >= 0 && n <= 10 ? n : null;
}
function limpiarNombre(s) {
  s = String(s).replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ¿]+/, '')                     // basura al inicio: "(_ Bases…"
    .replace(/(\s+([^A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s]+|[a-záéíóúñ]))+\s*$/, '');  // basura al final: "… mexicano _ i"
  return s.replace(/^\s*[A-Z]{2,5}[-\s]?\d{2,6}\b\s*/, '')   // claves tipo LCF101, "GDEL 28003"
    .replace(/^\s*\d{1,3}[.)-]\s+/, '').replace(/\s{2,}/g, ' ').trim();
}
// Columnas que algunos kárdex ponen entre el nombre y la calificación (créditos, tipo, periodo):
// "COMPUTACION BASICA 6 T 201601" → { n: "COMPUTACION BASICA", per: "2016-01" }. Sólo se quitan si hay un
// código de periodo (4-6 dígitos) o algo tipo "6T", para no borrar un número de serie ("Informática 1").
function separarColumnas(nombre) {
  const ts = String(nombre).trim().split(/\s+/);
  const basura = t => /^\d+[A-Za-z]?$/.test(t) || /^[A-Za-z]$/.test(t) && !/^[IVX]$/.test(t) || /^[|.,;:—–-]+$/.test(t);
  let i = ts.length;
  while (i > 1 && basura(ts[i - 1])) i--;
  const cola = ts.slice(i);
  if (!cola.some(t => /^\d{4,}$/.test(t) || /^\d+[A-Za-z]$/.test(t))) return { n: nombre, per: '' };
  const cod = cola.find(t => /^(19|20)\d{2}(0[1-9]|[1-5]\d)?$/.test(t));
  return { n: ts.slice(0, i).join(' '), per: cod ? (cod.length > 4 ? `${cod.slice(0, 4)}-${cod.slice(4)}` : cod) : '' };
}
// ¿Este renglón sin calificación es la continuación del nombre de arriba? (nombres largos en MAYÚSCULAS partidos)
const CONECTOR_FINAL = /\s(DE|DEL|LA|LAS|LOS|EL|Y|E|A|AL|EN|CON|PARA|POR|SU|SUS|O|U|de|del|la|las|los|el|y|e|a|al|en|con|para|por|su|sus|o|u)$/;
const esContinuacion = (previo, actual) => !!previo && (CONECTOR_FINAL.test(previo) || /^[a-záéíóúñ(]/.test(actual) || actual.split(/\s+/).length === 1);
const IGNORAR = /\b(area|área)s?\s+de\s+formaci[oó]n\b|semestre\W*ca[a-z]*\.?\W*$|cuatrimestre\W*ca[a-z]*\.?\W*$|kardex|k[aá]rdex|historial acad|^\s*clave\b|^\s*(materia|asignatura)s?\b.*calif|promedio|total|cr[eé]ditos|firma|p[aá]gina|fecha|nombre del alumno|matr[ií]cula|curp/i;
function parseLineas(texto, estricto = false) {
  const out = [];
  let colgando = null;   // renglón sin calificación que puede ser el inicio de un nombre largo
  let ultimo = null;     // materia agregada en el renglón anterior
  const letras = n => (n.match(/[a-záéíóúñ]/gi) || []).length;
  // ¿el documento califica de 0 a 100? (93, 85, 100) — entonces "05", "04"… son créditos, no calificaciones
  const reNum = /(?:^|[\s,;\t])(\d{1,3}(?:[.,]\d{1,2})?)(?=$|[\s,;\t])/g;
  let n100 = 0, n10 = 0;
  texto.split(/\r?\n/).forEach(l => [...l.matchAll(reNum)].forEach(m => { const v = parseFloat(m[1].replace(',', '.')); if (v >= 50 && v <= 100 && !/[.,]/.test(m[1])) n100++; else if (v >= 5 && v <= 10 && !/^0\d/.test(m[1])) n10++; }));
  const escala100 = n100 >= 3 && n100 > n10;
  for (let l of texto.split(/\r?\n/)) {
    l = l.replace(/[|_[\]{}]+/g, ' ').trim();
    if (!l || IGNORAR.test(l)) { colgando = ultimo = null; continue; }
    const nums = [...l.matchAll(reNum)];
    let cal = null, corte = l.length;
    // renglón que ya viene armado por la lectura de tablas: "NOMBRE [periodo]\tcalificación" (o SD)
    const tab = estricto && /^(.*\S)\t(SD|\d{1,2}(?:\.\d{1,2})?)$/.exec(l);
    if (tab && !/\t0(\.0+)?$/.test(l)) {
      const sc = separarColumnas(tab[1]), n = limpiarNombre(sc.n), c = tab[2] === 'SD' ? null : aNumero(tab[2]);
      if (letras(n) >= 4) { ultimo = { n, cal: c, per: sc.per }; out.push(ultimo); }
      colgando = null; continue;
    }
    const cero = /\t0(\.0+)?$/.exec(l);            // la lectura de tablas marca así "0.00" (sin calificar / reprobada)
    if (cero) { const sc = separarColumnas(l.slice(0, cero.index)), n = limpiarNombre(sc.n); if (letras(n) >= 4) out.push({ n, cal: 0, per: sc.per }); colgando = ultimo = null; continue; }
    // un número seguido de un código de periodo (201601) es de créditos, no la calificación
    const antesDePeriodo = m => /(^|\s)(19|20)\d{4}(\s|$)/.test(l.slice(m.index + m[0].length));
    if (escala100) {
      // la primera cifra de 50 a 100 después del nombre es la calificación (lo que sigue suelen ser créditos)
      const k = nums.findIndex(m => { const v = parseFloat(m[1]); return v >= 50 && v <= 100 && !/[.,]/.test(m[1]) && !antesDePeriodo(m); });
      if (k >= 0) { cal = aNumero(nums[k][1]); corte = nums[k].index; }
    } else {
      for (let k = nums.length - 1; k >= 0; k--) { if (/^0\d/.test(nums[k][1]) || antesDePeriodo(nums[k])) continue; const v = aNumero(nums[k][1]); if (v != null && v >= 5) { cal = v; corte = nums[k].index; break; } }
    }
    const sinCal = /(?:^|\s)(NA|NP|SD|N\/A)(?=\s|$)/i.exec(l.slice(0, corte));
    if (sinCal) corte = sinCal.index;
    const sc = separarColumnas(l.slice(0, corte).replace(/[,;\t\s.:-]+$/, ''));
    let n = limpiarNombre(sc.n);
    const continua = /^[a-záéíóúñ(]/.test(n);   // empieza en minúscula: sigue del renglón anterior
    if (estricto && cal == null) {
      // Nombre partido en dos renglones (común en PDFs): "HABILIDADES DEL PENSAMIENTO CRITICO" + "CREATIVO"
      // (un renglón real de materia trae números: créditos, periodo…; la continuación de un nombre no)
      const sinNumeros = !/\d/.test(l);
      if (ultimo && letras(n) >= 3 && (sinCal || sinNumeros) && esContinuacion(ultimo.n, n)) { ultimo.n += ' ' + n; continue; }
      // renglón con su periodo pero sin calificación legible: se agrega (casilla en rojo para capturarla a mano)
      if (!sinCal && !sc.per) { colgando = letras(n) >= 4 ? n : null; ultimo = null; continue; }
    }
    if (estricto && colgando && continua) n = colgando + ' ' + n;
    colgando = null; ultimo = null;
    if (letras(n) >= 4 && !/\bmeses\b|duraci[oó]n/i.test(n)) { ultimo = { n, cal, per: sc.per }; out.push(ultimo); }
  }
  return out;
}
// PDF escaneado (sólo imagen): se lee con OCR (Tesseract, español, sin internet)
let ocrListo = null;
function cargarOCR() {
  // Se carga sólo la primera vez que llega un PDF escaneado (son ~10 MB)
  return ocrListo ||= new Promise((ok, mal) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/ocr/ocr-embebido.js'; sc.onload = ok; sc.onerror = () => mal(new Error('no se pudo cargar el OCR'));
    document.head.appendChild(sc);
  }).then(() => {
    const F = window.OCR_FILES, url = t => URL.createObjectURL(new Blob([t], { type: 'text/javascript' }));
    const simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
    const spa = Uint8Array.from(atob(F.spa), c => c.charCodeAt(0));
    // El motor va dentro del mismo worker: en file:// el worker no puede importar otros scripts
    // Corrige un error de tesseract.js 5.1.1: con idioma pasado como {code, data} usa data como nombre del idioma
    const worker = F.worker.replace('return"string"==typeof t?t:t.data}', 'return"string"==typeof t?t:t.code}');
    if (worker === F.worker) throw new Error('no se pudo preparar el OCR');
    const r = { workerPath: url((simd ? F.core : F.coreSinSimd) + '\n;self.TesseractCore = self.TesseractCore || TesseractCore;\n' + worker), spa };
    delete window.OCR_FILES;
    return r;
  });
}
function recorte(canvas, x0, y0, x1, y1, escala = 1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  const w = Math.max(1, Math.min(canvas.width, Math.ceil(x1)) - x0), h = Math.max(1, Math.min(canvas.height, Math.ceil(y1)) - y0);
  const c = document.createElement('canvas'); c.width = w * escala; c.height = h * escala;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, x0, y0, w, h, 0, 0, w * escala, h * escala);
  return c;
}
window.__byn = c => blancoYNegro(c);   // (para pruebas)
function blancoYNegro(canvas, umbral = 170) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, im = ctx.getImageData(0, 0, W, H), d = im.data;
  // 1) píxeles "de color" (resaltador o tinta de color) y su densidad alrededor (imagen integral)
  const color = new Uint8Array(W * H), integ = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0, i = 0; y < H; y++) {
    let fila = 0;
    for (let x = 0; x < W; x++, i++) {
      const r = d[i*4], g = d[i*4+1], b = d[i*4+2], mx = Math.max(r, g, b);
      color[i] = mx > 0 && (mx - Math.min(r, g, b)) / mx >= 0.35 && mx >= 120 ? 1 : 0;
      fila += color[i]; integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + fila;
    }
  }
  const R = Math.max(4, Math.round(W / 300));   // ~ grosor de una letra
  const densidad = (x, y) => {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(W, x + R + 1), y1 = Math.min(H, y + R + 1);
    return (integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  };
  // 2) tinta = oscuro; un bloque grande de color es resaltador (fondo) y un trazo delgado de color es texto de color
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2], lum = 0.3 * r + 0.59 * g + 0.11 * b;
    let tinta;
    if (color[i]) {
      // trazo fino de color = letra de color (ej. calificación en rojo). Dentro de un bloque de color (resaltador),
      // sólo es letra lo que está claramente más oscuro que el resaltador (letra café/negra encima del naranja).
      tinta = densidad(x, y) < 0.55 || Math.max(r, g, b) < 180;
    }
    else if (lum >= umbral) tinta = false;
    else {
      // oscuro sin color: ¿está sobre un resaltador? entonces es letra aunque sea gris-café
      tinta = true;
    }
    const v = tinta ? 0 : 255; d[i*4] = d[i*4+1] = d[i*4+2] = v;
  }
  ctx.putImageData(im, 0, 0);
}
// Para releer un pedazo: gris con el canal más claro (el resaltador de color se vuelve blanco, la letra negra queda)
function sinResaltador(canvas, umbral = 185) {
  const ctx = canvas.getContext('2d'), im = ctx.getImageData(0, 0, canvas.width, canvas.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(d[i], d[i+1], d[i+2]) < umbral ? 0 : 255; d[i] = d[i+1] = d[i+2] = v; }
  ctx.putImageData(im, 0, 0);
}
// ---- Lectura de tablas escaneadas (kárdex, certificados, boletas) ----
// No depende de encontrar el encabezado "CALIF.": localiza las columnas por la posición de los números,
// elige la de calificaciones por sus valores (las de créditos son "05", "04"… y casi no varían) y toma como
// nombre sólo lo que está alineado a partir de donde empiezan las materias (lo de más a la izquierda es
// basura del escaneo: sellos, fotos, franjas con texto diminuto).
const tokenNumerico = t => /\d/.test(t) && t.length <= 6 && (t.match(/[\d%[\]|lIoO.,]/g) || []).length >= t.length * 0.6;
function valorCrudo(t) {
  const u = t.replace(/^[[|lI](?=\d\d$)/, '1').replace(/[oO]/g, '0').replace(/[^\d.,]/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(u)) return null;
  const n = parseFloat(u);
  return n <= 100 ? { n, ceroIzq: /^0\d/.test(u), decimal: u.includes('.') } : null;
}
function romanosOCR(nombre) {
  nombre = nombre.replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})[!|]$/, '$1 I');   // "INGLES!" → "INGLES I"
  // "ESTADISTICA INFERENCIAL |" → "… I", "Il" → "II", "11" al final → "II"
  // sólo si va justo después de una palabra ("… métodos” |" o "motriz —_|" son líneas de la tabla)
  const L = '([A-Za-zÁÉÍÓÚÑáéíóúñ])';
  // "|", "l", "1" → I · "Il", "|I", "11" → II · "lll", "1|1" → III
  return nombre.replace(new RegExp(L + '(\\s+)([|lI1!]{1,3})$'), (m, a, esp, r) => a + esp + 'I'.repeat(r.length));
}
let VOCABULARIO = null;
function vocabulario() {
  if (VOCABULARIO) return VOCABULARIO;
  VOCABULARIO = new Set(['de','la','el','y','en','los','las','del','a','al','e','o','u','por','para','con']);
  PLANES.forEach(p => p.materias.forEach(m => m.n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-zñ]+/).forEach(w => w && VOCABULARIO.add(w))));
  return VOCABULARIO;
}
// Corrige errores típicos del OCR usando las palabras de todos los planes del catálogo
// ("Aprendizase" → "Aprendizaje", "Histónco" → "Histórico"). Respeta mayúsculas y acentos del catálogo.
let FORMAS = null;
function formasCatalogo() {
  if (FORMAS) return FORMAS;
  FORMAS = new Map();
  PLANES.forEach(p => p.materias.forEach(m => m.n.split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/).forEach(w => {
    if (w.length < 4) return;
    const k = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const f = FORMAS.get(k) || {}; f[w.toLowerCase()] = (f[w.toLowerCase()] || 0) + 1; FORMAS.set(k, f);
  })));
  return FORMAS;
}
function corregirOCR(nombre) {
  const formas = formasCatalogo(), claves = [...formas.keys()];
  return nombre.split(/(\s+)/).map(tok => {
    const w = tok.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    if (w.length < 5 || w !== tok.replace(/[.,:;!]+$/, '')) return tok;
    const k = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let mejor = formas.has(k) ? k : null;
    if (!mejor) {
      let d = Infinity;
      for (const c of claves) {
        if (Math.abs(c.length - k.length) > 2 || c[0] !== k[0]) continue;
        // no es errata, es otra palabra de la misma familia: "solucionar"/"solución", "avanzado"/"avanzada"
        if (c.startsWith(k) || k.startsWith(c)) continue;
        if (c.replace(/[aeos]+$/, '') === k.replace(/[aeos]+$/, '')) continue;   // avanzado/avanzadas, diseño/diseños
        const dc = lev(k, c);
        if (dc < d) { d = dc; mejor = c; }
      }
      if (d > (k.length >= 8 ? 2 : 1)) mejor = null;
    }
    if (!mejor) return tok;
    const f = formas.get(mejor), forma = Object.keys(f).sort((a, b) => f[b] - f[a])[0];
    // conserva el estilo: TODO MAYÚSCULAS, Primera mayúscula o minúsculas
    const out = w === w.toUpperCase() ? forma.toUpperCase() : w[0] === w[0].toUpperCase() ? forma[0].toUpperCase() + forma.slice(1) : forma;
    return tok.replace(w, out);
  }).join('');
}
function quitarBasuraInicial(nombre) {
  // Quita del inicio palabritas que no existen en ningún plan IUV ("MEE", "i ;", "XSo —"), máximo 4
  const voc = vocabulario(), ts = nombre.split(/\s+/);
  let i = 0;
  while (i < Math.min(4, ts.length - 1)) {
    const w = ts[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const limpio = w.replace(/[^a-zñ]/g, ''), sinPunt = w.replace(/[:,.;]+$/, '');
    if (limpio.length >= 2 && limpio === sinPunt && voc.has(limpio)) break;
    if (limpio.length > 4 && limpio === sinPunt) break;   // palabra larga normal aunque no esté en el catálogo
    i++;
  }
  return ts.slice(i).join(' ');
}
async function textoDeTabla(lineas, canvas, original, worker) {
  const W = canvas.width;
  const palabrasDe = l => l.words.filter(w => w.text.trim());
  const cx = w => (w.bbox.x0 + w.bbox.x1) / 2;
  // 1) columnas numéricas: se agrupan los números por su posición horizontal
  const nums = [];
  lineas.forEach((l, li) => palabrasDe(l).forEach(w => { if (tokenNumerico(w.text.trim())) nums.push({ li, w, x: cx(w) }); }));
  if (nums.length < 4) return null;
  nums.sort((a, b) => a.x - b.x);
  const grupos = [];
  nums.forEach(n => { const g = grupos[grupos.length - 1]; if (g && n.x - g[g.length - 1].x < W * 0.03) g.push(n); else grupos.push([n]); });
  const encCal = lineas.flatMap(palabrasDe).filter(w => /^calif|^cal\.?$|^nota$/i.test(w.text.trim()));
  const candidatas = grupos.filter(g => new Set(g.map(n => n.li)).size >= 4).map(g => {
    const vals = g.map(n => valorCrudo(n.w.text.trim())).filter(Boolean);
    const en100 = vals.filter(v => v.n >= 50 && v.n <= 100 && !v.decimal).length, en10 = vals.filter(v => v.n >= 5 && v.n <= 10 && (v.decimal || !v.ceroIzq)).length;
    const ceros = vals.filter(v => v.ceroIzq).length, distintos = new Set(vals.map(v => v.n)).size;
    // la columna de créditos repite casi siempre el mismo valor (7.87, 05, 6): no es la de calificación
    const frec = Math.max(0, ...[...new Set(vals.map(v => v.n))].map(x => vals.filter(v => v.n === x).length)) / (vals.length || 1);
    const x0 = Math.min(...g.map(n => n.w.bbox.x0)), x1 = Math.max(...g.map(n => n.w.bbox.x1));
    const bajoEncabezado = encCal.some(w => w.bbox.x1 > x0 - W * 0.02 && w.bbox.x0 < x1 + W * 0.02);
    const puntaje = (Math.max(en100, en10) - ceros) / g.length + (distintos >= 4 ? 0.2 : 0) - (frec > 0.7 ? 0.6 : 0) + (bajoEncabezado ? 0.4 : 0);
    return { g, puntaje, escala100: en100 >= en10, decimales: vals.filter(v => v.decimal).length / (vals.length || 1), x0, x1 };
  }).filter(c => c.puntaje >= 0.45).sort((a, b) => b.puntaje - a.puntaje);
  if (!candidatas.length) return null;
  const col = candidatas[0];
  const holgura = W * 0.012;
  const enCol = w => cx(w) >= col.x0 - holgura && cx(w) <= col.x1 + holgura;
  // 2) renglones de la tabla: desde el primero hasta el último que trae algo en la columna de calificación
  // "99" en una columna que usa decimales (9.5, 8.4…) es 9.9: el OCR se comió el punto
  const sinPunto = v => !col.escala100 && col.decimales > 0.3 && !v.decimal && v.n >= 50 && v.n <= 99;
  const valida = v => v && (col.escala100 ? v.n >= 50 : (v.n >= 5 && v.n <= 10) || sinPunto(v));
  const todas = lineas.map((l, i) => valida(valorCrudo(palabrasDe(l).filter(enCol).map(w => w.text.trim()).join(''))) ? i : -1).filter(i => i >= 0);
  // el bloque continuo más grande de renglones con calificación (descarta encabezados y pies de página)
  const altoMed = todas.map(i => lineas[i].bbox.y1 - lineas[i].bbox.y0).sort((a, b) => a - b)[Math.floor(todas.length / 2)] || 20;
  const bloques = [];
  todas.forEach(i => { const b = bloques[bloques.length - 1]; if (b && lineas[i].bbox.y0 - lineas[b[b.length - 1]].bbox.y1 < altoMed * 5) b.push(i); else bloques.push([i]); });
  const conCal = bloques.sort((a, b) => b.length - a.length)[0] || [];
  if (conCal.length < 3) return null;
  // se extiende a renglones pegados que traen número en la columna aunque no aprueben (0.00 = sin calificar / reprobada)
  const conNumero = i => valorCrudo(palabrasDe(lineas[i]).filter(enCol).map(w => w.text.trim()).join('')) != null;
  for (let i = conCal[conCal.length - 1] + 1; i < lineas.length && conNumero(i) && lineas[i].bbox.y0 - lineas[i - 1].bbox.y1 < altoMed * 2; i++) conCal.push(i);
  for (let i = conCal[0] - 1; i >= 0 && conNumero(i) && lineas[i + 1].bbox.y0 - lineas[i].bbox.y1 < altoMed * 2; i--) conCal.unshift(i);
  const altoLinea = Math.max(10, conCal.reduce((t, i) => t + (lineas[i].bbox.y1 - lineas[i].bbox.y0), 0) / conCal.length);
  const yIni = lineas[conCal[0]].bbox.y0 - altoLinea * 0.5, yFin = lineas[conCal[conCal.length - 1]].bbox.y1 + altoLinea * 1.6;
  const enTabla = lineas.filter(l => l.bbox.y0 >= yIni && l.bbox.y1 <= yFin && !/promedio/i.test(l.text));
  // 3) ¿dónde empiezan los nombres? la posición donde más renglones arrancan una palabra de 3+ letras
  const esPalabra = w => (w.text.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length >= 3;
  const bin = W * 0.006, conteo = new Map();
  enTabla.forEach(l => {
    const vistos = new Set();
    const ws = palabrasDe(l);
    ws.filter((w, i) => esPalabra(w) && w.bbox.x1 < col.x0 && ws[i + 1] && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(ws[i + 1].text) && !/\d/.test(ws[i + 1].text) && ws[i + 1].bbox.x0 - w.bbox.x1 < (w.bbox.y1 - w.bbox.y0) * 1.5).forEach(w => { const k = Math.round(w.bbox.x0 / bin); if (!vistos.has(k)) { vistos.add(k); conteo.set(k, (conteo.get(k) || 0) + 1); } });
  });
  const mejorBin = [...conteo.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const xNombre = mejorBin && mejorBin[1] >= 3 ? (mejorBin[0] - 1.5) * bin : 0;
  // 4) arma cada renglón: nombre (entre el inicio de nombres y la columna) + calificación
  //    Los caracteres sueltos que caen en la misma x en muchos renglones son líneas de la tabla ("|"), no un "I"
  const sueltos = new Map();
  const esRaya = w => /^[|lI1Íi!\]\[]$/.test(w.text.trim());
  enTabla.forEach(l => palabrasDe(l).forEach(w => { if (esRaya(w)) { const k = Math.round(cx(w) / (W * 0.006)); sueltos.set(k, (sueltos.get(k) || 0) + 1); } }));
  const esLinea = w => esRaya(w) && [-1, 0, 1].reduce((t, d) => t + (sueltos.get(Math.round(cx(w) / (W * 0.006)) + d) || 0), 0) >= 5;
  const alturas = enTabla.flatMap(l => palabrasDe(l).filter(esPalabra).map(w => w.bbox.y1 - w.bbox.y0)).sort((a, b) => a - b);
  const altoTexto = alturas[Math.floor(alturas.length / 2)] || altoLinea;
  const filas = enTabla.map(l => {
    const ws = palabrasDe(l).filter(w => !esLinea(w));
    const wsNombre = ws.filter(w => w.bbox.x0 >= xNombre && w.bbox.x1 <= col.x0 + holgura * 0.5 && !enCol(w));
    // una rayita al final lejos del texto es la línea de la tabla; pegada a la palabra es un "I" (Taller de investigación I)
    while (wsNombre.length > 1 && esRaya(wsNombre[wsNombre.length - 1]) && wsNombre[wsNombre.length - 1].bbox.x0 - wsNombre[wsNombre.length - 2].bbox.x1 > altoTexto * 0.6) wsNombre.pop();
    // el nombre termina donde empiezan las columnas: "COMPUTACION BASICA | 6 T | 201601" (créditos, tipo, periodo).
    // Todo lo que siga (sellos o marcas de agua encima de la tabla) no es parte del nombre.
    const esColumna = (w, i, arr) => {
      const t = w.text.trim().replace(/^[^\dA-Za-z]+|[^\dA-Za-z|!:;]+$/g, '');
      if (/^\d{4,}$/.test(t) || /^\d{1,2}[A-Za-z|!:;]$/.test(t)) return true;                 // 201601, "6T", "71", "8:"
      if (/^\d{1,3}[.,]\d{1,2}$/.test(t)) return true;                                        // "10.00" (otra columna de calificación)
      if (/^\d{1,2}$/.test(t)) return i < arr.length - 1 || !/^[1-9]$/.test(t);                // "6 T …" (pero "Informática 1" no)
      return false;
    };
    // columnas ANTES del nombre (plan, ciclo, clave: "MDCA2018 1 MAU102", "FBGR 80001"): se saltan
    let ini = 0;
    while (ini < wsNombre.length - 1) {
      const t = wsNombre[ini].text.trim(), sig = wsNombre[ini + 1].text.trim();
      if (/\d/.test(t) || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t) || (/^[A-ZÁÉÍÓÚÑ]{2,5}$/.test(t) && /\d/.test(sig))) ini++; else break;
    }
    const wsN = wsNombre.slice(ini);
    const corte = wsN.findIndex(esColumna);
    let nombreWs = corte >= 0 ? wsN.slice(0, corte) : wsN;
    // un hueco muy grande entre palabras = otra columna o un sello encima de la tabla ("HUMANOS ……… XALAPA")
    const hueco = nombreWs.findIndex((w, i) => i > 0 && w.bbox.x0 - nombreWs[i - 1].bbox.x1 > altoTexto * 3);
    if (hueco > 0) nombreWs = nombreWs.slice(0, hueco);
    const periodoW = ws.find(w => /^(19|20)\d{2}(0[1-9]|[1-5]\d)$/.test(w.text.trim()) && cx(w) < col.x0);
    const wsCelda = ws.filter(enCol);
    const celda = wsCelda.map(w => w.text.trim()).join('');
    const v = valorCrudo(celda);
    let cal = v ? aNumero(v.n) : null;
    if (v && col.escala100 && v.n < 50) cal = null;              // "9" en una tabla de 0-100: mal leído, se relee
    if (v && !col.escala100 && v.n > 10 && !sinPunto(v)) cal = null;   // "39" en una tabla de 0-10: una raya pegada al 9, se relee
    // intentos: cada número de 0 a 10 desde la columna de calificación hacia la derecha, antes del folio/fecha
    const finZona = ws.find(w => cx(w) > col.x1 && /^X|^\d{1,2}-[A-Za-z]{3}|[A-Za-z]{3}-\d{2,4}$/.test(w.text.trim()));
    const intentos = ws.filter(w => cx(w) >= col.x0 - holgura && (!finZona || cx(w) < cx(finZona)))
      .map(w => ({ x: cx(w), v: valorCrudo(w.text.trim()) }))
      .filter(t => t.v && !t.v.ceroIzq && t.v.n <= 10).sort((a, b) => a.x - b.x);
    // altura real del renglón: la de sus palabras (la caja de la línea puede venir inflada por basura del margen)
    const ref = nombreWs.length ? nombreWs : wsCelda.length ? wsCelda : ws;
    const y0 = Math.min(...ref.map(w => w.bbox.y0)), y1 = Math.max(...ref.map(w => w.bbox.y1));
    const xFin = nombreWs.length ? Math.max(...nombreWs.map(w => w.bbox.x1)) : 0, xCol = corte >= 0 ? wsN[corte].bbox.x0 : col.x0;
    return { t: nombreWs.map(w => w.text).join(' '), x0: nombreWs.length ? nombreWs[0].bbox.x0 : Infinity, xFin, xCol, celda, cal, y0, y1, yc: (y0 + y1) / 2,
      periodo: periodoW ? periodoW.text.trim() : '', intentos, sinDigitos: !ws.some(w => /\d/.test(w.text)) };
  }).filter(f => (f.t.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length >= 3)
    .filter(f => !(f.sinDigitos && xNombre > 0 && f.x0 - xNombre > altoTexto * 6))   // texto suelto de un sello
    .filter(f => !/\b(area|área)s?\s+de\s+formaci[oó]n\b|^formaci[oó]n\s+(b[aá]sica|disciplinaria|terminal|de\s+elecci[oó]n)/i.test(f.t));
  // ¿kárdex con varios intentos por materia? (columna de periodos a la izquierda de la calificación, como los de la UV:
  // 1a. inscripción ordinario/extraordinario/título, 2a. inscripción…) → vale el último intento
  const multiIntento = filas.filter(f => f.periodo).length >= 4;
  // 4b) nombres largos partidos en dos renglones: el de abajo no trae ningún número y va pegado al de arriba.
  //     Se unen ANTES de leer calificaciones para que la de arriba no se "duplique" en el de abajo.
  filas.sort((a, b) => a.yc - b.yc);
  {
    const pasos = filas.slice(1).map((f, i) => f.yc - filas[i].yc).filter(d => d > 0).sort((a, b) => a - b);
    const paso = pasos[Math.floor(pasos.length / 2)] || altoLinea * 1.5;
    for (let i = filas.length - 1; i > 0; i--) {
      const f = filas[i], prev = filas[i - 1];
      if (!f.sinDigitos || f.cal != null || Math.abs(f.x0 - prev.x0) > altoTexto * 3) continue;
      const pegado = f.yc - prev.yc < paso * 0.8;
      if (CONECTOR_FINAL.test(prev.t.trim()) || /^[a-záéíóúñ(]/.test(f.t.trim()) || pegado) { prev.t += ' ' + f.t; prev.y1 = Math.max(prev.y1, f.y1); filas.splice(i, 1); }
    }
  }
  // 5) calificaciones: la columna completa se lee de 4 maneras y cada renglón se queda con el valor en que más
  //    lecturas coinciden (cada variante se equivoca en renglones distintos: "9%" en una es "96" en otra)
  const x0c = col.x0 - W * 0.025, x1c = col.x1 + W * 0.025;
  const yTop = Math.min(...filas.map(f => f.y0)) - altoLinea, yBot = Math.max(...filas.map(f => f.y1)) + altoLinea;
  const enRango = v => v && (col.escala100 ? v.n >= 50 : (v.n >= 5 && v.n <= 10) || sinPunto(v));
  const votos = filas.map(f => (f.cal != null ? [f.cal] : [])), huerfanas = [];
  await worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: '6' });
  for (const [src, esc, umbral] of [[original, 1, 0], [original, 1, 150], [original, 1, 200], [canvas, 1, 0]]) {
    const cr = recorte(src, x0c, yTop, x1c, yBot, esc);
    if (umbral) blancoYNegro(cr, umbral);
    const r = await worker.recognize(cr, {}, { blocks: true });
    r.data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines)).forEach(l => {
      const v = valorCrudo(l.text.replace(/\s/g, ''));
      if (!enRango(v)) return;
      const yc = yTop + (l.bbox.y0 + l.bbox.y1) / 2 / esc;
      let i = -1, d = altoLinea * 0.6;                            // el renglón más cercano
      filas.forEach((f, k) => { const dk = Math.abs(f.yc - yc); if (dk < d) { d = dk; i = k; } });
      if (i >= 0) votos[i].push(aNumero(v.n));
      else if (!huerfanas.some(h => Math.abs(h.yc - yc) < altoLinea * 0.6)) huerfanas.push({ yc, cal: aNumero(v.n) });
    });
  }
  filas.forEach((f, i) => {
    if (!votos[i].length) return;
    const cuenta = new Map(); votos[i].forEach(v => cuenta.set(v, (cuenta.get(v) || 0) + 1));
    f.cal = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // en una columna con decimales, si una lectura dice "9" y otra "9.9", el OCR se comió el ".9"
    if (col.decimales > 0.3 && Number.isInteger(f.cal)) {
      const conDec = votos[i].find(v => !Number.isInteger(v) && Math.floor(v) === f.cal);
      if (conDec != null) f.cal = conDec;
    }
  });
  if (multiIntento) filas.forEach(f => { if (f.intentos.length) f.cal = aNumero(f.intentos[f.intentos.length - 1].v.n); });
  // calificación sin renglón (el nombre salió ilegible en la lectura general): se lee sólo ese nombre
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
  for (const h of huerfanas) {
    const r = await worker.recognize(recorte(original, xNombre, h.yc - altoLinea * 0.7, col.x0 - W * 0.01, h.yc + altoLinea * 0.7), {}, { blocks: true });
    const ws = r.data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))).filter(w => w.text.trim());
    while (ws.length > 1 && esRaya(ws[ws.length - 1]) && ws[ws.length - 1].bbox.x0 - ws[ws.length - 2].bbox.x1 > altoTexto * 0.6) ws.pop();
    const t = ws.map(w => w.text).join(' ').trim();
    if ((t.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length >= 4) filas.push({ t, celda: '', cal: h.cal, y0: h.yc - 1, y1: h.yc + 1, yc: h.yc });
  }
  // lo que siga sin leerse: sólo esa celda, ampliada
  await worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: '7' });
  for (const f of filas) {
    if (f.cal != null || /^[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}$/.test(f.celda) || /semestre|cuatrimestre/i.test(f.t)) continue;
    const yc = (f.y0 + f.y1) / 2;
    for (const [src, esc] of [[original, 2], [canvas, 1]]) {
      const r = await worker.recognize(recorte(src, x0c, yc - altoLinea * 0.8, x1c, yc + altoLinea * 0.8, esc));
      const v = valorCrudo(r.data.text.replace(/\s/g, ''));
      if (enRango(v)) { f.cal = aNumero(v.n); break; }
    }
  }
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
  // 5b) segunda lectura de cada nombre: sólo ese pedazo, ampliado y quitando el color del resaltador.
  //     Se queda con la lectura que tenga más palabras reales (del catálogo) y conserve el número I, II…
  const voc = formasCatalogo();
  const calidad = t => {
    const ws = t.split(/\s+/).filter(Boolean);
    let p = 0;
    ws.forEach(w => { const k = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ]/g, '');
      if (k.length >= 4 && voc.has(k)) p += 2; else if (/^(de|del|la|las|el|los|y|en|a|al|para|por|con|e)$/i.test(w)) p += 0.5;
      else if (/^[IVX]{1,4}$/.test(w)) p += 1.5; else if (/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ.,:]/.test(w)) p -= 1.5; });
    return p;
  };
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
  for (const f of filas) {
    if (!f.xFin || f.x0 === Infinity) continue;
    const t1 = corregirOCR(romanosOCR(f.t)), q1 = calidad(t1), n1 = t1.split(/\s+/).filter(Boolean).length;
    const dudoso = q1 < n1 * 1.2;   // muchas palabras que no existen: se intenta con más zoom y otros umbrales
    const xa = (xNombre > 0 ? Math.min(f.x0, xNombre) : f.x0) - altoTexto * 0.4;
    const xb = Math.min(f.xCol - altoTexto * 0.2, Math.max(f.xFin + altoTexto * 3, f.xFin + 10));
    if (xb - xa < altoTexto * 2) continue;
    let mejor = { t: f.t, q: q1 };
    for (const [esc, umbral] of dudoso ? [[2, 185], [3, 185], [3, 210], [3, 160]] : [[2, 185]]) {
      const cr = recorte(original, xa, f.y0 - altoTexto * 0.35, xb, f.y1 + altoTexto * 0.35, esc);
      sinResaltador(cr, umbral);
      const otra = (await worker.recognize(cr)).data.text.replace(/\s+/g, ' ').trim();
      const t2 = corregirOCR(romanosOCR(otra.replace(/[|_[\]{}]+/g, ' ').trim()));
      if (t2 && calidad(t2) > mejor.q) mejor = { t: otra, q: calidad(t2) };
    }
    f.t = mejor.t;
  }
  await worker.setParameters({ tessedit_pageseg_mode: '6' });
  // 6) limpia nombres, une los partidos en dos renglones y marca "SD" lo que no se pudo leer
  const salida = [];
  filas.sort((a, b) => a.yc - b.yc);
  // separación típica entre renglones de la tabla: un nombre partido en dos queda más pegado que eso
  const pasos = filas.slice(1).map((f, i) => f.yc - filas[i].yc).filter(d => d > 0).sort((a, b) => a - b);
  const paso = pasos[Math.floor(pasos.length / 2)] || altoLinea * 1.5;
  for (const f of filas) {
    const t = corregirOCR(quitarBasuraInicial(limpiarNombre(romanosOCR(f.t.replace(/[_[\]{}]+/g, ' ').trim()))));
    if (!t || /^(materias?|asignaturas?)\b/i.test(t)) continue;
    // "COMPUTACION BASICA 6 T 201601": el nombre sin las columnas de créditos/tipo/periodo (la cola se conserva
    // para que después se lea el periodo)
    const sc = separarColumnas(t), n = sc.n, cola = f.periodo || t.split(/\s+/).slice(n.split(/\s+/).length).join(' ');
    const previa = salida[salida.length - 1];
    if (previa && f.cal == null && f.sinDigitos !== false && !/semestre|cuatrimestre|periodo|ciclo/i.test(n)) {
      const pegado = f.yc - previa.yc < paso * 0.8;
      const sigue = CONECTOR_FINAL.test(previa.n) || ((/^[a-záéíóúñ(]/.test(n) || n.split(/\s+/).length <= 2) && pegado);
      if (sigue) { previa.n += ' ' + n; previa.yc = f.yc; continue; }
    }
    if (f.cal == null && /semestre|cuatrimestre|periodo|ciclo/i.test(n)) continue;   // encabezados de la tabla
    salida.push({ n, cola, cal: f.cal, yc: f.yc });
  }
  return salida.length >= 3 ? salida.map(f => f.n + (f.cola ? ' ' + f.cola : '') + '\t' + (f.cal ?? 'SD')).join('\n') : null;
}
function rotar(canvas, grados) {
  if (!grados) return canvas;
  const c = document.createElement('canvas'), recto = grados % 180 === 0;
  c.width = recto ? canvas.width : canvas.height; c.height = recto ? canvas.height : canvas.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(grados * Math.PI / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}
function escalar(canvas, ancho) {
  const e = ancho / canvas.width, c = document.createElement('canvas');
  c.width = Math.round(canvas.width * e); c.height = Math.round(canvas.height * e);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}
// Recorta el margen blanco (una captura pegada en una hoja carta deja mucho blanco alrededor)
function recortarMargen(canvas) {
  const ctx = canvas.getContext('2d'), { width: W, height: H } = canvas, d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 700) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0 || (x1 - x0) * (y1 - y0) > W * H * 0.85) return canvas;
  const m = 12;
  return recorte(canvas, x0 - m, y0 - m, x1 + m, y1 + m);
}
// ¿La hoja viene de lado? Se prueba cada giro con una lectura rápida y gana el que produce más palabras reales
async function orientar(canvas, worker) {
  const voc = vocabulario();
  const puntaje = async g => {
    const c = rotar(escalar(canvas, Math.min(1400, canvas.width)), g);
    const t = (await worker.recognize(escalar(c, Math.min(1800, Math.max(1200, c.width))))).data.text;
    return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-zñ]+/).filter(w => w.length >= 4 && voc.has(w)).length;
  };
  let mejor = 0, pts = await puntaje(0);
  if (pts >= 15) return 0;
  for (const g of [90, 270, 180]) { const p = await puntaje(g); if (p > pts) { pts = p; mejor = g; } }
  return mejor;
}
async function crearWorkerOCR(nombre, total) {
  const o = await cargarOCR();
  const estado = { pag: 1 };
  const worker = await Tesseract.createWorker([{ code: 'spa', data: o.spa.slice() }], 1, {
    workerPath: o.workerPath, workerBlobURL: false, cacheMethod: 'none',
    logger: m => { if (m.status === 'recognizing text') toast(`Leyendo ${nombre} (imagen) · pág. ${estado.pag}/${total} · ${Math.round(m.progress * 100)}%`, true); },
  });
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  return { worker, estado };
}
// Lee una imagen de página: endereza, amplía para que el texto sea legible y lee la tabla
async function ocrCanvas(canvas, worker) {
  // el giro se detecta sobre el contenido sin márgenes; se lee la página completa (así la tabla conserva sus proporciones)
  const giro = await orientar(recortarMargen(canvas), worker);
  canvas = rotar(canvas, giro);
  // capturas de pantalla: letra chica → se amplía (hasta 3400 px de ancho, máx. ×4)
  if (canvas.width < 2000) {   // sólo imágenes chicas (capturas); un escaneo nítido no se toca
    canvas = escalar(canvas, Math.min(3400, canvas.width * 4));
    // margen blanco: el OCR pierde renglones pegados a la orilla de la captura
    const m = Math.round(canvas.width * 0.03), c = document.createElement('canvas');
    c.width = canvas.width + 2 * m; c.height = canvas.height + 2 * m;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(canvas, m, m);
    canvas = c;
  }
  const byn = recorte(canvas, 0, 0, canvas.width, canvas.height);
  blancoYNegro(byn);
  const r = await worker.recognize(byn, {}, { text: true, blocks: true });
  const lineas = r.data.blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines));
  const t = (await textoDeTabla(lineas, byn, canvas, worker).catch(e => { console.warn(e); return null; }) ?? r.data.text) + '\n';
  window.__ultimoOCR = t;   // útil para revisar qué leyó
  return t;
}
async function ocrPDF(pdf, nombre) {
  toast(`${nombre} es un PDF escaneado: preparando lectura…`, true);
  const { worker, estado } = await crearWorkerOCR(nombre, pdf.numPages);
  let texto = '';
  try {
    for (; estado.pag <= pdf.numPages; estado.pag++) {
      const page = await pdf.getPage(estado.pag);
      const vp = page.getViewport({ scale: 3400 / page.getViewport({ scale: 1 }).width });   // ~400 dpi en carta
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      texto += await ocrCanvas(canvas, worker);
    }
  } finally { await worker.terminate(); }
  return texto;
}
async function ocrImagen(file) {
  toast(`${file.name}: preparando lectura…`, true);
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bmp, 0, 0);
  const { worker } = await crearWorkerOCR(file.name, 1);
  try { return await ocrCanvas(canvas, worker); } finally { await worker.terminate(); }
}
// PDF con texto que trae una tabla con encabezados ("Materia | Créditos | Clave | Calificación | Ciclo…"):
// se lee por COLUMNAS usando la posición de cada texto. Así los créditos, claves y periodos no se confunden con la
// calificación, y los nombres partidos en dos renglones se unen. Devuelve null si no encuentra una tabla así.
async function tablaTextoPDF(pdf) {
  const out = [];
  let cols = null, encabezado = '';
  const esMat = t => /^(materias?|asignaturas?|experiencias?( educativas?)?|nombre( de la (materia|asignatura))?|unidad(es)? de aprendizaje|cursos?)$/i.test(t);
  const esCal = t => /^(calif\.?|calificaci[oó]n( final)?|calif(icaci[oó]n)?\s*final|promedio( final)?|nota)$/i.test(t);
  const esCiclo = t => /^(ciclo|periodo|período|semestre|cuatrimestre|fecha)$/i.test(t);
  for (let pg = 1; pg <= pdf.numPages; pg++) {
    const items = (await (await pdf.getPage(pg)).getTextContent()).items.filter(it => it.str && it.str.trim());
    // 1) renglones por altura (y)
    const renglones = [];
    items.forEach(it => {
      const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 8, x = it.transform[4];
      let r = renglones.find(r => Math.abs(r.y - y) < Math.max(r.h, h) * 0.45);
      if (!r) renglones.push(r = { y, h, items: [] });
      r.items.push({ x, x1: x + (it.width || 0), s: it.str.trim() });
    });
    renglones.sort((a, b) => b.y - a.y);
    renglones.forEach(r => r.items.sort((a, b) => a.x - b.x));
    // 2) encabezado de la tabla (se repite en cada página)
    let yEnc = null;
    for (const r of renglones) {
      const iM = r.items.findIndex(i => esMat(i.s)), iC = r.items.findIndex(i => esCal(i.s));
      if (iM >= 0 && iC >= 0) { cols = r.items.map(i => ({ ...i })); cols.mat = iM; cols.cal = iC; cols.ciclo = r.items.findIndex(i => esCiclo(i.s)); yEnc = r.y; break; }
    }
    if (pg === 1) encabezado = renglones.filter(r => yEnc == null || r.y > yEnc).map(r => r.items.map(i => i.s).join(' ')).join('\n');
    if (!cols) continue;
    // 3) a qué columna pertenece cada texto: la del encabezado más cercano
    const columna = it => {
      const cx = (it.x + it.x1) / 2;
      let mejor = -1, d = Infinity;
      cols.forEach((c, k) => { const dk = cx < c.x ? c.x - cx : cx > c.x1 ? cx - c.x1 : 0; if (dk < d) { d = dk; mejor = k; } });
      // el nombre de la materia es largo: lo que empieza dentro de su columna es nombre aunque se extienda
      if (it.x >= cols[cols.mat].x - 2 && (cols.mat + 1 >= cols.length || it.x < cols[cols.mat + 1].x - 2)) return cols.mat;
      return mejor;
    };
    const filas = [];
    for (const r of renglones) {
      if (yEnc != null && r.y >= yEnc - 1) continue;                                  // encabezado y lo de arriba
      const txt = r.items.map(i => i.s).join(' ');
      if (/^(total|promedio|cr[eé]ditos obtenidos|avance|p[aá]gina)\b/i.test(txt) || /total materias/i.test(txt)) continue;
      const porCol = {};
      r.items.forEach(it => { const k = columna(it); (porCol[k] ||= []).push(it.s); });
      filas.push({ y: r.y, h: r.h, nombre: (porCol[cols.mat] || []).join(' '), cal: (porCol[cols.cal] || []).join(' '),
        ciclo: cols.ciclo >= 0 ? (porCol[cols.ciclo] || []).join(' ') : '',
        // ¿trae datos (números) en otras columnas? un pedazo de nombre partido no; a lo más texto de "Observación"
        otras: Object.keys(porCol).some(k => +k !== cols.mat && /\d/.test(porCol[k].join(''))) });
    }
    // 4) cada renglón con calificación es una materia; los renglones que sólo traen nombre son pedazos de un
    //    nombre partido y se pegan a la materia más cercana (arriba o abajo)
    const anclas = filas.filter(f => f.cal);
    const partes = new Map(anclas.map(a => [a, [{ y: a.y, t: a.nombre }]]));
    filas.filter(f => !f.cal && f.nombre && !f.otras).forEach(f => {
      let mejor = null, d = Infinity;
      anclas.forEach(a => { const dk = Math.abs(a.y - f.y); if (dk < d) { d = dk; mejor = a; } });
      if (mejor && d < f.h * 3) partes.get(mejor).push({ y: f.y, t: f.nombre });
    });
    anclas.forEach(a => {
      const n = partes.get(a).sort((p, q) => q.y - p.y).map(p => p.t).join(' ').replace(/\s+/g, ' ').trim();
      const v = a.cal.replace(',', '.').match(/^\d{1,3}(\.\d{1,2})?$/);
      const cal = v ? aNumero(v[0]) : null;                                             // N/P, S/D… → sin calificación
      const ciclo = (a.ciclo.match(/\b(19|20)\d{2}(-?\d{1,2}|-[A-Z0-9]{1,3})?\b/) || [''])[0];
      if ((n.match(/[a-záéíóúñ]/gi) || []).length >= 3) out.push({ n: limpiarNombre(n), cal, per: ciclo });
    });
  }
  if (out.length < 3) return null;
  // datos del alumno que vienen arriba de la tabla (kárdex de la institución: reincorporación)
  const dato = re => ((encabezado.match(re) || [])[1] || '').replace(/\s*\|.*$/, '').trim();
  out.meta = {
    alumno: dato(/(?:alumno|nombre del alumno|estudiante)\s*:\s*([^\n]+)/i),
    plan: dato(/(?:plan de estudios|programa|carrera|licenciatura)\s*:\s*([^\n]+)/i),
    modalidad: dato(/modalidad\s*:\s*([A-Za-zÁÉÍÓÚáéíóúñ-]+)/i),
    matricula: dato(/matr[ií]cula\s*:\s*(\S+)/i),
  };
  return out;
}
// ¿El kárdex dice de qué plan de la institución viene? ("Plan de Estudios: Licenciatura en … · Modalidad: Escolarizada")
function planDeMeta(meta) {
  if (!meta || !meta.plan) return null;
  const nz = t => normalizarParaComparacion(t).replace(/\b(licenciatura|maestria|doctorado|tecnico superior universitario|en)\b/g, '').replace(/\s+/g, ' ').trim();
  const objetivo = nz(meta.plan), mod = (meta.modalidad || '').toLowerCase().slice(0, 4);
  const cands = PLANES.filter(p => nz(p.nombre) === objetivo && (!/licenciatura|maestr|doctor|t[eé]cnico/i.test(meta.plan) || meta.plan.toLowerCase().includes(p.nivel.toLowerCase().slice(0, 6))));
  return cands.find(p => mod && p.modalidad.toLowerCase().startsWith(mod)) || cands[0] || null;
}
// Devuelve la lista de materias del archivo, o null si es el Excel del sistema anterior (se maneja aparte)
async function leerArchivo(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const tabla = await tablaTextoPDF(pdf).catch(e => { console.warn(e); return null; });
    if (tabla) return tabla;
    let texto = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items;
      const lineas = {};
      items.forEach(it => { const y = Math.round(it.transform[5] / 3); (lineas[y] ||= []).push(it); });
      Object.keys(lineas).sort((a, b) => b - a).forEach(y => {
        let fin = null;
        lineas[y].sort((a, b) => a.transform[4] - b.transform[4]).forEach(it => {
          const x = it.transform[4];
          texto += fin == null ? '' : (x - fin < 1.5 ? '' : '\t');   // piezas pegadas (ej. ligadura "fi") no se separan
          texto += it.str; fin = x + it.width;
        });
        texto += '\n';
      });
    }
    let lista = parseLineas(texto, true);
    if (!lista.length && texto.replace(/\s/g, '').length < 200) lista = parseLineas(await ocrPDF(pdf, file.name), true);
    return lista;
  }
  if (ext === 'txt') return parseLineas(await file.text());
  if (/^(png|jpe?g|webp|gif|bmp|heic)$/.test(ext) || file.type.startsWith('image/')) return parseLineas(await ocrImagen(file), true);
  const wb = XLSX.read(await file.arrayBuffer());
  // ¿Es el Excel del sistema anterior? -> permitir elegir expediente
  if (wb.Sheets.ASPIRANTES && wb.Sheets.MATERIAS_ORIGEN) { elegirExpedienteSistema(wb); return null; }
  const hoja = wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })).sort((a, b) => b.length - a.length)[0];
  return parseFilas(hoja);
}
// Varias boletas a la vez: se juntan todas las materias; cada una recuerda de qué archivo salió
async function leerArchivos(files) {
  files = [...files]; if (!files.length) return;
  const juntas = [], fallas = [];
  for (const f of files) {
    try {
      const lista = await leerArchivo(f);
      if (lista === null) continue;
      if (!lista.length) { fallas.push(f.name); continue; }
      const nombre = f.name.replace(/\.[^.]+$/, '');
      lista.forEach(o => juntas.push({ ...o, per: o.per || nombre }));
      if (lista.meta) {
        if (lista.meta.alumno && !S.alumno.nombre.trim()) S.alumno.nombre = lista.meta.alumno;
        const po = planDeMeta(lista.meta);
        if (po) { S.planOrigenId = po.id; if (!S.alumno.institucion) S.alumno.institucion = INST || 'Misma institución'; }
      }
    } catch (err) { console.warn('No se pudo leer', f.name, String(err && err.stack || err)); fallas.push(f.name); }
  }
  if (fallas.length) toast(`No encontré materias en: ${fallas.join(', ')}. Puedes pegar esa lista a mano.`);
  if (juntas.length) cargarOrigen(juntas, files.length > 1 ? `${files.length - fallas.length} archivos` : files[0].name, true);
}
function elegirExpedienteSistema(wb) {
  const asp = XLSX.utils.sheet_to_json(wb.Sheets.ASPIRANTES, { defval: '' }).filter(a => a.ID_EXPEDIENTE && a.NOMBRE_ASPIRANTE);
  const mats = XLSX.utils.sheet_to_json(wb.Sheets.MATERIAS_ORIGEN, { defval: '' });
  const box = $('#selExpediente');
  box.hidden = false;
  box.innerHTML = `<label>Este archivo trae varios expedientes. ¿Cuál cargo?<select><option value="">Elige…</option>${asp.map((a, i) => `<option value="${i}">${esc(a.ID_EXPEDIENTE)} · ${esc(a.NOMBRE_ASPIRANTE)} · ${esc(a.PROGRAMA_IUV)}</option>`).join('')}</select></label>`;
  box.querySelector('select').onchange = e => {
    const a = asp[e.target.value]; if (!a) return;
    const id = String(a.ID_EXPEDIENTE).trim();
    S.alumno = { nombre: a.NOMBRE_ASPIRANTE, tramite: a.TIPO_DE_TRAMITE || 'Equivalencia', institucion: a.INSTITUCION_ORIGEN, expediente: id };
    const rv = String(a.RVOE_IUV).replace(/\.0$/, ''), mod = String(a.MODALIDAD).toLowerCase().slice(0, 4);
    const cands = PLANES.filter(p => p.rvoe === rv);
    const pl = cands.find(p => p.modalidad.toLowerCase().startsWith(mod)) || cands[0];
    if (pl) S.planId = pl.id;
    S.manual = {};
    const filas = mats.filter(m => String(m.ID_EXPEDIENTE).trim() === id);
    const min = filas.map(m => aNumero(m.MINIMA_APROBATORIA)).find(v => v != null);
    if (min) S.minima = min;
    pintarAlumno(); pintarPlan();
    cargarOrigen(filas.map(m => ({ n: String(m.MATERIA_ORIGEN).trim(), cal: aNumero(m.CALIFICACION), per: String(m.PERIODO_ORIGEN || '') })), `expediente ${id}`);
  };
}
function cargarOrigen(lista, fuente, agregar = false) {
  lista = lista.filter(o => o.n && !/\bmeses\b|duraci[oó]n/i.test(o.n));
  if (!lista.length) return toast('No encontré materias en ' + fuente + '. Prueba pegando la lista.');
  // Al agregar (boletas por separado) se suman a las que ya estaban; una materia repetida
  // (ej. recursada o en dos boletas) se queda una sola vez con la calificación más alta.
  // Las materias capturadas A MANO nunca se borran ni se reemplazan (a lo más se completa lo que les falte).
  const base = agregar ? [...S.origen] : S.origen.filter(o => o.manual), antes = base.length;
  let repetidas = 0;
  lista.forEach(o => {
    const k = normalizarParaComparacion(o.n), i = base.findIndex(x => normalizarParaComparacion(x.n) === k);
    if (i < 0) return base.push(o);
    repetidas++;
    const b = base[i];
    if (b.manual) { if (b.cal == null && o.cal != null) b.cal = o.cal; if (!b.per && o.per) b.per = o.per; return; }
    if ((o.cal ?? -1) > (b.cal ?? -1)) base[i] = { ...o, id: b.id };
    else if (!b.per && o.per) b.per = o.per;
  });
  S.origen = base;
  const r = emparejar(); pintarTodo(); analizarConAnimacion(r);
  toast(`${base.length - antes === 1 ? '1 materia nueva' : (base.length - antes) + ' materias nuevas'} de ${fuente}` + (repetidas ? ` · ${repetidas === 1 ? '1 repetida se unió' : repetidas + ' repetidas se unieron'}` : '') + (agregar && antes ? ` · total ${base.length}` : ''));
}

/* ---------------- Render ---------------- */
function buscarPlanes(q) {
  const ts = tokens(q); if (!ts.length) return [];
  return PLANES.filter(p => { const t = tokens(`${p.rvoe} ${p.nivel} ${p.nombre} ${p.modalidad}`).join(' '); return ts.every(x => t.includes(x)); }).slice(0, 40);
}
function listaPlanesHTML(ps) {
  return ps.map(p => `<div class="plan-item" data-id="${esc(p.id)}"><span>${esc(p.nivel)} en ${esc(p.nombre)}</span><small>${esc(p.modalidad)} · RVOE ${esc(p.rvoe)} · ${p.materias.length} materias</small></div>`).join('');
}
function pintarAlumno() {
  $('#nombre').value = S.alumno.nombre; $('#tramite').value = S.alumno.tramite;
  $('#institucion').value = S.alumno.institucion; $('#expediente').value = S.alumno.expediente;
  $('#minima').value = S.minima;
}
/* ---------------- Reincorporación: ¿de qué plan IUV vienen estas materias? ---------------- */
// Para cada plan IUV se cuenta cuántas materias acreditadas del alumno aparecen en él casi idénticas.
let _detCache = { clave: '', res: [] };
function planesDeOrigen() {
  const ok = S.origen.filter(acreditada);
  const clave = ok.map(o => o.n).join('|') + '#' + (S.planOrigenId || '');
  if (clave === _detCache.clave) return _detCache.res;
  let res = ok.length < 3 ? [] : PLANES.map(p => {
    const df = pesosDePlan(p.materias);
    const n = ok.filter(o => p.materias.some(m => similitud(o.n, m.n, df) >= SIM_ALTA)).length;
    return { p, n, frac: n / Math.min(ok.length, p.materias.length) };
  }).filter(x => x.n >= 3 && x.frac >= 0.4).sort((a, b) => b.frac - a.frac || b.n - a.n).slice(0, 4);
  // si el kárdex dice de qué plan viene (o el asesor lo eligió), ése va primero
  const po = S.planOrigenId && PLANES.find(p => p.id === S.planOrigenId);
  if (po) res = [{ p: po, n: (res.find(x => x.p === po) || {}).n || ok.length, frac: 1 }, ...res.filter(x => x.p !== po)].slice(0, 4);
  _detCache = { clave, res };
  return res;
}
function pintarSugerenciaPlan() {
  const box = $('#sugPlan'), det = S.origen.length ? planesDeOrigen() : [];
  const p = plan();
  let html = '';
  if (det.length && !p) {
    html = `<div class="sug-tit">🔎 Las materias cargadas coinciden con estos planes de la institución. ¿Es reincorporación? Elige la carrera destino:</div>`
      + det.map(x => `<button class="plan-item sug" data-id="${esc(x.p.id)}"><span>${esc(x.p.nivel)} en ${esc(x.p.nombre)}</span><small>${esc(x.p.modalidad)} · RVOE ${esc(x.p.rvoe)} · <b>${x.n} materias coinciden</b></small></button>`).join('');
  } else if (det.length && p && !tramiteInterno() && det[0].frac >= 0.5) {
    html = `<div class="sug-tit">🔎 ${det[0].n} materias del alumno coinciden con <b>${esc(det[0].p.nombre)}</b> de nuestra institución. ¿Es una reincorporación? <button class="btn sm" id="marcarReinc">Marcar como reincorporación</button></div>`;
  }
  box.innerHTML = html; box.hidden = !html;
  const b = $('#marcarReinc'); if (b) b.onclick = () => { S.alumno.tramite = 'Reincorporación'; $('#tramite').value = S.alumno.tramite; pintarRevision(); pintarSugerenciaPlan(); toast('Trámite: Reincorporación'); };
}
$('#sugPlan').addEventListener('click', e => {
  const it = e.target.closest('.plan-item'); if (!it) return;
  S.planId = it.dataset.id; S.manual = {};
  if (!tramiteInterno()) { S.alumno.tramite = 'Reincorporación'; }
  if (!S.alumno.institucion) S.alumno.institucion = INST || 'Misma institución';
  const r = emparejar(); pintarTodo(); analizarConAnimacion(r);
});

function pintarPlan() {
  const p = plan(), box = $('#planElegido');
  box.hidden = !p;
  if (p) {
    box.innerHTML = `<div><b>${esc(p.nivel)} en ${esc(p.nombre)}</b><small>${esc(p.modalidad)} · RVOE ${esc(p.rvoe)} · ${p.materias.length} materias en ${ciclos(p).length} ${p.unidad}s</small></div><button class="btn sm" id="cambiarPlan">Cambiar</button>`;
    $('#cambiarPlan').onclick = () => { S.planId = null; S.manual = {}; pintarTodo(); $('#buscaPlan').focus(); };
  }
  $('#buscaPlan').hidden = !!p; $('#listaPlanes').innerHTML = '';
  pintarSugerenciaPlan();
}
const chipOrigen = o => acreditada(o) ? '<span class="chip eq">Acreditada</span>' : o.cal == null ? '<span class="chip pend">Sin calificación</span>' : '<span class="chip bad">No acreditada</span>';
const filaOrigen = (o, i) => `<tr data-fila="${i}" class="${o.manual ? 'fila-manual' : ''}"><td><input data-o="${i}" data-f="n" value="${esc(o.n)}"></td><td><input data-o="${i}" data-f="cal" type="text" inputmode="decimal" autocomplete="off" value="${o.cal ?? ''}" placeholder="¿?" class="${o.cal == null ? 'falta' : ''}"></td><td><input data-o="${i}" data-f="per" value="${esc(o.per)}"></td><td class="estado-o">${chipOrigen(o)}${o.manual ? ' <span class="chip manual" title="Capturada a mano: no se borra al subir archivos">A mano</span>' : ''}</td><td><button class="del" data-del="${i}" title="Quitar">✕</button></td></tr>`;
// Sugerencias para el nombre al capturar a mano: materias del plan de origen (si se sabe) y del plan destino
function sugerenciasNombres() {
  const nombres = new Set();
  const po = S.planOrigenId ? PLANES.find(p => p.id === S.planOrigenId) : (planesDeOrigen()[0] || {}).p;
  [po, plan()].forEach(p => p && p.materias.forEach(m => nombres.add(m.n)));
  return [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
}
function pintarOrigen() {
  const n = S.origen.length, ok = S.origen.filter(acreditada).length, man = S.origen.filter(o => o.manual).length;
  $('#conteoOrigen').textContent = n ? `${n} materias · ${ok} acreditadas · ${n - ok} no acreditadas / sin calificación${man ? ` · ${man} a mano` : ''}` : '';
  const ultimoPer = (S.origen.filter(o => o.manual).pop() || {}).per || '';
  const form = `<div class="agregar-mano">
      <b>Agregar materia a mano</b>
      <input id="manNombre" list="manLista" placeholder="Nombre de la materia (empieza a escribir y elige)" autocomplete="off">
      <input id="manCal" type="text" inputmode="decimal" autocomplete="off" placeholder="Calificación">
      <input id="manPer" placeholder="Periodo (opcional)" value="${esc(ultimoPer)}">
      <button class="btn primary" id="manAgregar">+ Agregar</button>
      <datalist id="manLista">${sugerenciasNombres().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <small>Enter para agregar y seguir con la siguiente. Las materias a mano se suman y no se borran al subir archivos.</small>
    </div>`;
  if (!n) { $('#tablaOrigen').innerHTML = form; return; }
  $('#tablaOrigen').innerHTML = form + `<div class="tbl-scroll"><table><thead><tr><th>Materia cursada</th><th style="width:110px">Calificación</th><th style="width:150px">Periodo</th><th style="width:190px"></th><th style="width:30px"></th></tr></thead><tbody>${
    S.origen.map(filaOrigen).join('')
  }</tbody></table></div><div class="actions"><button class="btn sm" id="reEmparejar" title="Vuelve a calcular las propuestas; lo que ya decidiste a mano se respeta">Volver a emparejar</button><button class="btn sm" id="vaciarOrigen">Quitar todas</button></div>`;
}
function agregarAMano() {
  const n = $('#manNombre').value.trim(), cal = aNumero($('#manCal').value), per = $('#manPer').value.trim();
  if (!n) { $('#manNombre').focus(); return toast('Escribe el nombre de la materia'); }
  const k = normalizarParaComparacion(n), ya = S.origen.find(o => normalizarParaComparacion(o.n) === k);
  if (ya) {
    if (cal != null) ya.cal = cal; if (per) ya.per = per; ya.manual = true;
    toast(`«${n}» ya estaba: se actualizó`);
  } else {
    S.origen.push({ n, cal, per, manual: true });
    toast(`Agregada: ${n}${cal != null ? ' · ' + cal : ''}`);
  }
  emparejar(); pintarOrigen(); pintarRevision();
  const tbl = $('#tablaOrigen .tbl-scroll'); if (tbl) tbl.scrollTop = tbl.scrollHeight;
  $('#manNombre').focus();
}
function pintarRevision() {
  const p = plan();
  $('#paso3').hidden = $('#paso4').hidden = !(p && S.origen.length);
  if ($('#paso3').classList.contains('analizando')) $('#paso4').hidden = true;
  if ($('#paso3').hidden) return;
  const r = resumen();
  let html = '<div class="tbl-scroll" style="max-height:none"><table><thead><tr><th>Materia del plan destino</th><th>Materia de origen equivalente</th><th style="width:70px">Calif.</th><th style="width:170px">Estatus</th></tr></thead><tbody>';
  let cicloAnt = null;
  p.materias.forEach((m, mi) => {
    if (m.c !== cicloAnt) { cicloAnt = m.c; html += `<tr><td class="cycle" colspan="4">${m.c}° ${p.unidad}</td></tr>`; }
    const a = S.asig[mi] || [], st = estado(mi), cal = califIUV(mi);
    const selects = a.map(oi => `<span class="asig"><span>${esc(bonito(S.origen[oi].n))}</span><small>${S.origen[oi].cal}</small><button class="asig-x" data-quitar="${mi}:${oi}" title="Quitar (cursar en IUV)">×</button></span>`).join('')
      + `<button class="btn sm elegir ${a.length ? 'otra' : ''}" data-elegir="${mi}">${a.length ? '+ Integrar otra' : 'Elegir materia…'}</button>`;
    const chip = st === 'eq' ? '<span class="chip eq">Equivalente</span>'
      : st === 'posible' ? `<span class="chip posible">Revisar ${Math.round((S.sim[mi]||0)*100)}%</span> <button class="btn sm" data-ok="${mi}">✓</button>`
      : m.c < r.k ? '<span class="chip bad">Adeuda</span>' : '<span class="chip pend">Cursar</span>';
    const nota = st === 'pend' && m.c < r.k ? `<input data-nota="${mi}" placeholder="¿Cuándo la cursa? (ej. con LPA402 del …)" value="${esc(S.notas[mi] || '')}" style="margin-top:4px">` : '';
    html += `<tr><td>${esc(m.n)}</td><td><div class="sel-wrap">${selects}</div>${nota}</td><td>${cal ?? ''}</td><td>${chip}</td></tr>`;
  });
  html += '</tbody></table></div>';
  $('#revision').innerHTML = html;

  $('#noUsadas').innerHTML = r.noUsadas.length ? `<h3 style="font-size:15px;margin:18px 0 6px">Materias de origen no utilizadas (${r.noUsadas.length})</h3><p class="muted" style="margin:0 0 6px">Si alguna sí es equivalente, asígnala arriba con <b>Elegir materia…</b></p><div>${r.noUsadas.map(o => `<span class="chip ${acreditada(o) ? 'pend' : 'bad'}" style="margin:2px">${esc(bonito(o.n))}${o.cal != null ? ' · ' + o.cal : ''}</span>`).join(' ')}</div>` : '';

  const sinCal = S.origen.filter(o => o.cal == null).length;
  const aviso = !sinCal ? '' : tramiteInterno()
    ? `<div class="kpi" style="grid-column:1/-1"><span>ℹ ${sinCal} materias del plan de origen sin calificación se ignoran (aún no cursadas).</span></div>`
    : `<div class="kpi bad" style="grid-column:1/-1"><span>⚠ ${sinCal === 1 ? '1 materia de origen no tiene' : sinCal + ' materias de origen no tienen'} calificación y no se puede${sinCal === 1 ? '' : 'n'} acreditar. Captúrala${sinCal === 1 ? '' : 's'} en el paso 2 (casilla en rojo).</span></div>`;
  const avisoRev = r.pos ? `<div class="kpi aviso-rev" style="grid-column:1/-1"><span>⚠ ${r.pos === 1 ? 'Hay 1 equivalencia sugerida' : `Hay ${r.pos} equivalencias sugeridas`} en amarillo. Revísalas: confirma cada una con ✓, quita con × las que no, o acéptalas todas de una vez.</span><button class="btn sm primary" id="aceptarTodas">✓ Aceptar ${r.pos === 1 ? 'la sugerida' : `las ${r.pos}`}</button></div>` : '';
  $('#kpis').innerHTML = aviso + avisoRev + `
    <div class="kpi ok"><b>${r.eq}</b><span>de ${r.total} equivalentes${r.pos ? ` · ${r.pos} por revisar` : ''}</span></div>
    <div class="kpi"><b>${r.k}°</b><span>${p.unidad} sugerido de ingreso</span></div>
    <div class="kpi ${r.ev.pend.length ? '' : 'ok'}"><b>${r.ev.pend.length}</b><span>materias a regularizar (${(r.ev.pct*100).toFixed(0)}% del plan)</span></div>
    ${r.pos && !r.ev.cumple
      ? `<div class="kpi aviso-rev"><b>FALTA REVISAR</b><span>confirma o quita las sugeridas para ver el resultado</span></div>`
      : `<div class="kpi ${r.ev.cumple ? 'ok' : 'bad'}"><b>${r.ev.cumple ? 'CUMPLE' : 'NO CUMPLE'}</b><span>${r.ev.cumple ? 'reglas de adeudo' : esc(r.ev.motivos.join('; '))}</span></div>`}`;

  // Paso 4
  const ps = $('#periodoSug'), sug = periodoSugerido();
  ps.innerHTML = ciclos(p).map(c => `<option value="${c}" ${c === r.k ? 'selected' : ''}>${c}° ${p.unidad}${c === sug ? ' (sugerido)' : ''}</option>`).join('');
  const ini = opcionesInicio(p.unidad);
  $('#inicio').innerHTML = ini.map((t, i) => `<option value="${i}" ${i === S.inicio ? 'selected' : ''}>${t}</option>`).join('');
  pintarDictamen();
}
function datosDictamen() {
  const p = plan(), r = resumen(), ini = opcionesInicio(p.unidad)[S.inicio] || opcionesInicio(p.unidad)[0];
  const filas = p.materias.map((m, mi) => {
    const st = estado(mi), orig = (S.asig[mi] || []).map(oi => S.origen[oi]?.n).filter(Boolean).join(' / ');
    let periodo = '';
    if (st === 'pend') periodo = m.c < r.k ? (S.notas[mi] || 'Regularizar') : terminoDe(p.unidad, ini, m.c - r.k);
    return { ciclo: `${m.c}° ${p.unidad}`, c: m.c, iuv: m.n, origen: st === 'pend' ? 'POR CURSAR' : orig, cal: califIUV(mi) ?? '',
      estatus: st === 'eq' ? 'EQUIVALENTE' : st === 'posible' ? 'POSIBLE EQUIVALENCIA' : 'PENDIENTE', periodo };
  });
  return { p, r, ini, filas };
}
// Resultado para mostrar: CUMPLE / NO CUMPLE, o POR CONFIRMAR si hay sugerencias sin revisar que lo cambiarían
function resultadoTexto(r) {
  if (r.pos && !r.ev.cumple) return { txt: 'POR CONFIRMAR', clase: 'rev' };
  return r.ev.cumple ? { txt: 'CUMPLE', clase: 'ok' } : { txt: 'NO CUMPLE', clase: 'bad' };
}
function pintarDictamen() {
  const { p, r, ini, filas } = datosDictamen(), a = S.alumno, res = resultadoTexto(r);
  const po = tramiteInterno() && planesDeOrigen()[0];
  const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  const dato = (et, v) => `<div class="d-dato"><span>${et}</span><b>${esc(v || '—')}</b></div>`;
  // cuántos renglones tiene cada ciclo (para unir la celda del ciclo)
  const porCiclo = {}; filas.forEach(f => porCiclo[f.c] = (porCiclo[f.c] || 0) + 1);
  let cAnt = null, par = false;
  const cuerpo = filas.map(f => {
    let celdaCiclo = '';
    if (f.c !== cAnt) { cAnt = f.c; par = !par; celdaCiclo = `<td class="d-ciclo" rowspan="${porCiclo[f.c]}">${esc(f.ciclo)}</td>`; }
    const pend = f.estatus === 'PENDIENTE', regu = pend && /regulariz/i.test(f.periodo) || (pend && f.periodo && !/\d{4}/.test(f.periodo));
    const origen = pend ? '<span class="d-cursar">Por cursar</span>'
      : esc(f.origen) + (f.estatus === 'POSIBLE EQUIVALENCIA' ? ' <span class="d-tag">por confirmar</span>' : '');
    const periodo = !f.periodo ? '' : regu ? `<span class="d-regu">${esc(f.periodo)}</span>` : esc(f.periodo);
    return `<tr class="${par ? 'g1' : 'g2'}${f.c !== filas[filas.indexOf(f) + 1]?.c ? ' fin' : ''}">${celdaCiclo}<td>${esc(f.iuv)}</td><td>${origen}</td><td class="d-cal">${f.cal}</td><td>${periodo}</td></tr>`;
  }).join('');
  $('#dictamen').innerHTML = `
    <header class="d-head">
      <div>${INST ? `<div class="d-inst">${esc(INST)}</div>` : ''}<h1>Dictamen previo de equivalencia de estudios</h1></div>
      <div class="d-folio"><span>Expediente</span><b>${esc(a.expediente)}</b><span>${esc(fecha)}</span></div>
    </header>
    <section class="d-datos">
      ${dato('Aspirante', a.nombre)}${dato('RVOE', p.rvoe)}
      ${dato('Programa', `${p.nivel} en ${p.nombre} (${p.modalidad})`)}${dato('Institución de origen', a.institucion)}
      ${dato('Tipo de trámite', a.tramite)}${dato('Periodo sugerido de ingreso', `${r.k}° ${p.unidad} · inicia ${ini}`)}
      ${po ? dato('Programa de origen (misma institución)', `${po.p.nivel} en ${po.p.nombre}`) : ''}
    </section>
    <section class="d-res ${res.clase}">
      <div class="d-sello">${res.txt}</div>
      <div class="d-cifras">
        <div><b>${r.eq}<small>/${r.total}</small></b><span>materias equivalentes${r.pos ? ` · ${r.pos} por confirmar` : ''}</span></div>
        <div><b>${r.ev.pend.length}</b><span>por regularizar (${(r.ev.pct * 100).toFixed(0)}% del plan)</span></div>
        <div><b>${r.k}°</b><span>${esc(p.unidad)} de ingreso</span></div>
      </div>
      ${r.ev.motivos.length && res.clase === 'bad' ? `<div class="d-motivos">${esc(r.ev.motivos.join(' · '))}</div>` : ''}
    </section>
    <div class="d-cols">
      <table class="d-tabla">
        <colgroup><col style="width:11%"><col style="width:31%"><col style="width:31%"><col style="width:6%"><col style="width:21%"></colgroup>
        <thead><tr><th>Ciclo</th><th>${esc(INST || 'Plan destino')}</th><th>Institución de origen</th><th>Calif.</th><th>Periodo para cursarla</th></tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
      <table class="d-tabla d-nousadas">
        <thead><tr><th>Materias de procedencia no utilizadas</th><th>Calif.</th></tr></thead>
        <tbody>${r.noUsadas.map(o => `<tr><td>${esc(o.n)}</td><td class="d-cal">${o.cal ?? ''}</td></tr>`).join('') || '<tr><td colspan="2" class="d-vacio">Ninguna</td></tr>'}</tbody>
      </table>
    </div>
    <p class="d-nota">Este documento es un predictamen informativo; la equivalencia definitiva está sujeta a la revisión de la documentación oficial.</p>
    <div class="d-firmas"><div><span></span>Elaboró</div><div><span></span>Vo. Bo. Control Escolar</div></div>`;
}
/* ---------------- Animación del análisis ---------------- */
// El cálculo ya está hecho (es instantáneo); aquí se muestra paso a paso qué encontró el motor para cada materia.
let analisisId = 0;
const espera = ms => new Promise(r => setTimeout(r, ms));
async function analizarConAnimacion(r) {
  const p = plan();
  if (!p || !r || !S.origen.length) return;
  const id = ++analisisId, paso3 = $('#paso3'), box = $('#analisis');
  const pasos = r.bitacora, omitidas = S.origen.length - pasos.length;
  const suave = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;
  const porMateria = Math.min(120, Math.max(35, 3000 / Math.max(1, pasos.length))) * suave;   // ~3 s en total
  let saltar = false;
  paso3.classList.add('analizando'); $('#paso4').hidden = true; box.hidden = false;
  box.innerHTML = `
    <div class="an-head"><span class="spinner"></span><div><b>Analizando ${pasos.length} materias acreditadas</b>
      <small>contra ${esc(p.nivel)} en ${esc(p.nombre)} (${esc(p.modalidad)}) · ${p.materias.length} materias del plan${omitidas ? ` · ${omitidas} sin calificación o no acreditadas se omiten` : ''}</small></div>
      <button class="btn sm" id="anSaltar">Saltar</button></div>
    <div class="an-barra"><i style="width:0"></i></div>
    <div class="an-actual" id="anActual">Preparando…</div>
    <div class="an-cuentas"><span class="chip eq">Equivalentes <b id="anEq">0</b></span><span class="chip posible">Por revisar <b id="anRev">0</b></span><span class="chip pend">Sin equivalencia <b id="anSin">0</b></span></div>
    <ul class="an-log" id="anLog"></ul>`;
  $('#anSaltar').onclick = () => { saltar = true; };
  paso3.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const cuenta = { eq: 0, rev: 0, sin: 0 };
  for (let i = 0; i < pasos.length && !saltar; i++) {
    if (id !== analisisId) return;
    const b = pasos[i], o = S.origen[b.oi];
    $('#anActual').innerHTML = `Comparando <b>«${esc(o.n)}»</b> con ${p.materias.length} materias…`;
    await espera(porMateria * 0.55);
    if (id !== analisisId) return;
    const tipo = b.mi < 0 ? 'sin' : b.s >= SIM_ALTA ? 'eq' : 'rev';
    cuenta[tipo]++;
    const li = document.createElement('li');
    li.className = 'an-' + tipo;
    li.innerHTML = tipo === 'sin'
      ? `<span>—</span> ${esc(o.n)} <em>sin equivalencia en el plan</em>`
      : `<span>${tipo === 'eq' ? '✓' : '?'}</span> ${esc(o.n)} <em>→ ${esc(p.materias[b.mi].n)} · ${b.aprendida ? 'ya validada antes' : Math.round(b.s * 100) + '%'}</em>`;
    const log = $('#anLog'); log.prepend(li);
    while (log.children.length > 6) log.lastElementChild.remove();
    $('#anEq').textContent = cuenta.eq; $('#anRev').textContent = cuenta.rev; $('#anSin').textContent = cuenta.sin;
    box.querySelector('.an-barra i').style.width = `${Math.round((i + 1) / pasos.length * 92)}%`;
    await espera(porMateria * 0.45);
  }
  if (id !== analisisId) return;
  if (!saltar) {
    $('#anActual').textContent = 'Aplicando reglas de adeudo y calculando el periodo sugerido…';
    box.querySelector('.an-barra i').style.width = '100%';
    await espera(650 * suave);
    if (id !== analisisId) return;
  }
  box.hidden = true; paso3.classList.remove('analizando');
  pintarRevision();
  // los renglones aparecen en cascada
  [...$('#revision').querySelectorAll('tbody tr')].forEach((tr, i) => { tr.classList.add('aparece'); tr.style.animationDelay = `${Math.min(i * 18, 900) * suave}ms`; });
  $('#kpis').classList.add('aparece');
}

function pintarTodo() { pintarAlumno(); pintarPlan(); pintarOrigen(); pintarRevision(); }

/* ---------------- Guardar / exportar ---------------- */
function siguienteExpediente() {
  const y = new Date().getFullYear();
  const n = leerGuardados().filter(e => e.alumno.expediente.startsWith(`EQ-${y}`)).length + 1;
  return `EQ-${y}-${String(n).padStart(4, '0')}`;
}
function leerGuardados() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } }
function exportable() {
  const { p, r, ini, filas } = datosDictamen();
  return { ...structuredClone(S), guardado: new Date().toISOString(),
    resultado: { plan: { rvoe: p.rvoe, nivel: p.nivel, nombre: p.nombre, modalidad: p.modalidad }, periodo_sugerido: r.k, inicio: ini,
      cumple: r.ev.cumple, motivos: r.ev.motivos, equivalentes: r.eq, por_revisar: r.pos, total: r.total, materias: filas, no_utilizadas: r.noUsadas.map(o => ({ materia: o.n, calificacion: o.cal })) } };
}
function guardarLS(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { toast('Este navegador no permite guardar aquí'); } }
// ¿Estamos dentro de claude.ai? Ahí no se puede imprimir ni descargar directo: se usa su función de descargas.
const enClaude = () => typeof window.claude?.use === 'function';
async function descargar(nombre, blob) {
  if (enClaude()) {
    let d = null; try { d = await window.claude.use('downloads'); } catch {}
    if (d) {
      try { await d.save({ filename: nombre, data: blob }); toast('Listo: ' + nombre); }
      catch (e) { if (e?.code !== 'declined') toast('No se pudo descargar el archivo (' + (e?.code || 'error') + ')'); }
      return;
    }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Ventana de confirmación dentro de la página (en claude.ai las del navegador no aparecen)
function preguntar(texto, si = 'Sí', no = 'Cancelar') {
  return new Promise(ok => {
    let dl = document.getElementById('dlgPregunta');
    if (!dl) { dl = document.createElement('dialog'); dl.id = 'dlgPregunta'; document.body.appendChild(dl); }
    dl.innerHTML = `<p style="margin:0 0 14px;font-size:15px">${esc(texto)}</p><div class="actions" style="justify-content:flex-end"><button class="btn ghost" data-r="0">${esc(no)}</button><button class="btn primary" data-r="1">${esc(si)}</button></div>`;
    dl.onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; dl.close(); ok(b.dataset.r === '1'); };
    dl.oncancel = () => ok(false);
    dl.showModal();
  });
}
const nombreArchivo = ext => `Dictamen_${S.alumno.expediente}_${(S.alumno.nombre || 'aspirante').replace(/\s+/g, '_')}.${ext}`;
let excelListo = null;
function cargarExcelJS() {
  return excelListo ||= new Promise((ok, mal) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/exceljs.min.js'; sc.onload = ok; sc.onerror = () => mal(new Error('no se pudo cargar ExcelJS'));
    document.head.appendChild(sc);
  });
}
async function exportarExcel() {
  try { await cargarExcelJS(); } catch (e) { return exportarExcelSimple(); }
  const { p, r, ini, filas } = datosDictamen(), a = S.alumno, res = resultadoTexto(r);
  const po = tramiteInterno() && planesDeOrigen()[0];
  const AZUL = 'FF16345F', AZUL2 = 'FF2B6CB0', GRIS = 'FF6B7488', LINEA = 'FFD9E1EC', FONDO = 'FFF4F7FB', FONDO2 = 'FFFAFBFD';
  const COLOR = { ok: ['FF1F8A4C', 'FFE6F5EC'], bad: ['FFC53030', 'FFFDEAEA'], rev: ['FFB7791F', 'FFFDF3E1'] }[res.clase];
  const wb = new ExcelJS.Workbook();
  wb.creator = INST || 'Predictamen de equivalencias'; wb.created = new Date();
  const ws = wb.addWorksheet('Dictamen', {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 }, horizontalCentered: true },
    headerFooter: { oddFooter: `&L&8&K6B7488${(INST || 'Predictamen de equivalencias').replace(/&/g, '&&')} · ${a.expediente}&R&8&K6B7488Página &P de &N` },
  });
  ws.columns = [{ width: 24 }, { width: 46 }, { width: 46 }, { width: 10 }, { width: 20 }, { width: 28 }];
  const fuente = (extra = {}) => ({ name: 'Calibri', size: 10, color: { argb: 'FF1B2333' }, ...extra });
  const relleno = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const borde = (c = LINEA) => ({ style: 'thin', color: { argb: c } });
  const todos = c => ({ top: borde(c), left: borde(c), bottom: borde(c), right: borde(c) });
  let n = 1;
  // Encabezado
  if (INST) { ws.mergeCells(n, 1, n, 6); Object.assign(ws.getCell(n, 1), { value: INST, font: fuente({ size: 16, bold: true, color: { argb: AZUL } }) }); ws.getRow(n).height = 24; n++; }
  ws.mergeCells(n, 1, n, 6); Object.assign(ws.getCell(n, 1), { value: 'DICTAMEN PREVIO DE EQUIVALENCIA DE ESTUDIOS', font: fuente({ size: 12, bold: true, color: { argb: GRIS } }) });
  ws.getRow(n).height = 20;
  for (let c = 1; c <= 6; c++) ws.getCell(n, c).border = { bottom: { style: 'medium', color: { argb: AZUL } } };
  n += 2;
  // Datos del alumno (etiqueta + valor, en dos columnas)
  const pares = [['Aspirante', a.nombre, 'Expediente', a.expediente],
    ['Programa', `${p.nivel} en ${p.nombre} (${p.modalidad})`, 'RVOE', p.rvoe],
    ['Institución de origen', a.institucion, 'Tipo de trámite', a.tramite],
    ['Periodo sugerido', `${r.k}° ${p.unidad} · inicia ${ini}`, 'Fecha', new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })]];
  if (po) pares.push(['Programa de origen', `${po.p.nivel} en ${po.p.nombre}`, '', '']);
  pares.forEach(([e1, v1, e2, v2]) => {
    ws.mergeCells(n, 2, n, 3); ws.mergeCells(n, 4, n, 5);
    const et = { font: fuente({ size: 9, bold: true, color: { argb: GRIS } }), alignment: { vertical: 'middle' } };
    Object.assign(ws.getCell(n, 1), { value: e1.toUpperCase(), ...et });
    Object.assign(ws.getCell(n, 2), { value: v1 || '—', font: fuente({ bold: true }), alignment: { vertical: 'middle', wrapText: true } });
    Object.assign(ws.getCell(n, 4), { value: e2.toUpperCase(), ...et });
    Object.assign(ws.getCell(n, 6), { value: v2 || '', font: fuente({ bold: true }), alignment: { vertical: 'middle' } });
    for (let c = 1; c <= 6; c++) { ws.getCell(n, c).fill = relleno(FONDO); ws.getCell(n, c).border = { bottom: borde() }; }
    ws.getRow(n).height = 20; n++;
  });
  n++;
  // Resultado
  ws.mergeCells(n, 1, n, 6);
  Object.assign(ws.getCell(n, 1), {
    value: `RESULTADO: ${res.txt}     ·     ${r.eq} de ${r.total} materias equivalentes${r.pos ? ` (${r.pos} por confirmar)` : ''}     ·     ${r.ev.pend.length} por regularizar (${(r.ev.pct * 100).toFixed(0)}% del plan)     ·     Ingreso: ${r.k}° ${p.unidad}`,
    font: fuente({ size: 11, bold: true, color: { argb: COLOR[0] } }), fill: relleno(COLOR[1]),
    alignment: { vertical: 'middle', horizontal: 'left', indent: 1 }, border: { left: { style: 'thick', color: { argb: COLOR[0] } } } });
  ws.getRow(n).height = 26; n++;
  if (r.ev.motivos.length && res.clase === 'bad') {
    ws.mergeCells(n, 1, n, 6);
    Object.assign(ws.getCell(n, 1), { value: r.ev.motivos.join(' · '), font: fuente({ size: 9, italic: true, color: { argb: COLOR[0] } }), alignment: { indent: 1 } }); n++;
  }
  n++;
  // Tabla principal
  const enc = n;
  ['Ciclo', INST || 'Plan destino', 'Institución de origen', 'Calif.', 'Estatus', 'Periodo para cursarla'].forEach((t, i) => {
    Object.assign(ws.getCell(n, i + 1), { value: t, font: fuente({ bold: true, color: { argb: 'FFFFFFFF' } }), fill: relleno(AZUL),
      alignment: { vertical: 'middle', horizontal: i === 3 ? 'center' : 'left', wrapText: true, indent: i === 3 ? 0 : 1 }, border: todos(AZUL) });
  });
  ws.getRow(n).height = 24; n++;
  ws.views = [{ state: 'frozen', ySplit: enc, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${enc}:${enc}`;
  const COL_EST = { EQUIVALENTE: 'FF1F8A4C', 'POSIBLE EQUIVALENCIA': 'FFB7791F', PENDIENTE: GRIS };
  let ini0 = n, cAnt = null, par = false;
  const cerrarCiclo = () => { if (cAnt != null && n - 1 > ini0) ws.mergeCells(ini0, 1, n - 1, 1); };
  filas.forEach(f => {
    if (f.c !== cAnt) { cerrarCiclo(); cAnt = f.c; ini0 = n; par = !par; }
    const fondo = par ? 'FFFFFFFF' : FONDO2, pend = f.estatus === 'PENDIENTE';
    const regu = pend && f.periodo && !/\d{4}/.test(f.periodo);
    const fila = [f.ciclo, f.iuv, pend ? 'Por cursar' : f.origen, f.cal === '' ? null : +f.cal, f.estatus.charAt(0) + f.estatus.slice(1).toLowerCase(), f.periodo];
    fila.forEach((v, i) => {
      const cel = ws.getCell(n, i + 1);
      cel.value = v; cel.fill = relleno(fondo); cel.border = todos();
      cel.font = fuente(i === 0 ? { bold: true, color: { argb: AZUL } } : i === 2 && pend ? { italic: true, color: { argb: GRIS } } : i === 3 ? { bold: true } : i === 4 ? { bold: true, size: 9, color: { argb: COL_EST[f.estatus] } } : {});
      cel.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 3 ? 'center' : 'left', indent: i === 3 ? 0 : 1 };
      if (i === 5 && regu) { cel.fill = relleno('FFFDF3E1'); cel.font = fuente({ bold: true, color: { argb: 'FFB7791F' } }); }
    });
    ws.getRow(n).height = Math.max(18, 15 * Math.ceil(Math.max(f.iuv.length, (pend ? 0 : f.origen.length)) / 48));
    n++;
  });
  cerrarCiclo();
  n++;
  // Materias no utilizadas
  ws.mergeCells(n, 2, n, 3);
  [[2, 'Materias de procedencia no utilizadas'], [4, 'Calif.']].forEach(([c, t]) => Object.assign(ws.getCell(n, c), {
    value: t, font: fuente({ bold: true, color: { argb: AZUL } }), fill: relleno('FFDFE7F3'), border: todos(), alignment: { indent: 1, horizontal: c === 4 ? 'center' : 'left' } }));
  n++;
  (r.noUsadas.length ? r.noUsadas : [{ n: 'Ninguna', cal: null }]).forEach(o => {
    ws.mergeCells(n, 2, n, 3);
    Object.assign(ws.getCell(n, 2), { value: o.n, font: fuente(), border: todos(), alignment: { indent: 1, wrapText: true } });
    Object.assign(ws.getCell(n, 4), { value: o.cal ?? null, font: fuente({ bold: true }), border: todos(), alignment: { horizontal: 'center' } });
    n++;
  });
  n++;
  ws.mergeCells(n, 1, n, 6);
  Object.assign(ws.getCell(n, 1), { value: 'Este documento es un predictamen informativo; la equivalencia definitiva está sujeta a la revisión de la documentación oficial.',
    font: fuente({ size: 9, italic: true, color: { argb: GRIS } }) });
  n += 4;
  // Firmas
  [[2, 'Elaboró'], [5, 'Vo. Bo. Control Escolar']].forEach(([c, t]) => {
    if (c === 5) ws.mergeCells(n, 5, n, 6);
    Object.assign(ws.getCell(n, c), { value: t, font: fuente({ size: 9, color: { argb: GRIS } }), alignment: { horizontal: 'center' }, border: { top: borde('FF1B2333') } });
    if (c === 5) ws.getCell(n, 6).border = { top: borde('FF1B2333') };
  });
  const buf = await wb.xlsx.writeBuffer();
  descargar(nombreArchivo('xlsx'), new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
// Dictamen en PDF generado (para claude.ai, donde no se puede imprimir). Mismo contenido y diseño que el impreso.
let pdfListo = null;
function cargarScript(src) { return new Promise((ok, mal) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = () => mal(new Error('no cargó ' + src)); document.head.appendChild(sc); }); }
async function exportarPDF() {
  try { await (pdfListo ||= cargarScript('vendor/jspdf.umd.min.js').then(() => cargarScript('vendor/jspdf.plugin.autotable.min.js'))); }
  catch (e) { pdfListo = null; return toast('No se pudo preparar el PDF'); }
  const { p, r, ini, filas } = datosDictamen(), a = S.alumno, res = resultadoTexto(r);
  const po = tramiteInterno() && planesDeOrigen()[0];
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), M = 34;
  const AZUL = [22, 52, 95], GRIS = [107, 116, 136], TINTA = [27, 35, 51], FONDO = [244, 247, 251];
  const SELLO = { ok: [31, 138, 76], bad: [197, 48, 48], rev: [183, 121, 31] }[res.clase];
  const FONDOSELLO = { ok: [242, 250, 245], bad: [253, 244, 244], rev: [253, 248, 238] }[res.clase];
  const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  let y = M + 6;
  // Encabezado
  if (INST) { doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...AZUL).text(INST, M, y + 8); y += 18; }
  doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...GRIS).text('DICTAMEN PREVIO DE EQUIVALENCIA DE ESTUDIOS', M, y + 6, { charSpace: 0.8 });
  doc.setFontSize(7).text('EXPEDIENTE', W - M, M + 2, { align: 'right' });
  doc.setFontSize(11).setTextColor(...AZUL).text(a.expediente, W - M, M + 15, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS).text(fecha.toUpperCase(), W - M, M + 26, { align: 'right' });
  y = Math.max(y + 14, M + 34);
  doc.setDrawColor(...AZUL).setLineWidth(1.6).line(M, y, W - M, y); y += 10;
  // Datos del alumno
  const datos = [['ASPIRANTE', a.nombre], ['RVOE', p.rvoe], ['PROGRAMA', `${p.nivel} en ${p.nombre} (${p.modalidad})`], ['INSTITUCIÓN DE ORIGEN', a.institucion],
    ['TIPO DE TRÁMITE', a.tramite], ['PERIODO SUGERIDO DE INGRESO', `${r.k}° ${p.unidad} · inicia ${ini}`]];
  if (po) datos.push(['PROGRAMA DE ORIGEN (MISMA INSTITUCIÓN)', `${po.p.nivel} en ${po.p.nombre}`], ['', '']);
  const colW = (W - 2 * M - 30) / 2, filasDatos = Math.ceil(datos.length / 2);
  doc.setFillColor(...FONDO).roundedRect(M, y, W - 2 * M, filasDatos * 25 + 10, 4, 4, 'F');
  datos.forEach(([et, v], i) => {
    const x = M + 12 + (i % 2) * (colW + 10), yy = y + 14 + Math.floor(i / 2) * 25;
    doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...GRIS).text(et, x, yy);
    doc.setFontSize(8.8).setTextColor(...TINTA).text(doc.splitTextToSize(v || (et ? '—' : ''), colW)[0] || '', x, yy + 10);
  });
  y += filasDatos * 25 + 20;
  // Resultado
  doc.setFillColor(...FONDOSELLO).setDrawColor(...SELLO).setLineWidth(0.6).roundedRect(M, y, W - 2 * M, 40, 4, 4, 'FD');
  doc.setFillColor(...SELLO).rect(M, y, 3.5, 40, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(10.5);
  const anchoSello = doc.getTextWidth(res.txt) + 18;
  doc.roundedRect(M + 14, y + 11, anchoSello, 18, 3, 3, 'F').setTextColor(255, 255, 255).text(res.txt, M + 23, y + 23.5);
  const cifras = [[`${r.eq}/${r.total}`, `materias equivalentes${r.pos ? ` · ${r.pos} por confirmar` : ''}`], [`${r.ev.pend.length}`, `por regularizar (${(r.ev.pct * 100).toFixed(0)}% del plan)`], [`${r.k}°`, `${p.unidad} de ingreso`]];
  let cx = M + 14 + anchoSello + 22;
  cifras.forEach(([n, t]) => {
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...AZUL).text(n, cx, y + 19);
    doc.setFont('helvetica', 'normal').setFontSize(6.8).setTextColor(...GRIS).text(t, cx, y + 30);
    cx += Math.max(doc.getTextWidth(t), 40) + 22;
  });
  y += 50;
  if (r.ev.motivos.length && res.clase === 'bad') { doc.setFontSize(7.5).setTextColor(...SELLO).text(r.ev.motivos.join(' · '), M, y); y += 10; }
  // Tabla principal (el ciclo en una sola celda por grupo)
  const porCiclo = {}; filas.forEach(f => porCiclo[f.c] = (porCiclo[f.c] || 0) + 1);
  let cAnt = null;
  const cuerpo = filas.map(f => {
    const pend = f.estatus === 'PENDIENTE', fila = [];
    if (f.c !== cAnt) { cAnt = f.c; fila.push({ content: f.ciclo, rowSpan: porCiclo[f.c], styles: { fontStyle: 'bold', textColor: AZUL, fillColor: [238, 243, 250], valign: 'middle' } }); }
    fila.push(f.iuv,
      pend ? { content: 'Por cursar', styles: { fontStyle: 'italic', textColor: [138, 147, 166] } } : f.origen + (f.estatus === 'POSIBLE EQUIVALENCIA' ? '  (por confirmar)' : ''),
      { content: f.cal === '' ? '' : String(f.cal), styles: { halign: 'center', fontStyle: 'bold' } },
      pend && f.periodo && !/\d{4}/.test(f.periodo) ? { content: f.periodo, styles: { fontStyle: 'bold', textColor: [154, 99, 18], fillColor: [253, 243, 225] } } : f.periodo);
    return fila;
  });
  doc.autoTable({
    startY: y, margin: { left: M, right: M, top: M, bottom: M + 10 }, theme: 'plain',
    head: [['Ciclo', INST || 'Plan destino', 'Institución de origen', 'Calif.', 'Periodo para cursarla']], body: cuerpo,
    styles: { font: 'helvetica', fontSize: 7.8, cellPadding: { top: 3.2, bottom: 3.2, left: 5, right: 5 }, textColor: TINTA, lineColor: [227, 232, 240], lineWidth: { bottom: 0.5 }, valign: 'middle' },
    headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 7.6 },
    columnStyles: { 0: { cellWidth: 62 }, 3: { cellWidth: 34 }, 4: { cellWidth: 98 } },
  });
  y = doc.lastAutoTable.finalY + 14;
  // Materias de procedencia no utilizadas
  doc.autoTable({
    startY: y, margin: { left: M, right: M, top: M, bottom: M + 10 }, theme: 'plain',
    head: [['Materias de procedencia no utilizadas', 'Calif.']],
    body: r.noUsadas.length ? r.noUsadas.map(o => [o.n, { content: o.cal ?? '', styles: { halign: 'center', fontStyle: 'bold' } }]) : [[{ content: 'Ninguna', styles: { fontStyle: 'italic', textColor: [138, 147, 166] } }, '']],
    styles: { font: 'helvetica', fontSize: 7.8, cellPadding: 3.2, textColor: TINTA, lineColor: [227, 232, 240], lineWidth: { bottom: 0.5 } },
    headStyles: { fillColor: [223, 231, 243], textColor: AZUL, fontStyle: 'bold' }, columnStyles: { 1: { cellWidth: 44 } },
  });
  y = doc.lastAutoTable.finalY + 14;
  // Nota y firmas
  const H = doc.internal.pageSize.getHeight();
  if (y + 80 > H - M) { doc.addPage(); y = M + 10; }
  doc.setFont('helvetica', 'italic').setFontSize(7.3).setTextColor(...GRIS).text('Este documento es un predictamen informativo; la equivalencia definitiva está sujeta a la revisión de la documentación oficial.', M, y);
  y += 52;
  const fw = (W - 2 * M - 80) / 2;
  [['Elaboró', M + 20], ['Vo. Bo. Control Escolar', M + 60 + fw]].forEach(([t, x]) => {
    doc.setDrawColor(...TINTA).setLineWidth(0.6).line(x, y, x + fw, y);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS).text(t, x + fw / 2, y + 11, { align: 'center' });
  });
  // Número de página
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(138, 147, 166).text(`Página ${i} de ${n}`, W - M, H - 18, { align: 'right' }); }
  await descargar(nombreArchivo('pdf'), doc.output('blob'));
}
// Respaldo sin formato (si por algo no carga ExcelJS)
function exportarExcelSimple() {
  const { p, r, ini, filas } = datosDictamen(), a = S.alumno;
  const aoa = [[INST.toUpperCase()], ['DICTAMEN PREVIO DE EQUIVALENCIA DE ESTUDIOS'], [],
    ['Aspirante:', a.nombre, '', 'RVOE:', p.rvoe], ['Programa:', `${p.nivel} en ${p.nombre}`, '', 'Institución de origen:', a.institucion],
    ['Expediente:', a.expediente, '', 'Periodo sugerido:', `${r.k}° ${p.unidad} (inicia ${ini})`], ['Tipo de trámite:', a.tramite, '', 'Resultado:', r.ev.cumple ? 'CUMPLE' : 'NO CUMPLE'], [],
    ['Ciclo', INST || 'Plan destino', 'Institución de origen', 'Calificación', 'Estatus', 'Periodo para cursarla'],
    ...filas.map(f => [f.ciclo, f.iuv, f.origen, f.cal, f.estatus, f.periodo]), [], ['Materias de procedencia no utilizadas', 'Calificación'],
    ...r.noUsadas.map(o => [o.n, o.cal ?? ''])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 48 }, { wch: 48 }, { wch: 11 }, { wch: 20 }, { wch: 30 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dictamen');
  descargar(nombreArchivo('xlsx'), new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })]));
}
function guardar() {
  if (!S.planId) return toast('Elige la carrera primero');
  const g = leerGuardados().filter(e => e.alumno.expediente !== S.alumno.expediente);
  g.unshift(exportable()); guardarLS(STORE, g);
  aprender();
  toast('Expediente guardado · las equivalencias que confirmaste se usarán en los siguientes');
}
function pintarHistorial() {
  const g = leerGuardados();
  $('#histLista').innerHTML = g.length ? g.map((e, i) => `<div class="hist-item"><div><b>${esc(e.alumno.expediente)}</b> · ${esc(e.alumno.nombre)}<br><small class="muted">${esc(e.resultado?.plan?.nombre || '')} · ${new Date(e.guardado).toLocaleString('es-MX')} · ${e.resultado?.cumple ? 'CUMPLE' : 'NO CUMPLE'}</small></div><div><button class="btn sm" data-abrir="${i}">Abrir</button> <button class="del" data-borrar="${i}">✕</button></div></div>`).join('') : '<p class="muted">Aún no hay expedientes guardados.</p>';
}
function abrir(e) {
  const { guardado, resultado, ...estado } = e;
  S = { ...nuevoEstado(), ...estado };
  pintarTodo(); $('#dlgHistorial').close(); toast('Expediente abierto');
}

/* ---------------- Eventos ---------------- */
function toast(t, fijo = false) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), fijo ? 8000 : 3500); }

['nombre', 'tramite', 'institucion', 'expediente'].forEach(id => $('#' + id).addEventListener('input', e => { S.alumno[id] = e.target.value; id === 'tramite' ? (pintarRevision(), pintarSugerenciaPlan()) : pintarDictamen0(); }));
const pintarDictamen0 = () => { if (plan() && S.origen.length) pintarDictamen(); };

$('#buscaPlan').addEventListener('input', e => $('#listaPlanes').innerHTML = listaPlanesHTML(buscarPlanes(e.target.value)));
$('#listaPlanes').addEventListener('click', e => {
  const it = e.target.closest('.plan-item'); if (!it) return;
  S.planId = it.dataset.id; S.manual = {}; $('#buscaPlan').value = '';
  const r = emparejar(); pintarTodo(); analizarConAnimacion(r);
});
$('#buscaOrigen').addEventListener('input', e => $('#listaOrigen').innerHTML = listaPlanesHTML(buscarPlanes(e.target.value)));
$('#listaOrigen').addEventListener('click', e => {
  const it = e.target.closest('.plan-item'); if (!it) return;
  const p = PLANES.find(x => x.id === it.dataset.id);
  if (!S.alumno.institucion) S.alumno.institucion = INST || 'Misma institución';
  S.planOrigenId = p.id;
  cargarOrigen(p.materias.map(m => ({ n: m.n, cal: null, per: `${m.c}° ${p.unidad}` })), `${p.nombre} (RVOE ${p.rvoe}) — captura las calificaciones`, true);
  $('#listaOrigen').innerHTML = ''; $('#buscaOrigen').value = '';
  $('#tablaOrigen').scrollIntoView({ behavior: 'smooth' });
});

const drop = $('#drop'), inFile = $('#archivo');
drop.onclick = () => inFile.click();
$('#elegirArchivo').onclick = e => { e.preventDefault(); e.stopPropagation(); inFile.click(); };
inFile.onchange = () => leerArchivos(inFile.files).finally(() => inFile.value = '');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => leerArchivos(e.dataTransfer.files));
$('#btnPegado').onclick = () => { cargarOrigen(parseLineas($('#pegado').value), 'la lista pegada', true); $('#pegado').value = ''; };
$('#minima').addEventListener('change', e => { S.minima = aNumero(e.target.value) ?? 6; emparejar(); pintarOrigen(); pintarRevision(); });

$('#tablaOrigen').addEventListener('change', e => {
  const i = e.target.dataset.o; if (i == null) return;
  const f = e.target.dataset.f, o = S.origen[i];
  o[f] = f === 'cal' ? aNumero(e.target.value) : e.target.value;
  if (f === 'cal') e.target.value = o.cal ?? '';
  if (f === 'per') return;
  // se actualiza sólo ese renglón (sin redibujar la tabla, para no perder lo que estás escribiendo)
  const tr = e.target.closest('tr');
  tr.querySelector('.estado-o').innerHTML = chipOrigen(o) + (o.manual ? ' <span class="chip manual">A mano</span>' : '');
  tr.querySelector('[data-f="cal"]').classList.toggle('falta', o.cal == null);
  $('#conteoOrigen').textContent = `${S.origen.length} materias · ${S.origen.filter(acreditada).length} acreditadas · ${S.origen.filter(x => !acreditada(x)).length} no acreditadas / sin calificación`;
  emparejar(); pintarRevision();
});
$('#tablaOrigen').addEventListener('keydown', e => {
  if (e.key === 'Enter' && ['manNombre', 'manCal', 'manPer'].includes(e.target.id)) { e.preventDefault(); agregarAMano(); }
});
$('#tablaOrigen').addEventListener('click', e => {
  if (e.target.id === 'manAgregar') return agregarAMano();
  if (e.target.dataset.del != null) {
    const o = S.origen[+e.target.dataset.del];
    S.origen.splice(+e.target.dataset.del, 1);
    Object.keys(S.manual || {}).forEach(mi => S.manual[mi] = S.manual[mi].filter(id => id !== o.id));
    emparejar(); pintarOrigen(); pintarRevision();
  }
  if (e.target.id === 'vaciarOrigen') preguntar('¿Quitar TODAS las materias, también las capturadas a mano?', 'Quitar todas').then(si => { if (si) { S.origen = []; S.manual = {}; emparejar(); pintarOrigen(); pintarRevision(); } });
  if (e.target.id === 'reEmparejar') { const r = emparejar(); pintarRevision(); analizarConAnimacion(r); }
});

$('#revision').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.nota != null) { S.notas[t.dataset.nota] = t.value; pintarDictamen(); }
});
function asignar(mi, oi) {
  // A mano sí se permite usar la misma materia de origen en dos materias destino (los asesores lo hacen).
  S.asig[mi] = [...new Set([...(S.asig[mi] || []), oi])]; fijar(mi);
  S.periodo = null; pintarRevision();
}
function quitar(mi, oi) {
  S.asig[mi] = (S.asig[mi] || []).filter(x => x !== oi);
  fijar(mi);
  if (!S.asig[mi].length) { delete S.asig[mi]; delete S.conf[mi]; }
  S.periodo = null; pintarRevision();
}
$('#revision').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.ok != null) { fijar(+t.dataset.ok); pintarRevision(); }
  if (t.dataset.quitar) { const [mi, oi] = t.dataset.quitar.split(':').map(Number); quitar(mi, oi); }
  if (t.dataset.elegir != null) abrirSelector(+t.dataset.elegir, t);
});

/* ---------------- Selector de materia de origen (con búsqueda y sugerencias) ---------------- */
// "FUNDAMENTOS DE QUIMICA" → "Fundamentos de quimica" (sólo para mostrar; los números romanos se respetan)
function bonito(n) {
  if (/[a-záéíóúñ]/.test(n)) return n;
  return n.toLowerCase().replace(/(^|\s)(i{1,3}|iv|v|vi{1,3}|ix|x)(?=\s|$)/g, (m, a, r) => a + r.toUpperCase()).replace(/^./, c => c.toUpperCase());
}
const sinAcentos = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let selector = null;
function cerrarSelector() { if (selector) { selector.el.remove(); selector = null; } }
function abrirSelector(mi, boton) {
  cerrarSelector();
  const p = plan(), df = pesosDePlan(p.materias), m = p.materias[mi];
  const usadaEn = {}; Object.entries(S.asig).forEach(([k, os]) => os.forEach(oi => usadaEn[oi] = +k));
  const lista = S.origen.map((o, oi) => ({ o, oi, s: similitud(o.n, m.n, df) }))
    .filter(x => acreditada(x.o) && !(S.asig[mi] || []).includes(x.oi));
  const el = document.createElement('div');
  el.className = 'selector';
  el.innerHTML = `<div class="sel-head"><small>Materia de origen equivalente a</small><b>${esc(m.n)}</b>
      <input placeholder="Buscar entre ${lista.length} materias acreditadas…" autocomplete="off"></div><div class="sel-lista"></div>
    <div class="sel-pie">↑↓ para moverte · Enter para elegir · Esc para cerrar</div>`;
  document.body.appendChild(el);
  const r = boton.getBoundingClientRect();
  el.style.top = `${window.scrollY + r.bottom + 6}px`;
  el.style.left = `${Math.max(12, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 12))}px`;
  const input = el.querySelector('input'), cont = el.querySelector('.sel-lista');
  const item = x => `<button class="sel-item" data-oi="${x.oi}"><span class="sel-nom">${esc(bonito(x.o.n))}${usadaEn[x.oi] != null ? `<em>también se usa en «${esc(p.materias[usadaEn[x.oi]].n)}»</em>` : ''}</span><span class="sel-cal">${x.o.cal}</span>${x.s >= 0.35 ? `<span class="sel-sim"><i style="width:${Math.round(x.s * 100)}%"></i></span>` : '<span class="sel-sim vacia"></span>'}</button>`;
  const pintar = () => {
    const q = sinAcentos(input.value.trim());
    const filtro = x => !q || q.split(/\s+/).every(w => sinAcentos(x.o.n).includes(w));
    const sug = q ? [] : lista.filter(x => x.s >= 0.35).sort((a, b) => b.s - a.s).slice(0, 6);
    const resto = lista.filter(filtro).filter(x => !sug.includes(x)).sort((a, b) => q ? b.s - a.s : sinAcentos(a.o.n).localeCompare(sinAcentos(b.o.n)));
    cont.innerHTML = (sug.length ? `<div class="sel-sec">Sugeridas por parecido</div>${sug.map(item).join('')}` : '')
      + (resto.length ? `<div class="sel-sec">${q ? 'Resultados' : 'Todas (A–Z)'}</div>${resto.map(item).join('')}` : `<div class="sel-vacio">Nada coincide con «${esc(input.value)}»</div>`);
    const primero = cont.querySelector('.sel-item'); if (primero) primero.classList.add('activo');
  };
  const mover = d => {
    const its = [...cont.querySelectorAll('.sel-item')]; if (!its.length) return;
    let i = its.findIndex(x => x.classList.contains('activo'));
    its[i]?.classList.remove('activo'); i = Math.max(0, Math.min(its.length - 1, i + d));
    its[i].classList.add('activo'); its[i].scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', pintar);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); const a = cont.querySelector('.sel-item.activo'); if (a) { cerrarSelector(); asignar(mi, +a.dataset.oi); } }
    else if (e.key === 'Escape') cerrarSelector();
  });
  cont.addEventListener('click', e => { const b = e.target.closest('.sel-item'); if (b) { cerrarSelector(); asignar(mi, +b.dataset.oi); } });
  selector = { el, boton };
  pintar(); input.focus();
}
document.addEventListener('mousedown', e => { if (selector && !selector.el.contains(e.target) && e.target !== selector.boton) cerrarSelector(); });
window.addEventListener('resize', cerrarSelector);
$('#kpis').addEventListener('click', e => {
  if (e.target.id !== 'aceptarTodas') return;
  const p = plan(); let n = 0;
  p.materias.forEach((m, mi) => { if (estado(mi) === 'posible') { fijar(mi); n++; } });
  S.periodo = null; pintarRevision();
  toast(`${n} equivalencias aceptadas. Si alguna no va, quítala con ×`);
});
$('#periodoSug').onchange = e => { S.periodo = +e.target.value; pintarRevision(); };
$('#inicio').onchange = e => { S.inicio = +e.target.value; pintarDictamen(); };
$('#btnImprimir').onclick = () => { if (enClaude()) return exportarPDF(); pintarDictamen(); window.print(); };
if (enClaude()) $('#btnImprimir').textContent = 'Descargar PDF';
$('#btnExcel').onclick = exportarExcel;
$('#btnGuardar').onclick = guardar;
$('#btnJSON').onclick = () => descargar(nombreArchivo('json'), new Blob([JSON.stringify(exportable(), null, 2)], { type: 'application/json' }));
$('#btnNuevo').onclick = async () => {
  if (S.origen.length && !(await preguntar('¿Empezar un expediente nuevo? Lo que no guardaste se pierde.', 'Empezar nuevo'))) return;
  S = nuevoEstado(); $('#selExpediente').hidden = true; pintarTodo(); window.scrollTo({ top: 0, behavior: 'smooth' });
};
$('#btnHistorial').onclick = () => { pintarHistorial(); $('#dlgHistorial').showModal(); };
$('#histLista').addEventListener('click', e => {
  const g = leerGuardados();
  if (e.target.dataset.abrir != null) abrir(g[e.target.dataset.abrir]);
  if (e.target.dataset.borrar != null) { const i = +e.target.dataset.borrar; preguntar('¿Borrar este expediente guardado?', 'Borrar').then(si => { if (si) { g.splice(i, 1); guardarLS(STORE, g); pintarHistorial(); } }); }
});
$('#btnImportJSON').onclick = () => $('#fileJSON').click();
$('#fileJSON').onchange = async e => { try { abrir(JSON.parse(await e.target.files[0].text())); } catch { toast('JSON no válido'); } e.target.value = ''; };

pintarTodo();
})();

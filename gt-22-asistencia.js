// ══════════════════════════════════════════════════════════════
//  MÓDULO DE ASISTENCIA (v3.4.0) — archivo NUEVO: gt-22-asistencia.js
//  Marcar entrada/salida por QR (DUI/DPI) o tecleado, vista del día,
//  corte, permisos, reporte y parámetros. Todo pasa por el servidor
//  con la sesión (nada de asistencia se lee del Excel público).
//  Depende de: gt-01/gt-02 (gasPost, navLimpiarTodo, goTab, beep, SESION)
//  y de la librería ZXing que ya carga index.html.
// ══════════════════════════════════════════════════════════════
var ASIS = { dia: null, fecha: null, tab: 0, lector: null, cola: [], procesando: false, ultimo: { codigo: "", ts: 0 }, feed: [], modo: "auto", filtro: "", permCodigo: "", construido: false, timerRefresco: null };

if (typeof NAV_PANTALLAS_MODULO !== "undefined" && NAV_PANTALLAS_MODULO.indexOf("asistenciaScreen") < 0) NAV_PANTALLAS_MODULO.push("asistenciaScreen");
// Si otro módulo cierra la cámara (stopQR), también se cierra la de asistencia.
(function () {
  var orig = window.stopQR;
  if (typeof orig === "function") window.stopQR = function () { try { orig(); } catch (e) {} try { asisDetenerCamara(); } catch (e) {} };
})();

// ── utilidades ──
function asisH(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
// El servidor actual no tolera el signo "%" en los textos (rompe la petición): se cambia por "﹪".
function asisTxt(s) { return String(s == null ? "" : s).replace(/%/g, "﹪").replace(/\s+/g, " ").trim(); }
function asisRol() {
  var r = ((typeof SESION !== "undefined" && SESION && SESION.rol) || "").toString().trim().toLowerCase();
  if (r === "admin" || r === "administrador") return "admin";
  if (r === "supervisor") return "supervisor";
  if (r === "solo lectura" || r === "sololectura" || r === "lectura") return "lectura";
  return "operador";
}
function asisEsAdmin() { return asisRol() === "admin"; }
function asisEsGestion() { var r = asisRol(); return r === "admin" || r === "supervisor"; }
function asisFechaLeg(iso) { if (!iso) return ""; var p = iso.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function asisEl(id) { return document.getElementById(id); }
function asisToast(msg, tipo) {
  var t = asisEl("asisToast"); if (!t) return;
  t.textContent = msg; t.style.background = tipo === "err" ? "#C00000" : (tipo === "warn" ? "#B26A00" : "#375623");
  t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = "none"; }, tipo === "err" ? 6000 : 3500);
}
function asisBloq(id, txt) { var b = asisEl(id); return (typeof _bloquearBoton === "function") ? { btn: b, ok: _bloquearBoton(b, id, txt) } : { btn: b, ok: true }; }
function asisLibera(o, id) { if (typeof _liberarBoton === "function") _liberarBoton(o.btn, id); }

// ── abrir / cerrar ──
function abrirAsistencia() {
  navLimpiarTodo();
  var mm = asisEl("menuMas"); if (mm) mm.style.display = "none";
  var tabs = document.querySelector(".tabs"); if (tabs) tabs.style.display = "none";
  document.querySelectorAll("#appContent > .scr").forEach(function (s) { s.style.display = "none"; });
  asisConstruir();
  asisEl("asistenciaScreen").style.display = "block";
  asisGoTab(0);
  asisCargarDia(null);
}
function cerrarAsistencia() {
  asisDetenerCamara();
  var e = asisEl("asistenciaScreen"); if (e) e.style.display = "none";
  var tabs = document.querySelector(".tabs"); if (tabs) tabs.style.display = "flex";
  document.querySelectorAll("#appContent > .scr").forEach(function (s) { s.style.display = ""; });
  goTab(NAV_TAB_ACTUAL);
}

// ── construcción de la pantalla (una sola vez) ──
function asisConstruir() {
  var viejo = asisEl("asistenciaScreen");
  var quien = ((typeof SESION !== "undefined" && SESION && SESION.usuario) || "") + "|" + asisRol();
  if (viejo && ASIS.construido && ASIS.construidoPara === quien) return;   // misma persona y mismo rol: se reutiliza
  // otra persona o rol distinto (o primera vez): se reconstruye y se limpia lo anterior
  asisDetenerCamara();
  ASIS.dia = null; ASIS.fecha = null; ASIS.feed = []; ASIS.cola = []; ASIS.procesando = false; ASIS.permCodigo = ""; ASIS.rep = null; ASIS.filtro = ""; ASIS.modo = "auto";
  if (viejo) viejo.parentNode.removeChild(viejo);
  var g = asisEsGestion(), a = asisEsAdmin();
  var estilo = "<style>"
    + "#asistenciaScreen .asis-chip{display:inline-block;padding:4px 9px;border-radius:12px;font-size:11px;font-weight:bold;margin:2px 3px 2px 0;background:#EBF7ED;color:#1B4332}"
    + "#asistenciaScreen .asis-fila{border:1px solid #eee;border-left:5px solid #bbb;border-radius:6px;padding:8px 9px;margin-bottom:6px;background:#fff}"
    + "#asistenciaScreen .asis-Presente{border-left-color:#375623}#asistenciaScreen .asis-Tarde{border-left-color:#F4B942}#asistenciaScreen .asis-Falta{border-left-color:#C00000}"
    + "#asistenciaScreen .asis-Permiso{border-left-color:#2F75B5}#asistenciaScreen .asis-SinRegistro{border-left-color:#bbb}"
    + "#asistenciaScreen .asis-sub{font-size:11px;color:#666;margin-top:3px}#asistenciaScreen .asis-al{font-size:11px;color:#9C5700;margin-top:3px}"
    + "#asistenciaScreen .asis-feed{border-radius:6px;padding:8px 9px;margin-bottom:5px;font-size:12px;border-left:5px solid #375623;background:#EBF7ED}"
    + "#asistenciaScreen .asis-feed.warn{border-left-color:#F4B942;background:#FFF7E0}#asistenciaScreen .asis-feed.err{border-left-color:#C00000;background:#FCE4E4}#asistenciaScreen .asis-feed.info{border-left-color:#2F75B5;background:#EAF2FA}"
    + "#asistenciaScreen table{width:100%;border-collapse:collapse;font-size:11px}#asistenciaScreen th,#asistenciaScreen td{border-bottom:1px solid #eee;padding:5px 3px;text-align:center}"
    + "#asistenciaScreen th{background:#EBF7ED;color:#1B4332}#asistenciaScreen td:first-child,#asistenciaScreen th:first-child{text-align:left}"
    + "#asistenciaScreen .asis-lbl{font-size:11px;color:#555;margin:2px 0 2px;font-weight:bold}"
    + "#asisModal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999;display:none;align-items:center;justify-content:center;padding:14px}"
    + "#asisModal .asis-caja{background:#fff;border-radius:10px;padding:14px;max-width:420px;width:100%;max-height:90vh;overflow:auto}"
    + "</style>";
  var html = estilo
    + "<div id=\"asisToast\" style=\"display:none;position:fixed;left:12px;right:12px;bottom:14px;z-index:1000;color:#fff;padding:10px 12px;border-radius:8px;font-size:13px;font-weight:bold;text-align:center\"></div>"
    + "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px\"><div class=\"ctit\" style=\"margin:0\">🕐 Asistencia</div>"
    + "<button class=\"btn b-sec\" style=\"padding:6px 12px;font-size:12px;width:auto\" onclick=\"cerrarAsistencia()\">← Volver</button></div>"
    + "<div style=\"display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap\">"
    + "<button class=\"btn b-ok b-sm\" id=\"asisB0\" style=\"flex:1\" onclick=\"asisGoTab(0)\">📷 Marcar</button>"
    + "<button class=\"btn b-sec b-sm\" id=\"asisB1\" style=\"flex:1\" onclick=\"asisGoTab(1)\">📋 Hoy</button>"
    + (g ? "<button class=\"btn b-sec b-sm\" id=\"asisB2\" style=\"flex:1\" onclick=\"asisGoTab(2)\">📝 Permisos</button><button class=\"btn b-sec b-sm\" id=\"asisB3\" style=\"flex:1\" onclick=\"asisGoTab(3)\">📊 Reporte</button>" : "")
    + (a ? "<button class=\"btn b-sec b-sm\" id=\"asisB4\" style=\"flex:1\" onclick=\"asisGoTab(4)\">⚙️ Ajustes</button>" : "")
    + "</div>"

    // ── Tab 0: marcar ──
    + "<div id=\"asisT0\">"
    + "<div class=\"card\"><div class=\"ctit\">¿Qué se registra?</div><div style=\"display:flex;gap:6px\">"
    + "<button class=\"btn b-ok b-sm\" id=\"asisM_auto\" style=\"flex:1\" onclick=\"asisSetModo('auto')\">⚡ Automático</button>"
    + "<button class=\"btn b-sec b-sm\" id=\"asisM_entrada\" style=\"flex:1\" onclick=\"asisSetModo('entrada')\">🟢 Entrada</button>"
    + "<button class=\"btn b-sec b-sm\" id=\"asisM_salida\" style=\"flex:1\" onclick=\"asisSetModo('salida')\">🔴 Salida</button></div>"
    + "<div class=\"asis-sub\">Automático: la primera lectura del día es la entrada y la siguiente es la salida.</div></div>"
    + "<div class=\"card\"><div class=\"ctit\">Escanear QR del carnet (varias personas seguidas)</div>"
    + "<button class=\"btn b-blue\" id=\"asisBtnCam\" onclick=\"asisToggleCamara()\">📷 Abrir cámara</button>"
    + "<div class=\"qr-wrap\" id=\"asisQW\"><video id=\"asisQV\" autoplay playsinline muted></video><div class=\"qr-guide\"><span></span></div><div class=\"qr-lbl\">La cámara sigue abierta: pasa un carnet tras otro</div><div class=\"qr-flash\" id=\"asisQF\"></div></div>"
    + "<div class=\"ctit\" style=\"margin-top:6px\">O escribe el código, el DUI/DPI o el número</div>"
    + "<div style=\"display:flex;gap:6px\"><input type=\"text\" id=\"asisCodigo\" placeholder=\"Ej: 14, GT03/RECPER-014 o DUI/DPI\" autocomplete=\"off\" style=\"margin:0\" onkeydown=\"if(event.key==='Enter'){asisMarcarManual();}\">"
    + "<button class=\"btn b-ok\" id=\"asisBtnMarcar\" style=\"width:auto;margin:0;padding:0 16px\" onclick=\"asisMarcarManual()\">✅</button></div>"
    + (a ? "<details style=\"margin-top:10px\"><summary style=\"font-size:12px;font-weight:bold;color:#1B4332\">Ajuste del administrador (solo la próxima entrada)</summary>"
      + "<div class=\"asis-lbl\">Hora de inicio que cuenta (opcional)</div><input type=\"time\" id=\"asisHoraManual\">"
      + "<div class=\"asis-lbl\">Motivo del ajuste (obligatorio si pones hora)</div><input type=\"text\" id=\"asisMotivoManual\" maxlength=\"200\" placeholder=\"Ej: Esperó la charla de seguridad\"></details>" : "")
    + "</div>"
    + "<div class=\"card\"><div class=\"ctit\">Últimos registros</div><div id=\"asisFeed\"><div class=\"empty\"><div class=\"ei\">🕐</div><p>Aquí aparecen las lecturas</p></div></div></div>"
    + "<div class=\"card\"><div class=\"ctit\">Hoy</div><div id=\"asisMini\">Cargando…</div></div>"
    + "</div>"

    // ── Tab 1: hoy ──
    + "<div id=\"asisT1\" style=\"display:none\"><div class=\"card\">"
    + "<div class=\"asis-lbl\">Fecha</div><input type=\"date\" id=\"asisFecha\" onchange=\"asisCargarDia(this.value)\">"
    + "<div id=\"asisResumen\"></div>"
    + "<select id=\"asisFiltro\" onchange=\"ASIS.filtro=this.value;asisRenderHoy()\"><option value=\"\">Ver: todos</option><option>Presente</option><option>Tarde</option><option>Falta</option><option>Permiso</option><option>Sin registro</option><option value=\"__sinsalida\">Sin hora de salida</option></select>"
    + "<div style=\"display:flex;gap:6px;flex-wrap:wrap\">"
    + "<button class=\"btn b-sec b-sm\" onclick=\"asisCargarDia(ASIS.fecha)\">🔄 Actualizar</button>"
    + (g ? "<button class=\"btn b-warn b-sm\" id=\"asisBtnCorte\" onclick=\"asisCorte()\">✂️ Cerrar asistencia (corte)</button>" : "")
    + "<button class=\"btn b-sec b-sm\" onclick=\"asisPDFDia()\">📄 PDF</button>"
    + "<button class=\"btn b-sec b-sm\" onclick=\"asisCopiarDia()\">📲 Copiar resumen</button></div></div>"
    + "<div id=\"asisLista\"></div></div>"

    // ── Tab 2: permisos ──
    + (g ? "<div id=\"asisT2\" style=\"display:none\"><div class=\"card\"><div class=\"ctit\">Registrar permiso (aunque la persona ya figure como falta)</div>"
      + "<div class=\"asis-lbl\">Trabajador</div><input type=\"text\" id=\"asisPermBuscar\" placeholder=\"Buscar por nombre o código…\" autocomplete=\"off\" oninput=\"asisPermBuscar()\">"
      + "<div id=\"asisPermSug\" style=\"display:none;border:1px solid #eee;border-radius:8px;max-height:180px;overflow-y:auto;margin-bottom:7px\"></div>"
      + "<div id=\"asisPermSel\" class=\"asis-sub\" style=\"margin-bottom:6px\"></div>"
      + "<div style=\"display:flex;gap:6px\"><div style=\"flex:1\"><div class=\"asis-lbl\">Desde</div><input type=\"date\" id=\"asisPermDesde\"></div><div style=\"flex:1\"><div class=\"asis-lbl\">Hasta (si son varios días)</div><input type=\"date\" id=\"asisPermHasta\"></div></div>"
      + "<div class=\"asis-lbl\">Tipo</div><select id=\"asisPermTipo\"></select>"
      + "<div class=\"asis-lbl\">Motivo</div><textarea id=\"asisPermMotivo\" rows=\"2\" maxlength=\"300\" placeholder=\"Ej: Cita médica\"></textarea>"
      + "<div style=\"display:flex;gap:6px\"><div style=\"flex:1\"><div class=\"asis-lbl\">¿Cómo avisó?</div><select id=\"asisPermComo\"></select></div><div style=\"flex:1\"><div class=\"asis-lbl\">Hora del aviso</div><input type=\"time\" id=\"asisPermHora\"></div></div>"
      + "<div style=\"display:flex;gap:6px\"><div style=\"flex:1\"><div class=\"asis-lbl\">Goce</div><select id=\"asisPermGoce\"></select></div><div style=\"flex:1\"><div class=\"asis-lbl\">Autorizado por</div><input type=\"text\" id=\"asisPermAut\" maxlength=\"60\"></div></div>"
      + "<button class=\"btn b-ok\" id=\"asisBtnPerm\" onclick=\"asisRegistrarPermiso()\">✅ Registrar permiso</button></div>"
      + "<div class=\"card\"><div class=\"ctit\">Permisos vigentes en la fecha que estás viendo</div><div id=\"asisPermLista\"></div></div></div>" : "")

    // ── Tab 3: reporte ──
    + (g ? "<div id=\"asisT3\" style=\"display:none\"><div class=\"card\"><div class=\"ctit\">Reporte por rango</div>"
      + "<div style=\"display:flex;gap:6px\"><div style=\"flex:1\"><div class=\"asis-lbl\">Desde</div><input type=\"date\" id=\"asisRepDesde\"></div><div style=\"flex:1\"><div class=\"asis-lbl\">Hasta</div><input type=\"date\" id=\"asisRepHasta\"></div></div>"
      + "<button class=\"btn b-blue\" id=\"asisBtnRep\" onclick=\"asisGenerarReporte()\">📊 Generar</button>"
      + "<div style=\"display:flex;gap:6px\"><button class=\"btn b-sec b-sm\" onclick=\"asisPDFReporte()\">📄 PDF</button><button class=\"btn b-sec b-sm\" onclick=\"asisCopiarReporte()\">📲 Copiar</button></div>"
      + "<div id=\"asisRepOut\"></div></div></div>" : "")

    // ── Tab 4: ajustes ──
    + (a ? "<div id=\"asisT4\" style=\"display:none\"><div class=\"card\"><div class=\"ctit\">Parámetros de asistencia</div>"
      + "<div class=\"asis-lbl\">Hora oficial de entrada</div><input type=\"time\" id=\"asisC_asisHoraEntrada\">"
      + "<div class=\"asis-lbl\">Tolerancia de entrada (minutos). Hasta aquí NO es tarde</div><input type=\"number\" min=\"1\" max=\"600\" id=\"asisC_asisTolEntrada\">"
      + "<div class=\"asis-lbl\">Hora del corte (solo informativa)</div><input type=\"time\" id=\"asisC_asisHoraCorte\">"
      + "<div class=\"asis-lbl\">Hora oficial de salida</div><input type=\"time\" id=\"asisC_asisHoraSalida\">"
      + "<div class=\"asis-lbl\">La hora extra empieza a contar desde (hora de salida real)</div><input type=\"time\" id=\"asisC_asisExtraDesde\">"
      + "<div class=\"asis-lbl\">Bloque de hora extra (minutos)</div><input type=\"number\" min=\"1\" max=\"600\" id=\"asisC_asisExtraBloque\">"
      + "<div class=\"asis-lbl\">Salida anticipada: antes de</div><input type=\"time\" id=\"asisC_asisSalidaAnticipada\">"
      + "<div class=\"asis-sub\" style=\"margin-bottom:8px\">Tarde: llegada posterior a la hora de entrada + tolerancia (los minutos se cuentan desde la hora oficial). Extra: solo si la salida llega a la hora indicada; se cuenta desde la hora oficial de salida en bloques completos y vale para pago cuando el Admin la autoriza.</div>"
      + "<button class=\"btn b-ok\" id=\"asisBtnCfg\" onclick=\"asisGuardarCfg()\">💾 Guardar parámetros</button></div></div>" : "")

    + "<div id=\"asisModal\"><div class=\"asis-caja\" id=\"asisModalCaja\"></div></div>";
  var div = document.createElement("div");
  div.id = "asistenciaScreen"; div.style.cssText = "display:none;padding:10px"; div.innerHTML = html;
  asisEl("appContent").appendChild(div);
  ASIS.construido = true; ASIS.construidoPara = quien;
}

function asisGoTab(n) {
  if (n === 2 && !asisEsGestion()) n = 0; if (n === 3 && !asisEsGestion()) n = 0; if (n === 4 && !asisEsAdmin()) n = 0;
  ASIS.tab = n;
  for (var i = 0; i <= 4; i++) {
    var p = asisEl("asisT" + i), b = asisEl("asisB" + i);
    if (p) p.style.display = (i === n) ? "block" : "none";
    if (b) b.className = "btn " + (i === n ? "b-ok" : "b-sec") + " b-sm";
  }
  if (n !== 0) asisDetenerCamara();
  if (n === 1) { asisRenderHoy(); if (ASIS.dia) asisCargarDia(ASIS.fecha); }   // se muestra lo que hay y se refresca con el servidor
  if (n === 2) { asisPermPrepararForm(); asisRenderPermisos(); }
  if (n === 3) asisRepPrepararFechas();
  if (n === 4) asisLlenarCfg();
}

// ── carga del día ──
function asisCargarDia(fecha) {
  var payload = {}; if (fecha) payload.fecha = fecha;
  return gasPost("asistenciaDia", payload).then(function (r) {
    ASIS.dia = r; ASIS.fecha = r.fecha;
    var f = asisEl("asisFecha"); if (f) f.value = r.fecha;
    asisRenderMini(); asisRenderHoy(); asisRenderPermisos(); asisLlenarCfg();
    return r;
  }).catch(function (e) { asisToast(e.message, "err"); });
}
function asisChips(c, esperados) {
  return "<span class=\"asis-chip\">Esperados " + esperados + "</span><span class=\"asis-chip\" style=\"background:#E2F0D9\">Presentes " + c.presente + "</span>"
    + "<span class=\"asis-chip\" style=\"background:#FFF2CC\">Tarde " + c.tarde + "</span><span class=\"asis-chip\" style=\"background:#F8CBAD\">Faltas " + c.falta + "</span>"
    + "<span class=\"asis-chip\" style=\"background:#DDEBF7\">Permisos " + c.permiso + "</span><span class=\"asis-chip\" style=\"background:#EEE\">Sin registro " + c.sinRegistro + "</span>"
    + (c.sinSalida ? "<span class=\"asis-chip\" style=\"background:#EEE\">Sin salida " + c.sinSalida + "</span>" : "");
}
function asisRenderMini() {
  var d = ASIS.dia, e = asisEl("asisMini"); if (!e || !d) return;
  e.innerHTML = asisChips(d.cuenta, d.esperados) + "<div class=\"asis-sub\">" + asisFechaLeg(d.fecha) + (d.corte ? " · corte hecho a las " + asisH(d.corte.hora) : " · sin corte todavía") + "</div>";
}

// ── marcar ──
function asisSetModo(m) {
  ASIS.modo = m;
  ["auto", "entrada", "salida"].forEach(function (k) { var b = asisEl("asisM_" + k); if (b) b.className = "btn " + (k === m ? "b-ok" : "b-sec") + " b-sm"; });
}
function asisMarcarManual() {
  var inp = asisEl("asisCodigo"); var v = asisTxt(inp.value);
  if (!v) { asisToast("Escribe un código, DUI/DPI o número.", "warn"); return; }
  inp.value = ""; asisEncolar(v, "manual"); inp.focus();
}
function asisEncolar(codigo, origen) { ASIS.cola.push({ codigo: codigo, origen: origen }); asisProcesarCola(); }
function asisProcesarCola() {
  if (ASIS.procesando || !ASIS.cola.length) return;
  ASIS.procesando = true;
  var it = ASIS.cola.shift();
  var payload = { codigo: asisTxt(it.codigo).slice(0, 60), tipo: ASIS.modo };
  if (asisEsAdmin() && ASIS.modo !== "salida") {
    var h = asisEl("asisHoraManual"), m = asisEl("asisMotivoManual");
    if (h && h.value) { payload.horaInicio = h.value; payload.motivo = asisTxt(m ? m.value : ""); h.value = ""; if (m) m.value = ""; }
  }
  gasPost("asistenciaMarcar", payload).then(function (r) { asisFeed(r, it); })
    .catch(function (e) { asisFeed({ ok: false, error: e.message }, it); })
    .then(function () { ASIS.procesando = false; asisProcesarCola(); asisRefrescoDiferido(); });
}
function asisFeed(r, it) {
  var cls = "", txt = "", hora = new Date().toTimeString().slice(0, 5);
  if (!r.ok) { cls = "err"; txt = "❌ <b>" + asisH(r.error || "Error") + "</b>"; }
  else if (r.duplicado) { cls = "info"; txt = "ℹ️ <b>" + asisH(r.nombre) + "</b><br>" + asisH(r.aviso); }
  else if (r.accion === "entrada") {
    cls = (r.estado === "Tarde" || (r.alertas && r.alertas.length)) ? "warn" : "";
    txt = "🟢 <b>" + asisH(r.nombre) + "</b> · Entrada " + asisH(r.horaCaptura) + (r.horaInicio !== r.horaCaptura ? " (inicio " + asisH(r.horaInicio) + ")" : "")
      + "<br>" + asisH(r.estado) + (r.minutosTarde ? " · " + r.minutosTarde + " min tarde" : "");
  } else {
    cls = (r.alertas && r.alertas.length) ? "warn" : "";
    txt = "🔴 <b>" + asisH(r.nombre) + "</b> · Salida " + asisH(r.horaFin) + (r.minutosExtra ? "<br>Extra calculado: " + r.minutosExtra + " min" : "");
  }
  if (r.alertas && r.alertas.length) txt += "<br><span style=\"color:#9C5700\">⚠ " + r.alertas.map(asisH).join(" · ") + "</span>";
  if (r.aviso && !r.duplicado) txt += "<br><span style=\"color:#9C5700\">⚠ " + asisH(r.aviso) + "</span>";
  ASIS.feed.unshift({ cls: cls, html: txt, hora: hora });
  if (ASIS.feed.length > 12) ASIS.feed.pop();
  var e = asisEl("asisFeed"); if (!e) return;
  e.innerHTML = ASIS.feed.map(function (f) { return "<div class=\"asis-feed " + f.cls + "\"><span style=\"float:right;color:#888\">" + f.hora + "</span>" + f.html + "</div>"; }).join("");
  if (r.ok && !r.duplicado) { try { beep(); } catch (x) {} } else if (!r.ok) { asisToast(r.error || "Error", "err"); }
}
function asisRefrescoDiferido() {
  clearTimeout(ASIS.timerRefresco);
  ASIS.timerRefresco = setTimeout(function () { if (!ASIS.cola.length && !ASIS.procesando) asisCargarDia(ASIS.dia && ASIS.dia.hoy === ASIS.fecha ? null : ASIS.fecha); }, 1500);
}

// ── cámara continua ──
function asisToggleCamara() {
  if (ASIS.lector) { asisDetenerCamara(); return; }
  if (typeof ZXing === "undefined") { asisToast("La cámara no está disponible (falta cargar la librería de QR).", "err"); return; }
  var wrap = asisEl("asisQW"), vid = asisEl("asisQV"), btn = asisEl("asisBtnCam");
  wrap.style.display = "block"; btn.textContent = "⏹ Cerrar cámara";
  var hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  ASIS.lector = new ZXing.BrowserQRCodeReader(hints);
  ASIS.lector.decodeFromVideoDevice(undefined, vid, function (result) {
    if (!result) return;
    var val = (result.getText() || "").trim(); if (!val) return;
    var ahora = Date.now();
    if (val === ASIS.ultimo.codigo && ahora - ASIS.ultimo.ts < 4000) return; // la misma lectura repetida
    ASIS.ultimo = { codigo: val, ts: ahora };
    var fl = asisEl("asisQF"); if (fl) { fl.classList.add("show"); setTimeout(function () { fl.classList.remove("show"); }, 250); }
    asisEncolar(val, "qr");
  });
}
function asisDetenerCamara() {
  if (ASIS.lector) { try { ASIS.lector.reset(); } catch (e) {} ASIS.lector = null; }
  var w = asisEl("asisQW"), v = asisEl("asisQV"), b = asisEl("asisBtnCam");
  if (w) w.style.display = "none"; if (v) { try { v.srcObject = null; } catch (e) {} } if (b) b.textContent = "📷 Abrir cámara";
}

// ── vista del día ──
function asisBadge(est) {
  var col = { Presente: "#375623", Tarde: "#B26A00", Falta: "#C00000", Permiso: "#2F75B5", "Sin registro": "#777" }[est] || "#777";
  return "<span class=\"badge\" style=\"background:" + col + ";color:#fff\">" + asisH(est) + "</span>";
}
function asisRenderHoy() {
  var d = ASIS.dia, cont = asisEl("asisLista"), res = asisEl("asisResumen"); if (!cont || !d) return;
  res.innerHTML = asisChips(d.cuenta, d.esperados) + "<div class=\"asis-sub\" style=\"margin-bottom:6px\">" + asisFechaLeg(d.fecha) + (d.corte ? " · corte a las " + asisH(d.corte.hora) + " (" + asisH(d.corte.por) + ")" : " · sin corte todavía") + "</div>";
  var lista = d.trabajadores.filter(function (t) {
    if (!ASIS.filtro) return true;
    if (ASIS.filtro === "__sinsalida") return t.sinSalida;
    return t.estado === ASIS.filtro;
  });
  if (!lista.length) { cont.innerHTML = "<div class=\"empty\"><div class=\"ei\">📋</div><p>No hay registros con ese filtro</p></div>"; return; }
  cont.innerHTML = lista.map(function (t, i) {
    var clase = "asis-" + t.estado.replace(" ", "");
    var horas = t.horaInicio ? ("Entrada: captura " + asisH((t.capEntrada || "").slice(0, 5)) + (t.horaInicio !== (t.capEntrada || "").slice(0, 5) ? " · <b>inicio " + asisH(t.horaInicio) + "</b>" : "")) : "";
    if (t.horaFin) horas += " &nbsp;|&nbsp; Salida: " + asisH(t.horaFin);
    var extras = [];
    if (t.minTarde) extras.push(t.minTarde + " min tarde");
    if (t.minExtra) extras.push("extra " + t.minExtra + " min" + (t.extraAut === "Sí" ? " ✔ autorizada (" + t.horasExtraRec + " h)" : " (sin autorizar)"));
    var al = t.alertas.slice(); if (t.sinSalida && d.fecha < d.hoy) al.push("Sin hora de salida");
    var permiso = t.permiso ? "<div class=\"asis-sub\">📝 " + asisH(t.permiso.tipo) + ": " + asisH(t.permiso.motivo) + " (" + asisH(t.permiso.goce) + ")</div>" : "";
    var btns = "";
    if (asisEsGestion() && (t.estado === "Falta" || t.estado === "Sin registro")) btns += "<button class=\"btn b-warn b-sm\" onclick=\"asisPermisoPara('" + asisH(esc(t.codigo)) + "')\">📝 Justificar con permiso</button>";
    if (asisEsAdmin() && t.tieneFila) btns += "<button class=\"btn b-sec b-sm\" onclick=\"asisEditar(" + i + ")\">✏️ Editar horas</button>";
    ASIS._lista = lista;
    return "<div class=\"asis-fila " + clase + "\"><div style=\"display:flex;justify-content:space-between;gap:6px\"><div><b>" + asisH(t.nombre) + "</b><div class=\"asis-sub\">" + asisH(t.codigo) + "</div></div><div>" + asisBadge(t.estado) + "</div></div>"
      + (horas ? "<div class=\"asis-sub\">" + horas + "</div>" : "") + (extras.length ? "<div class=\"asis-sub\">" + extras.join(" · ") + "</div>" : "")
      + (al.length ? "<div class=\"asis-al\">⚠ " + al.map(asisH).join(" · ") + "</div>" : "") + permiso + (t.obs ? "<div class=\"asis-sub\">" + asisH(t.obs) + "</div>" : "")
      + (btns ? "<div style=\"margin-top:5px\">" + btns + "</div>" : "") + "</div>";
  }).join("");
}

// ── corte ──
function asisCorte() {
  var d = ASIS.dia; if (!d) return;
  if (!confirm("¿Cerrar la asistencia del " + asisFechaLeg(d.fecha) + "?\n\nQuienes no hayan marcado quedarán como FALTA (después puedes justificarlas con un permiso).")) return;
  var o = asisBloq("asisBtnCorte", "⏳ Cerrando…"); if (!o.ok) return;
  gasPost("asistenciaCorte", { fecha: d.fecha }).then(function (r) {
    var msg = "Corte hecho (" + r.horaCorte + "): " + r.presentes + " presentes, " + r.tarde + " tarde, " + r.faltas + " faltas, " + r.permisos + " con permiso.";
    if (r.nuevasFaltas && r.nuevasFaltas.length) msg += "\nFaltas: " + r.nuevasFaltas.join(", ");
    asisToast("Corte hecho: " + r.faltas + " falta(s)", "ok"); alert(msg);
    return asisCargarDia(d.fecha);
  }).catch(function (e) { asisToast(e.message, "err"); }).then(function () { asisLibera(o, "asisBtnCorte"); });
}

// ── editar (Admin) ──
function asisEditar(i) {
  var t = (ASIS._lista || [])[i]; if (!t) return;
  var cap = asisEl("asisModalCaja");
  cap.innerHTML = "<div class=\"ctit\">✏️ Editar: " + asisH(t.nombre) + " · " + asisFechaLeg(ASIS.fecha) + "</div>"
    + "<div class=\"asis-sub\">La hora de captura (" + asisH((t.capEntrada || "—").slice(0, 8)) + ") no se puede cambiar. Todo cambio queda en la bitácora.</div>"
    + "<div class=\"asis-lbl\">Hora de inicio</div><input type=\"time\" id=\"asisE_ini\" value=\"" + asisH(t.horaInicio) + "\">"
    + "<div class=\"asis-lbl\">Hora fin</div><input type=\"time\" id=\"asisE_fin\" value=\"" + asisH(t.horaFin) + "\">"
    + "<div class=\"asis-lbl\">Estado</div><select id=\"asisE_est\"><option value=\"\">(sin cambio: " + asisH(t.estado) + ")</option><option>Presente</option><option>Tarde</option><option>Falta</option></select>"
    + "<div class=\"asis-lbl\">Hora extra</div><select id=\"asisE_ext\"><option value=\"\">(sin cambio: " + (t.extraAut === "Sí" ? "autorizada" : "sin autorizar") + ")</option><option value=\"Sí\">Autorizar</option><option value=\"No\">No autorizar</option></select>"
    + "<div class=\"asis-lbl\">Observaciones (opcional)</div><input type=\"text\" id=\"asisE_obs\" maxlength=\"300\" value=\"" + asisH(t.obs) + "\">"
    + "<div class=\"asis-lbl\">Motivo del cambio (obligatorio)</div><input type=\"text\" id=\"asisE_mot\" maxlength=\"200\" placeholder=\"Ej: Esperó la charla de seguridad\">"
    + "<button class=\"btn b-ok\" id=\"asisBtnEd\" onclick=\"asisGuardarEdicion(" + i + ")\">💾 Guardar</button>"
    + "<button class=\"btn b-sec\" onclick=\"asisCerrarModal()\">Cancelar</button>";
  asisEl("asisModal").style.display = "flex";
}
function asisCerrarModal() { var m = asisEl("asisModal"); if (m) m.style.display = "none"; }
function asisGuardarEdicion(i) {
  var t = (ASIS._lista || [])[i]; if (!t) return;
  var mot = asisTxt(asisEl("asisE_mot").value);
  if (mot.length < 3) { asisToast("Escribe el motivo del cambio.", "warn"); return; }
  var p = { fecha: ASIS.fecha, codigo: t.codigo, motivo: mot };
  var ini = asisEl("asisE_ini").value, fin = asisEl("asisE_fin").value;
  if (ini && ini !== t.horaInicio) p.horaInicio = ini;
  if (fin && fin !== t.horaFin) p.horaFin = fin;
  if (asisEl("asisE_est").value) p.estado = asisEl("asisE_est").value;
  if (asisEl("asisE_ext").value) p.extraAutorizada = asisEl("asisE_ext").value;
  var obs = asisTxt(asisEl("asisE_obs").value); if (obs !== (t.obs || "")) p.observaciones = obs;
  var o = asisBloq("asisBtnEd", "⏳ Guardando…"); if (!o.ok) return;
  gasPost("asistenciaEditar", p).then(function (r) {
    asisToast("Guardado: " + r.nombre + " → " + r.estado + (r.minutosTarde ? " (" + r.minutosTarde + " min tarde)" : ""), "ok");
    asisCerrarModal(); return asisCargarDia(ASIS.fecha);
  }).catch(function (e) { asisToast(e.message, "err"); }).then(function () { asisLibera(o, "asisBtnEd"); });
}

// ── permisos ──
function asisPermPrepararForm() {
  var d = ASIS.dia; if (!d) return;
  var llenar = function (id, arr) { var s = asisEl(id); if (s && !s.options.length) s.innerHTML = arr.map(function (x) { return "<option>" + asisH(x) + "</option>"; }).join(""); };
  llenar("asisPermTipo", d.catalogos.tiposPermiso); llenar("asisPermComo", d.catalogos.formasAviso); llenar("asisPermGoce", d.catalogos.goce);
  if (!asisEl("asisPermDesde").value) asisEl("asisPermDesde").value = d.fecha;
  if (!asisEl("asisPermHora").value) asisEl("asisPermHora").value = d.horaServidor;
  if (!asisEl("asisPermAut").value) asisEl("asisPermAut").value = (SESION && SESION.nombre) || "";
}
function asisPermBuscar() {
  var q = asisTxt(asisEl("asisPermBuscar").value).toLowerCase(), box = asisEl("asisPermSug"), d = ASIS.dia;
  if (!q || !d) { box.style.display = "none"; return; }
  var r = d.trabajadores.filter(function (t) { return t.nombre.toLowerCase().indexOf(q) >= 0 || t.codigo.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
  box.innerHTML = r.map(function (t) { return "<div style=\"padding:8px;border-bottom:1px solid #eee;cursor:pointer\" onclick=\"asisPermElegir('" + asisH(esc(t.codigo)) + "')\"><b>" + asisH(t.nombre) + "</b> <span class=\"asis-sub\">" + asisH(t.codigo) + " · " + asisH(t.estado) + "</span></div>"; }).join("") || "<div class=\"asis-sub\" style=\"padding:8px\">Sin resultados</div>";
  box.style.display = "block";
}
function asisPermElegir(codigo) {
  var d = ASIS.dia, t = d && d.trabajadores.filter(function (x) { return x.codigo === codigo; })[0];
  ASIS.permCodigo = codigo;
  asisEl("asisPermSel").innerHTML = t ? "✔ Seleccionado: <b>" + asisH(t.nombre) + "</b> (" + asisH(t.codigo) + ") · hoy: " + asisH(t.estado) : "";
  asisEl("asisPermSug").style.display = "none"; asisEl("asisPermBuscar").value = "";
}
function asisPermisoPara(codigo) { asisGoTab(2); asisPermElegir(codigo); window.scrollTo(0, 0); }
function asisRegistrarPermiso() {
  if (!ASIS.permCodigo) { asisToast("Elige primero al trabajador.", "warn"); return; }
  var p = { codigo: ASIS.permCodigo, fecha: asisEl("asisPermDesde").value, tipo: asisEl("asisPermTipo").value, motivo: asisTxt(asisEl("asisPermMotivo").value),
    comoAviso: asisEl("asisPermComo").value, horaAviso: asisEl("asisPermHora").value, goce: asisEl("asisPermGoce").value, autorizadoPor: asisTxt(asisEl("asisPermAut").value) };
  var h = asisEl("asisPermHasta").value; if (h) p.fechaHasta = h;
  if (p.motivo.length < 3) { asisToast("Escribe el motivo del permiso.", "warn"); return; }
  var o = asisBloq("asisBtnPerm", "⏳ Guardando…"); if (!o.ok) return;
  gasPost("permisoRegistrar", p).then(function (r) {
    asisToast("Permiso registrado: " + r.nombre + (r.actualizados.length ? " · " + r.actualizados.length + " falta(s) pasaron a Permiso" : ""), "ok");
    if (r.aviso) alert(r.aviso);
    ASIS.permCodigo = ""; asisEl("asisPermSel").innerHTML = ""; asisEl("asisPermMotivo").value = ""; asisEl("asisPermHasta").value = "";
    return asisCargarDia(ASIS.fecha);
  }).catch(function (e) { asisToast(e.message, "err"); }).then(function () { asisLibera(o, "asisBtnPerm"); });
}
function asisRenderPermisos() {
  var d = ASIS.dia, e = asisEl("asisPermLista"); if (!e || !d) return;
  if (!d.permisos.length) { e.innerHTML = "<div class=\"empty\"><p>No hay permisos vigentes para " + asisFechaLeg(d.fecha) + "</p></div>"; return; }
  e.innerHTML = d.permisos.map(function (p) {
    return "<div class=\"asis-fila asis-Permiso\"><b>" + asisH(p.nombre) + "</b> <span class=\"asis-sub\">" + asisH(p.codigo) + "</span><div class=\"asis-sub\">" + asisH(p.tipo) + " · " + asisH(p.goce) + " · " + asisFechaLeg(p.desde) + (p.hasta !== p.desde ? " al " + asisFechaLeg(p.hasta) : "") + "</div><div class=\"asis-sub\">" + asisH(p.motivo) + " · avisó por " + asisH(p.como) + " · autorizó " + asisH(p.autorizadoPor) + "</div>"
      + "<button class=\"btn b-danger b-sm\" onclick=\"asisAnularPermiso('" + asisH(esc(p.id)) + "')\">Anular</button></div>";
  }).join("");
}
function asisAnularPermiso(id) {
  var mot = prompt("Motivo de la anulación del permiso " + id + ":"); if (mot === null) return;
  mot = asisTxt(mot); if (mot.length < 3) { asisToast("Escribe el motivo de la anulación.", "warn"); return; }
  gasPost("permisoAnular", { idPermiso: id, motivo: mot }).then(function (r) {
    asisToast("Permiso anulado" + (r.revertidos.length ? " · " + r.revertidos.length + " día(s) vuelven a Falta" : ""), "ok"); return asisCargarDia(ASIS.fecha);
  }).catch(function (e) { asisToast(e.message, "err"); });
}

// ── reporte ──
function asisRepPrepararFechas() {
  var d = ASIS.dia; if (!d) return;
  if (!asisEl("asisRepHasta").value) asisEl("asisRepHasta").value = d.hoy;
  if (!asisEl("asisRepDesde").value) asisEl("asisRepDesde").value = d.hoy.slice(0, 8) + "01";
}
function asisGenerarReporte() {
  var o = asisBloq("asisBtnRep", "⏳ Generando…"); if (!o.ok) return;
  gasPost("asistenciaReporte", { desde: asisEl("asisRepDesde").value, hasta: asisEl("asisRepHasta").value }).then(function (r) {
    ASIS.rep = r;
    var th = "<tr><th>Trabajador</th><th>P</th><th>T</th><th>F</th><th>Perm</th><th>Min tarde</th><th>Extra h</th></tr>";
    var filas = r.trabajadores.map(function (t) { return "<tr><td>" + asisH(t.nombre) + "</td><td>" + t.presente + "</td><td>" + t.tarde + "</td><td>" + t.falta + "</td><td>" + t.permiso + "</td><td>" + t.minTarde + "</td><td>" + t.horasExtraRec + "</td></tr>"; }).join("");
    asisEl("asisRepOut").innerHTML = "<div class=\"asis-sub\" style=\"margin:6px 0\">" + asisFechaLeg(r.desde) + " al " + asisFechaLeg(r.hasta) + " · P=presente, T=tarde, F=falta. Extra h = horas extra autorizadas.</div><div style=\"overflow-x:auto\"><table>" + th + filas + "</table></div>"
      + "<div class=\"asis-sub\" style=\"margin-top:6px\"><b>Totales:</b> presentes " + r.total.presente + " · tarde " + r.total.tarde + " · faltas " + r.total.falta + " · permisos " + r.total.permiso + "</div>";
  }).catch(function (e) { asisToast(e.message, "err"); }).then(function () { asisLibera(o, "asisBtnRep"); });
}

// ── parámetros ──
var ASIS_CFG_CLAVES = ["asisHoraEntrada", "asisTolEntrada", "asisHoraCorte", "asisHoraSalida", "asisExtraDesde", "asisExtraBloque", "asisSalidaAnticipada"];
function asisLlenarCfg() {
  var d = ASIS.dia; if (!d || !asisEsAdmin()) return;
  ASIS_CFG_CLAVES.forEach(function (k) { var e = asisEl("asisC_" + k); if (e && document.activeElement !== e) e.value = d.cfg[k]; });
}
function asisGuardarCfg() {
  var p = {}; ASIS_CFG_CLAVES.forEach(function (k) { var e = asisEl("asisC_" + k); if (e && e.value !== "") p[k] = e.value; });
  var o = asisBloq("asisBtnCfg", "⏳ Guardando…"); if (!o.ok) return;
  gasPost("asistenciaGuardarConfig", p).then(function () { asisToast("Parámetros guardados", "ok"); return asisCargarDia(ASIS.fecha); })
    .catch(function (e) { asisToast(e.message, "err"); }).then(function () { asisLibera(o, "asisBtnCfg"); });
}

// ── salidas de texto: copiar y PDF ──
function asisCopiar(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto).then(function () { asisToast("Copiado. Pégalo en WhatsApp.", "ok"); }).catch(function () { asisCopiarViejo(texto); }); }
  else asisCopiarViejo(texto);
}
function asisCopiarViejo(texto) {
  var ta = document.createElement("textarea"); ta.value = texto; ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); asisToast("Copiado. Pégalo en WhatsApp.", "ok"); } catch (e) { asisToast("No se pudo copiar.", "err"); }
  document.body.removeChild(ta);
}
function asisTextoDia() {
  var d = ASIS.dia; if (!d) return "";
  var nombres = function (f) { return d.trabajadores.filter(f); };
  var l = [];
  l.push("ASISTENCIA " + asisFechaLeg(d.fecha) + (typeof CONFIG !== "undefined" && CONFIG.nombreProyecto ? " — " + CONFIG.nombreProyecto : ""));
  l.push(d.corte ? "Corte: " + d.corte.hora : "(sin corte todavía)");
  l.push("Esperados " + d.esperados + " · Presentes " + d.cuenta.presente + " · Tarde " + d.cuenta.tarde + " · Faltas " + d.cuenta.falta + " · Permisos " + d.cuenta.permiso + " · Sin registro " + d.cuenta.sinRegistro);
  var t = nombres(function (x) { return x.estado === "Tarde"; }); if (t.length) l.push("", "TARDE: " + t.map(function (x) { return x.nombre + " (" + x.minTarde + " min)"; }).join(", "));
  var f = nombres(function (x) { return x.estado === "Falta"; }); if (f.length) l.push("", "FALTAS: " + f.map(function (x) { return x.nombre; }).join(", "));
  var p = nombres(function (x) { return x.estado === "Permiso"; }); if (p.length) l.push("", "PERMISOS: " + p.map(function (x) { return x.nombre + (x.permiso ? " (" + x.permiso.tipo + ")" : ""); }).join(", "));
  var s = nombres(function (x) { return x.estado === "Sin registro"; }); if (s.length) l.push("", "SIN REGISTRO: " + s.map(function (x) { return x.nombre; }).join(", "));
  var ss = nombres(function (x) { return x.sinSalida; }); if (ss.length && d.fecha < d.hoy) l.push("", "SIN HORA DE SALIDA: " + ss.map(function (x) { return x.nombre; }).join(", "));
  return l.join("\n");
}
function asisCopiarDia() { asisCopiar(asisTextoDia()); }
function asisCopiarReporte() {
  var r = ASIS.rep; if (!r) { asisToast("Primero genera el reporte.", "warn"); return; }
  var l = ["REPORTE DE ASISTENCIA " + asisFechaLeg(r.desde) + " al " + asisFechaLeg(r.hasta), ""];
  r.trabajadores.forEach(function (t) { l.push(t.nombre + ": P " + t.presente + " · T " + t.tarde + " (" + t.minTarde + " min) · F " + t.falta + " · Perm " + t.permiso + " · Extra " + t.horasExtraRec + " h"); });
  l.push("", "Totales: presentes " + r.total.presente + " · tarde " + r.total.tarde + " · faltas " + r.total.falta + " · permisos " + r.total.permiso);
  asisCopiar(l.join("\n"));
}
function asisPDF(titulo, cabeza, cuerpo, nombreArchivo) {
  try {
    var J = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF; var doc = new J({ orientation: "landscape" });
    doc.setFontSize(14); doc.text(titulo, 14, 14);
    doc.setFontSize(9); doc.text((typeof CONFIG !== "undefined" ? (CONFIG.nombreProyecto || "") : "") + " · generado " + new Date().toLocaleString(), 14, 20);
    doc.autoTable({ head: [cabeza], body: cuerpo, startY: 25, styles: { fontSize: 8 }, headStyles: { fillColor: [27, 67, 50] } });
    doc.save(nombreArchivo);
  } catch (e) { asisToast("No se pudo crear el PDF: " + e.message, "err"); }
}
function asisPDFDia() {
  var d = ASIS.dia; if (!d) return;
  asisPDF("Asistencia " + asisFechaLeg(d.fecha) + (d.corte ? " (corte " + d.corte.hora + ")" : ""),
    ["Trabajador", "Código", "Estado", "Captura", "Inicio", "Salida", "Min tarde", "Extra min", "Extra aut.", "Alertas / permiso"],
    d.trabajadores.map(function (t) { return [t.nombre, t.codigo, t.estado, (t.capEntrada || "").slice(0, 5), t.horaInicio, t.horaFin, t.minTarde || "", t.minExtra || "", t.minExtra ? t.extraAut : "", t.alertas.join(" | ") + (t.permiso ? " " + t.permiso.tipo : "")]; }),
    "Asistencia_" + d.fecha + ".pdf");
}
function asisPDFReporte() {
  var r = ASIS.rep; if (!r) { asisToast("Primero genera el reporte.", "warn"); return; }
  asisPDF("Reporte de asistencia " + asisFechaLeg(r.desde) + " al " + asisFechaLeg(r.hasta), ["Trabajador", "Presente", "Tarde", "Falta", "Permiso", "Min tarde", "Extra aut. (h)", "Sin salida"],
    r.trabajadores.map(function (t) { return [t.nombre, t.presente, t.tarde, t.falta, t.permiso, t.minTarde, t.horasExtraRec, t.sinSalida]; }), "Reporte_asistencia_" + r.desde + "_" + r.hasta + ".pdf");
}

// Relevo de Patio — backend en Google Sheets.
// Pegar en la planilla: Extensiones > Apps Script. Ver LEEME.md para publicarlo.
// Cambiá esta clave y pasásela a tus compañeros: la página la pide la primera vez.
const CLAVE_EQUIPO = "cambiar-esta-clave";

const HOJA_AUTOS = "Relevamiento";
const COLS_AUTOS = ["Mes", "Clave (7)", "Chasis", "Sector", "Cómo se cargó", "Leído por el celular", "Corregido", "Fecha y hora", "Quién"];
const HOJA_STOCK = "Stock sistema";
const COLS_STOCK = ["Mes", "Chasis"];

// Creates the sheet with its header and text formats. Only called while holding the lock,
// so two requests can never create it at the same time.
function hoja_(nombre, cols) {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
    h.setFrozenRows(1);
    formatos_(h, nombre);
  }
  return h;
}
// texto plano: que Sheets no convierta "2026-10" en fecha ni "0607117" en número
function formatos_(h, nombre) {
  if (nombre === HOJA_AUTOS) {
    h.getRange("A:G").setNumberFormat("@");
    h.getRange("H:H").setNumberFormat("dd/mm/yyyy hh:mm");
    h.getRange("I:I").setNumberFormat("@");
  } else {
    h.getRange("A:B").setNumberFormat("@");
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// "2026-10" whatever Sheets did to it (text, a Date, or the date's serial number)
function mesTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "UTC", "yyyy-MM");
  if (typeof v === "number" && v > 30000 && v < 80000) return Utilities.formatDate(new Date(Math.round((v - 25569) * 86400000)), "UTC", "yyyy-MM");
  return String(v).trim();
}
// the 7-character key; restores leading zeros Sheets may have dropped
function claveTexto_(clave, chasis) {
  const ch = String(chasis || "").trim().toUpperCase();
  if (ch.length >= 7) return ch.slice(-7);
  const k = String(clave || "").trim().toUpperCase();
  return /^\d+$/.test(k) ? ("0000000" + k).slice(-7) : k;
}
function esEncabezado_(fila) { return String(fila[0]).trim() === COLS_AUTOS[0]; }

// GET ?clave=...&mes=2026-10  -> { ok, autos: [...], teorico: [...] }
function doGet(e) {
  const p = e.parameter || {};
  if (p.clave !== CLAVE_EQUIPO) return json_({ ok: false, error: "clave" });
  const mes = String(p.mes || "");
  const ss = SpreadsheetApp.getActive();
  const autos = [], teorico = [];
  const h = ss.getSheetByName(HOJA_AUTOS);
  if (h && h.getLastRow() > 0) {
    const vals = h.getRange(1, 1, h.getLastRow(), COLS_AUTOS.length).getValues();
    const vistos = new Map();
    for (const r of vals) {
      if (esEncabezado_(r) || mesTexto_(r[0]) !== mes) continue;
      const a = {
        clave: claveTexto_(r[1], r[2]), chasis: String(r[2]), sector: String(r[3]), fuente: String(r[4]),
        leido: String(r[5]), corregido: String(r[6]) === "si",
        at: r[7] instanceof Date ? r[7].getTime() : Date.parse(r[7]) || 0, quien: String(r[8]),
      };
      const prev = vistos.get(a.clave);
      if (!prev || a.at >= prev.at) vistos.set(a.clave, a);  // one per car even if the sheet has repeats
    }
    autos.push(...vistos.values());
  }
  const hs = ss.getSheetByName(HOJA_STOCK);
  if (hs && hs.getLastRow() > 1) {
    for (const r of hs.getRange(2, 1, hs.getLastRow() - 1, 2).getValues()) if (mesTexto_(r[0]) === mes) teorico.push(String(r[1]));
  }
  return json_({ ok: true, autos, teorico });
}

// POST (texto JSON) { clave, ops: [ {accion:"guardar", mes, auto}, {accion:"borrar", mes, clave7}, {accion:"stock", mes, lista} ] }
// Safe to receive the same ops twice (a phone resends when the camera cut the first try): a car is
// updated in place, never added again.
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "formato" }); }
  if (body.clave !== CLAVE_EQUIPO) return json_({ ok: false, error: "clave" });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: "ocupado" });
  try {
    const h = hoja_(HOJA_AUTOS, COLS_AUTOS);
    // read the sheet once: "mes|clave" -> row number
    const last = h.getLastRow();
    const filaDe = new Map();
    if (last > 0) {
      h.getRange(1, 1, last, 3).getValues().forEach((r, i) => {
        if (!esEncabezado_(r)) filaDe.set(mesTexto_(r[0]) + "|" + claveTexto_(r[1], r[2]), i + 1);
      });
    }
    const nuevas = [], nuevasPos = new Map(), borrar = [];
    for (const op of body.ops || []) {
      const mes = String(op.mes || "");
      if (op.accion === "guardar") {
        const a = op.auto || {};
        const clave = claveTexto_(a.clave, a.chasis);
        const fila = [mes, clave, String(a.chasis), String(a.sector || ""), String(a.fuente || ""), String(a.leido || ""), a.corregido ? "si" : "no", new Date(a.at || Date.now()), String(a.quien || "")];
        const k = mes + "|" + clave;
        if (filaDe.has(k)) h.getRange(filaDe.get(k), 1, 1, fila.length).setValues([fila]);
        else if (nuevasPos.has(k)) nuevas[nuevasPos.get(k)] = fila;
        else { nuevasPos.set(k, nuevas.length); nuevas.push(fila); }
      } else if (op.accion === "borrar") {
        const k = mes + "|" + claveTexto_(op.clave7, "");
        if (filaDe.has(k)) { borrar.push(filaDe.get(k)); filaDe.delete(k); }
        if (nuevasPos.has(k)) { nuevas[nuevasPos.get(k)] = null; nuevasPos.delete(k); }
      } else if (op.accion === "stock") {
        const hs = hoja_(HOJA_STOCK, COLS_STOCK);
        const ult = hs.getLastRow();
        if (ult > 1) {
          const v = hs.getRange(2, 1, ult - 1, 1).getValues();
          for (let i = v.length - 1; i >= 0; i--) if (mesTexto_(v[i][0]) === mes) hs.deleteRow(i + 2);
        }
        const filas = (op.lista || []).map((c) => [mes, String(c)]);
        if (filas.length) {
          const r = hs.getRange(hs.getLastRow() + 1, 1, filas.length, 2);
          r.setNumberFormat("@");
          r.setValues(filas);
        }
      }
    }
    const agregar = nuevas.filter(Boolean);
    if (agregar.length) {
      const r = h.getRange(h.getLastRow() + 1, 1, agregar.length, COLS_AUTOS.length);
      r.offset(0, 0, agregar.length, 7).setNumberFormat("@");
      r.setValues(agregar);
    }
    borrar.sort((x, y) => y - x).forEach((n) => h.deleteRow(n));
    // write everything before letting the next request in, or it reads the sheet without these rows
    SpreadsheetApp.flush();
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA vez desde el editor (elegir "ordenarYLimpiar" arriba y tocar Ejecutar).
// Guarda una copia de la hoja actual, deja un solo renglón por auto (el más reciente),
// arregla los meses y claves que Sheets convirtió en números y pone el encabezado en la fila 1.
function ordenarYLimpiar() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const h = ss.getSheetByName(HOJA_AUTOS);
    if (!h) return;
    const copia = h.copyTo(ss).setName(HOJA_AUTOS + " (respaldo " + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "dd-MM HH.mm") + ")");
    const last = h.getLastRow();
    const vals = last ? h.getRange(1, 1, last, COLS_AUTOS.length).getValues() : [];
    const porAuto = new Map();
    for (const r of vals) {
      if (esEncabezado_(r) || !String(r[2]).trim()) continue;
      const mes = mesTexto_(r[0]), clave = claveTexto_(r[1], r[2]);
      const fecha = r[7] instanceof Date ? r[7] : new Date(Date.parse(r[7]) || 0);
      const fila = [mes, clave, String(r[2]), String(r[3]), String(r[4]), String(r[5]), String(r[6]), fecha, String(r[8])];
      const k = mes + "|" + clave, prev = porAuto.get(k);
      if (!prev || fecha.getTime() >= prev[7].getTime()) porAuto.set(k, fila);
    }
    const filas = [...porAuto.values()].sort((a, b) => a[7] - b[7]);
    h.clearContents();
    formatos_(h, HOJA_AUTOS);
    h.getRange(1, 1, 1, COLS_AUTOS.length).setValues([COLS_AUTOS]).setFontWeight("bold");
    h.setFrozenRows(1);
    if (filas.length) h.getRange(2, 1, filas.length, COLS_AUTOS.length).setValues(filas);
    SpreadsheetApp.flush();
    Logger.log("Listo: %s renglones antes, %s autos únicos ahora. Copia en la pestaña '%s'.", vals.length, filas.length, copia.getName());
  } finally {
    lock.releaseLock();
  }
}

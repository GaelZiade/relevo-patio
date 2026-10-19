// Relevo de Patio — backend en Google Sheets.
// Pegar en la planilla: Extensiones > Apps Script. Ver LEEME.md para publicarlo.
// Cambiá esta clave y pasásela a tus compañeros: la página la pide la primera vez.
const CLAVE_EQUIPO = "cambiar-esta-clave";

const HOJA_AUTOS = "Relevamiento";
const COLS_AUTOS = ["Mes", "Clave (7)", "Chasis", "Sector", "Cómo se cargó", "Leído por el celular", "Corregido", "Fecha y hora", "Quién"];
const HOJA_STOCK = "Stock sistema";
const COLS_STOCK = ["Mes", "Chasis"];

function hoja_(nombre, cols) {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    h.appendRow(cols);
    h.setFrozenRows(1);
    h.getRange(1, 1, 1, cols.length).setFontWeight("bold");
    // texto plano: que Sheets no convierta "2026-10" en fecha ni "9348540" en número
    h.getRange("A:G").setNumberFormat("@");
    if (nombre === HOJA_AUTOS) h.getRange("H:H").setNumberFormat("dd/mm/yyyy hh:mm");
  }
  return h;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function filas_(h) {
  const v = h.getDataRange().getValues();
  v.shift();
  return v;
}

// GET ?clave=...&mes=2026-10  -> { ok, autos: [...], teorico: [...] }
function doGet(e) {
  const p = e.parameter || {};
  if (p.clave !== CLAVE_EQUIPO) return json_({ ok: false, error: "clave" });
  const mes = String(p.mes || "");
  const autos = filas_(hoja_(HOJA_AUTOS, COLS_AUTOS))
    .filter((r) => String(r[0]) === mes)
    .map((r) => ({
      clave: String(r[1]), chasis: String(r[2]), sector: String(r[3]), fuente: String(r[4]),
      leido: String(r[5]), corregido: String(r[6]) === "si",
      at: r[7] instanceof Date ? r[7].getTime() : Date.parse(r[7]) || 0, quien: String(r[8]),
    }));
  const teorico = filas_(hoja_(HOJA_STOCK, COLS_STOCK))
    .filter((r) => String(r[0]) === mes)
    .map((r) => String(r[1]));
  return json_({ ok: true, autos, teorico });
}

// POST (texto JSON) { clave, ops: [ {accion:"guardar", mes, auto}, {accion:"borrar", mes, clave7}, {accion:"stock", mes, lista} ] }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "formato" }); }
  if (body.clave !== CLAVE_EQUIPO) return json_({ ok: false, error: "clave" });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const h = hoja_(HOJA_AUTOS, COLS_AUTOS);
    for (const op of body.ops || []) {
      const mes = String(op.mes || "");
      if (op.accion === "guardar") {
        const a = op.auto || {};
        const fila = [mes, String(a.clave), String(a.chasis), String(a.sector || ""), String(a.fuente || ""), String(a.leido || ""), a.corregido ? "si" : "no", new Date(a.at || Date.now()), String(a.quien || "")];
        const n = buscar_(h, mes, String(a.clave));
        if (n) h.getRange(n, 1, 1, fila.length).setValues([fila]);
        else h.appendRow(fila);
      } else if (op.accion === "borrar") {
        const n = buscar_(h, mes, String(op.clave7));
        if (n) h.deleteRow(n);
      } else if (op.accion === "stock") {
        const hs = hoja_(HOJA_STOCK, COLS_STOCK);
        const filas = filas_(hs);
        for (let i = filas.length - 1; i >= 0; i--) if (String(filas[i][0]) === mes) hs.deleteRow(i + 2);
        const nuevas = (op.lista || []).map((c) => [mes, String(c)]);
        if (nuevas.length) hs.getRange(hs.getLastRow() + 1, 1, nuevas.length, 2).setValues(nuevas);
      }
    }
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// número de fila (1-based) del auto de ese mes, o 0
function buscar_(h, mes, clave7) {
  const last = h.getLastRow();
  if (last < 2) return 0;
  const v = h.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === mes && String(v[i][1]) === clave7) return i + 2;
  return 0;
}

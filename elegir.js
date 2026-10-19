// Picks the chassis from what the phone read: OCR words (with text size) and barcode contents.
// No brand rules: a candidate is any 7-8 letter/digit group. Bigger printed text ranks higher,
// and a barcode that agrees with a printed candidate fixes its doubtful characters.
(function (root) {
  const LEN_MIN = 7, LEN_MAX = 8;

  // VINs never use I, O or Q, so those are always misreads of 1 and 0.
  function normalize(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/[OQ]/g, "0").replace(/I/g, "1");
  }
  const clave = (c) => c.slice(-7);

  // Shapes OCR confuses with each other; used only to match printed text against a barcode.
  const PARECIDO = { S: "5", "5": "S", B: "8", "8": "B", Z: "2", "2": "Z", G: "6", "6": "G", A: "4", "4": "A", T: "7", "7": "T", D: "0", "0": "D", L: "1", "1": "L" };
  function similar(a, b) {
    const x = clave(a), y = clave(b);
    if (x.length < 7 || y.length < 7) return 0;
    let s = 0;
    for (let i = 0; i < 7; i++) if (x[i] === y[i] || PARECIDO[x[i]] === y[i]) s++;
    return s;
  }

  // tokens: [{text, h, conf}] where h is the word's pixel height; barras: [string]
  function elegir(tokens, barras) {
    const maxH = Math.max(1, ...tokens.map((t) => t.h || 0));
    const byKey = new Map();
    const add = (c) => {
      const k = clave(c.chasis);
      const prev = byKey.get(k);
      if (!prev) { byKey.set(k, c); return; }
      prev.score = Math.max(prev.score, c.score) + 5;  // seen again in another pass
      if (c.fuente === "barras") { prev.chasis = c.chasis; prev.fuente = "barras"; }  // a VIN barcode is exact
      else if (prev.fuente !== "barras" && c.chasis.length > prev.chasis.length) prev.chasis = c.chasis;
    };

    for (const t of tokens) {
      let c = normalize(t.text);
      if (c.length === LEN_MAX + 1) c = c.slice(1);  // stray mark glued to the front
      if (c.length < LEN_MIN || c.length > LEN_MAX) continue;
      // words like ARGENTINA or colors are never a chassis; count digits as printed, before O->0 / I->1
      if ((String(t.text).match(/\d/g) || []).length < 3) continue;
      // pieces glued across a space are a fallback (etched glass spacing), a whole word is preferred
      add({ chasis: c, score: 100 * (t.h || 0) / maxH + (t.conf || 0) / 10 - (t.unido ? 15 : 0), fuente: "texto" });
    }

    // Barcodes: a full 17-char VIN is exact; a short code (model prefix + chassis) only counts
    // when it agrees with something printed.
    const cortos = [];
    for (const raw of barras) {
      const b = normalize(raw);
      const vin = b.match(/[A-HJ-NPR-Z0-9]{17}/);
      if (vin) { add({ chasis: vin[0].slice(-LEN_MAX), score: 200, fuente: "barras" }); continue; }
      if (b.length >= LEN_MIN && b.length <= 12) cortos.push(b.slice(-LEN_MIN));
    }
    for (const c of byKey.values()) {
      if (c.fuente === "barras") continue;
      const match = cortos.find((b) => similar(b, c.chasis) >= 5);
      if (match) {
        c.chasis = c.chasis.length === LEN_MAX ? c.chasis[0] + match : match;
        c.score += 60;
        c.fuente = "texto+barras";
      }
    }

    const out = [...byKey.values()];
    // merge entries that collapsed onto the same key after barcode correction
    const seen = new Map();
    for (const c of out) {
      const k = clave(c.chasis);
      if (!seen.has(k) || seen.get(k).score < c.score) seen.set(k, c);
    }
    const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
    // Offer look-alike spellings of the best guess (S/5, B/8, ...) as extra choices to tap.
    const top = ranked[0];
    if (top && top.fuente !== "barras") {
      const keys = new Set(ranked.map((c) => clave(c.chasis)));
      for (let i = 0; i < top.chasis.length; i++) {
        const alt = PARECIDO[top.chasis[i]];
        if (!alt || !/\d/.test(alt)) continue;  // only letter -> digit, the usual misread
        const v = top.chasis.slice(0, i) + alt + top.chasis.slice(i + 1);
        if (keys.has(clave(v))) continue;
        keys.add(clave(v));
        ranked.push({ chasis: v, score: 0, fuente: "parecido" });
      }
    }
    return ranked;
  }

  // OCR lines -> tokens: every word, plus 2-3 neighbouring words glued (etched glass often reads "VKW 44309")
  function tokensDeLineas(lines) {
    const out = [];
    for (const l of lines) {
      const ws = String(l.text).split(/\s+/).filter(Boolean);
      for (let i = 0; i < ws.length; i++) for (let j = i; j < Math.min(ws.length, i + 3); j++) {
        out.push({ text: ws.slice(i, j + 1).join(""), h: l.h, conf: 100 * l.conf, unido: j > i });
      }
    }
    return out;
  }

  root.ElegirChasis = { elegir, normalize, clave, tokensDeLineas };
  if (typeof module !== "undefined") module.exports = root.ElegirChasis;
})(typeof self !== "undefined" ? self : globalThis);

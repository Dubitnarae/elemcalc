/* Weighing math for the phone app. Mirrors composition._actual / weighing.melt_composition
   in the desktop app; test_web.py checks both give the same numbers. */
(function (root) {
  "use strict";

  var IMPURITY = "불순물";
  var NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

  /** Number typed by the user, null when empty, NaN when not a number. */
  function parseNumber(text) {
    var s = String(text == null ? "" : text).trim();
    if (!s) return null;
    if (!NUMBER.test(s)) return NaN;
    return parseFloat(s.replace(",", "."));
  }

  function b64decode(text) {
    var s = text.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }

  function b64encode(data) {
    var bytes = new TextEncoder().encode(JSON.stringify(data));
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function num3(v) {   // weighing._num
    return v.toFixed(3).replace(/\.?0+$/, "") || "0";
  }

  /** Material.describe(): "Fe 100%" or "Fe 82 · B 18 wt%". */
  function describe(parts, pure) {
    var items = Object.keys(parts).map(function (s) { return [s, parts[s]]; });
    if (pure) {
      var main = items.filter(function (kv) { return kv[0] !== IMPURITY; })[0];
      return main[0] + " " + num3(main[1]) + "%";
    }
    items.sort(function (a, b) { return b[1] - a[1]; });
    return items.map(function (kv) { return kv[0] + " " + num3(kv[1]); }).join(" · ") + " wt%";
  }

  /** Link format from mobile.plan -> the form used here:
      e:[[sym, wt, at]], m:[[name, describe, grams, parts]] with the impurity key restored. */
  function normalise(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.m) || !Array.isArray(raw.e) || !raw.a) {
      throw new Error("칭량 정보 형식이 올바르지 않습니다.");
    }
    var plan = Object.assign({}, raw);
    plan.m = raw.m.map(function (m) {
      var parts = {};
      Object.keys(m[2]).forEach(function (s) { parts[s === "_" ? IMPURITY : s] = m[2][s]; });
      return [m[0], describe(parts, m[3] === 1), m[1], parts];
    });
    var n = 0;
    raw.e.forEach(function (e) { n += e[1] / raw.a[e[0]]; });
    plan.e = raw.e.map(function (e) { return [e[0], e[1], n ? e[1] / raw.a[e[0]] / n * 100 : 0]; });
    plan.r = raw.r || {};
    return plan;
  }

  function decodePlan(text) {
    return normalise(b64decode(text));
  }

  function recovery(plan, symbol) {
    var r = plan.r && plan.r[symbol];
    return (r == null ? 100 : r) / 100;
  }

  /**
   * actual: {material name: typed text}; opts.scale: when a material went over, raise the
   * remaining targets by the same factor so the composition still comes out right.
   * Returns per-material targets/status and the composition the weights give.
   */
  function compute(plan, actual, opts) {
    opts = opts || {};
    var tol = opts.tolerance == null ? 0.001 : opts.tolerance;
    var rows = plan.m.map(function (m) {
      var value = parseNumber(actual[m[0]]);
      return { name: m[0], describe: m[1], plan: m[2], parts: m[3],
               value: value, typed: value !== null && !isNaN(value), invalid: isNaN(value) };
    });

    var k = 1;
    if (opts.scale) {
      rows.forEach(function (r) {
        if (r.typed && r.plan > 0) k = Math.max(k, r.value / r.plan);
      });
    }

    var typedAny = false, partial = false, done = 0;
    rows.forEach(function (r) {
      r.target = r.plan * k;
      if (r.typed) {
        typedAny = true;
        r.diff = r.value - r.target;
        r.status = Math.abs(r.diff) <= tol + 1e-12 ? "ok" : (r.diff < 0 ? "short" : "over");
        if (r.status === "ok") done++;
      } else {
        partial = true;
        r.diff = null;
        r.status = r.invalid ? "invalid" : "todo";
      }
    });

    var result = { rows: rows, k: k, total: sumOf(rows, "target"), done: done,
                   partial: partial, wt: null, at: null };
    if (!typedAny) return result;

    // Same as weighing.melt_composition: weighed value, planned (target) value for the rest.
    var masses = {}, order = [];
    rows.forEach(function (r) {
      var g = r.typed ? r.value : r.target;
      if (!g) return;
      Object.keys(r.parts).forEach(function (s) {
        if (s === IMPURITY) return;
        if (!(s in masses)) { masses[s] = 0; order.push(s); }
        masses[s] += g * r.parts[s] / 100 * recovery(plan, s);
      });
    });
    var total = 0;
    order.forEach(function (s) { total += masses[s]; });
    var wt = {}, at = {}, moles = {}, n = 0;
    order.forEach(function (s) {
      wt[s] = total ? masses[s] / total * 100 : 0;
      if (plan.a[s]) { moles[s] = wt[s] / plan.a[s]; n += moles[s]; }
    });
    Object.keys(moles).forEach(function (s) { at[s] = n ? moles[s] / n * 100 : 0; });
    result.wt = wt;
    result.at = at;
    result.order = order;
    return result;
  }

  function sumOf(rows, key) {
    return rows.reduce(function (acc, r) { return acc + r[key]; }, 0);
  }

  /** Half-up rounding to a fixed number of decimals, like the desktop app's round_text. */
  function fmt(x, decimals) {
    if (x == null || isNaN(x)) return "";
    var f = Math.pow(10, decimals);
    var v = Math.round((Math.abs(x) * f) + 1e-9) / f;
    return (x < 0 && v !== 0 ? "-" : "") + v.toFixed(decimals);
  }

  var api = { IMPURITY: IMPURITY, parseNumber: parseNumber, decodePlan: decodePlan, normalise: normalise,
              b64encode: b64encode, b64decode: b64decode, compute: compute, fmt: fmt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Core = api;
})(this);

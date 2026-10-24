/* Phone weighing app: list of plans received from the desktop app, and one plan at a time
   as a checklist. Everything is kept in this browser's localStorage. */
(function () {
  "use strict";

  var C = window.Core;
  var KEY_PLANS = "elemcalc.plans", KEY_SETTINGS = "elemcalc.settings";
  var DEFAULTS = { tolG: 0.001, tolW: 0.01, scale: true, awake: true, basis: "wt" };

  var $ = function (id) { return document.getElementById(id); };
  var main = $("main");
  var current = null;      // plan entry on screen
  var wakeLock = null;

  // ----- storage -----

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  var plans = load(KEY_PLANS, []);
  var settings = Object.assign({}, DEFAULTS, load(KEY_SETTINGS, {}));

  function savePlans() { localStorage.setItem(KEY_PLANS, JSON.stringify(plans)); }
  function saveSettings() { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); }

  function idOf(text) {   // same link -> same entry, so values typed earlier are kept
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function findPlan(id) {
    for (var i = 0; i < plans.length; i++) if (plans[i].id === id) return plans[i];
    return null;
  }

  // ----- helpers -----

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function g4(x) { return C.fmt(x, 4); }

  function signed(x, d) { return (x > 0 ? "+" : "") + C.fmt(x, d); }

  function now() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
           p(d.getHours()) + ":" + p(d.getMinutes());
  }

  var toastTimer;
  function toast(text) {
    var t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function compute(entry) {
    return C.compute(entry.plan, entry.actual, { scale: settings.scale, tolerance: settings.tolG });
  }

  // ----- routing -----

  function route() {
    var hash = location.hash.slice(1);
    if (hash.indexOf("p=") === 0) {
      var text = hash.slice(2);
      var id = idOf(text);
      var entry = findPlan(id);
      if (!entry) {
        try {
          entry = { id: id, plan: C.decodePlan(text), actual: {}, memo: "", updated: Date.now() };
        } catch (e) {
          showHome("칭량 정보를 읽지 못했습니다. QR 코드를 다시 찍어 주세요.");
          return;
        }
        plans.unshift(entry);
        savePlans();
      }
      history.replaceState(null, "", "#id=" + id);
      showPlan(entry);
    } else if (hash.indexOf("id=") === 0 && findPlan(hash.slice(3))) {
      showPlan(findPlan(hash.slice(3)));
    } else {
      showHome();
    }
  }

  // ----- home -----

  function showHome(error) {
    current = null;
    releaseWake();
    document.title = "원소 함량 계산기 · 칭량";
    $("back").hidden = true;
    $("backSpacer").hidden = false;
    $("bottom").hidden = true;
    $("planActions").hidden = true;
    $("navTitle").textContent = "칭량";
    var html = '<h1>칭량</h1><div class="meta">원소 함량 계산기</div>';
    if (error) html += '<div class="banner warn">' + esc(error) + "</div>";
    if (plans.length) {
      html += '<h2>칭량 목록</h2><div class="list">';
      plans.slice().sort(function (a, b) { return b.updated - a.updated; }).forEach(function (p) {
        var r = compute(p), n = r.rows.length;
        html += '<button class="card item" data-id="' + p.id + '"><div class="grow">' +
          '<div class="name">' + esc(p.plan.n) + "</div>" +
          '<div class="sub num">' + esc(p.plan.d) + " · " + esc(g4(r.total)) + " g" +
          (p.memo ? " · " + esc(p.memo.split("\n")[0]) : "") + "</div></div>" +
          '<span class="pill' + (r.done === n ? " done" : "") + '">' +
          (r.done === n ? "완료" : r.done + " / " + n) + "</span>" +
          '<span class="chev">›</span></button>';
      });
      html += "</div>";
    } else {
      html += '<div class="empty"><div class="big">⚖︎</div>아직 받은 칭량이 없습니다.</div>';
    }
    html += '<h2>새 칭량 받기</h2><div class="card"><ol class="steps">' +
      "<li>사무실 PC의 원소 함량 계산기에서 조성과 총 질량을 넣습니다.</li>" +
      "<li><b>휴대폰으로 보내기</b>를 누릅니다.</li>" +
      "<li>화면의 QR 코드를 휴대폰 카메라로 찍습니다.<br>" +
      '<span class="meta" style="font-size:13px">카톡으로 받은 링크를 눌러도 됩니다.</span></li>' +
      "</ol></div>";
    main.innerHTML = html;
    Array.prototype.forEach.call(main.querySelectorAll(".item"), function (b) {
      b.onclick = function () { location.hash = "id=" + b.dataset.id; };
    });
    window.scrollTo(0, 0);
  }

  // ----- one plan -----

  function showPlan(entry) {
    current = entry;
    var plan = entry.plan;
    document.title = plan.n + " · 칭량";
    $("back").hidden = false;
    $("backSpacer").hidden = true;
    $("bottom").hidden = false;
    $("planActions").hidden = false;
    $("navTitle").textContent = plan.n;

    var html = "<h1>" + esc(plan.n) + "</h1>" +
      '<div class="meta num">' + esc(plan.d) + " 계산 · 총 " + esc(plan.t) + " g</div>" +
      '<div class="progress"><div class="bar"><i id="bar"></i></div>' +
      '<div class="label"><span id="doneText"></span><span id="totalText" class="num"></span></div></div>' +
      '<div id="banner"></div>' +
      "<h2>원료</h2>";
    plan.m.forEach(function (m, i) {
      html += '<div class="card mat" id="mat' + i + '"><div class="top"><div>' +
        '<div class="name">' + esc(m[0]) + "</div>" +
        '<div class="desc">' + esc(m[1]) + "</div></div>" +
        '<div class="badge" id="badge' + i + '"></div></div>' +
        '<div class="target num"><span class="label">목표</span>' +
        '<span class="value" id="target' + i + '"></span><span class="unit">g</span>' +
        '<span class="was" id="was' + i + '"></span></div>' +
        '<label class="field"><input id="in' + i + '" type="text" inputmode="decimal" ' +
        'enterkeyhint="next" autocomplete="off" placeholder="저울 값 입력">' +
        '<span class="unit">g</span></label>' +
        '<div class="state" id="state' + i + '"></div></div>';
    });
    html += '<h2>실제 조성 <span class="seg"><button data-b="wt">wt%</button>' +
      '<button data-b="at">at%</button></span></h2>' +
      '<div class="section-note" id="compNote"></div>' +
      '<div class="card"><table class="num"><thead><tr><th>원소</th><th>목표</th><th>실제</th>' +
      '<th>차이</th></tr></thead><tbody id="compBody"></tbody></table></div>' +
      "<h2>메모</h2>" +
      '<textarea id="memo" placeholder="시료 번호, 도가니, 특이사항 등"></textarea>';
    main.innerHTML = html;

    plan.m.forEach(function (m, i) {
      var input = $("in" + i);
      input.value = entry.actual[m[0]] || "";
      input.oninput = function () {
        if (input.value.trim()) entry.actual[m[0]] = input.value.trim();
        else delete entry.actual[m[0]];
        touch();
        update();
      };
      input.onkeydown = function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var next = $("in" + (i + 1));
        if (next) next.focus(); else input.blur();
      };
    });
    var memo = $("memo");
    memo.value = entry.memo || "";
    memo.oninput = function () { entry.memo = memo.value; touch(); };
    Array.prototype.forEach.call(main.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { settings.basis = b.dataset.b; saveSettings(); update(); };
    });
    update();
    window.scrollTo(0, 0);
    requestWake();
  }

  function touch() {
    current.updated = Date.now();
    savePlans();
  }

  function update() {
    var entry = current, plan = entry.plan, r = compute(entry), n = r.rows.length;
    $("bar").style.width = (r.done / n * 100) + "%";
    $("doneText").textContent = r.done === n ? "모두 칭량했습니다 ✓" : r.done + " / " + n + " 칭량 완료";
    $("totalText").textContent = "장입 " + g4(r.total) + " g";

    var banner = "";
    if (r.k > 1 + 1e-9) {
      var lead = r.rows.reduce(function (a, b) {
        return b.typed && b.plan > 0 && (!a || b.value / b.plan > a.value / a.plan) ? b : a;
      }, null);
      var big = r.k > 1.2;
      banner = '<div class="banner' + (big ? " warn" : "") + '"><b>' + esc(lead.name) + "</b>이(가) 많이 들어가 " +
        "다른 원료 목표를 <b class=\"num\">×" + C.fmt(r.k, 4) + "</b> 늘렸습니다." +
        (big ? "<br>입력한 값이 맞는지 확인하세요." : "") + "</div>";
    }
    $("banner").innerHTML = banner;

    r.rows.forEach(function (row, i) {
      $("mat" + i).className = "card mat " + row.status;
      $("badge" + i).textContent = row.status === "ok" ? "✓" : (row.status === "todo" ? "" : "!");
      $("target" + i).textContent = g4(row.target);
      $("was" + i).textContent = Math.abs(row.target - row.plan) > 5e-5 ? g4(row.plan) + " g" : "";
      var text = "";
      if (row.status === "todo") text = "";
      else if (row.status === "invalid") text = "숫자가 아닙니다.";
      else if (row.status === "ok") text = "✓ 완료 · 차이 " + signed(row.diff, 4) + " g";
      else if (row.status === "short") text = g4(-row.diff) + " g 더 넣으세요.";
      else text = g4(row.diff) + " g 넘었습니다." +
        (settings.scale ? "" : " (설정에서 '넘치면 나머지 원료 늘리기'를 켜면 맞출 수 있어요)");
      $("state" + i).textContent = text;
    });

    Array.prototype.forEach.call(main.querySelectorAll(".seg button"), function (b) {
      b.className = b.dataset.b === settings.basis ? "on" : "";
    });
    var useAt = settings.basis === "at";
    var col = useAt ? 2 : 1, got = useAt ? r.at : r.wt;
    var symbols = plan.e.map(function (e) { return e[0]; });
    if (got) (r.order || []).forEach(function (s) { if (symbols.indexOf(s) < 0) symbols.push(s); });
    var want = {};
    plan.e.forEach(function (e) { want[e[0]] = e[col]; });
    var body = "";
    symbols.forEach(function (s) {
      var w = want[s] || 0;
      var cells = "<td>" + esc(s) + "</td><td>" + C.fmt(w, 2) + "</td>";
      if (got) {
        var v = got[s] || 0, d = v - w;
        var off = Math.abs(d) > settings.tolW;
        cells += '<td class="' + (off ? "off" : "") + '">' + C.fmt(v, 2) + "</td>" +
          '<td class="' + (off ? "off" : "good") + '">' + signed(d, 2) + "</td>";
      } else {
        cells += "<td>–</td><td></td>";
      }
      body += "<tr>" + cells + "</tr>";
    });
    $("compBody").innerHTML = body;
    $("compNote").textContent = !got ? "칭량값을 넣으면 실제로 만들어질 조성이 계산됩니다." :
      (r.partial ? "아직 넣지 않은 원료는 목표값대로 넣는다고 보고 계산한 예상 조성입니다." :
        "입력한 칭량값으로 계산한 조성입니다" + (plan.r && Object.keys(plan.r).length ? " (회수율 반영)." : "."));
  }

  // ----- sharing the result back to the PC -----

  function resultText(entry) {
    var plan = entry.plan, r = compute(entry);
    var lines = ["[칭량 결과] " + plan.n, now() + " 칭량 (" + plan.d + " 계산)"];
    if (entry.memo.trim()) lines.push("메모: " + entry.memo.trim());
    lines.push("");
    r.rows.forEach(function (row) {
      lines.push(row.name + ": " + (row.typed ? g4(row.value) : "-") + " g (목표 " + g4(row.target) + ")");
    });
    if (r.k > 1 + 1e-9) lines.push("배율 ×" + C.fmt(r.k, 4) + " · 총 " + g4(r.total) + " g");
    if (r.wt) {
      lines.push("");
      lines.push((r.partial ? "예상" : "실제") + " 조성 wt%: " + (r.order || []).map(function (s) {
        return s + " " + C.fmt(r.wt[s], 2);
      }).join(" · "));
    }
    var data = { v: 1, n: plan.n, d: plan.d, k: r.k, memo: entry.memo.trim(), at: now(), a: {} };
    r.rows.forEach(function (row) { if (row.typed) data.a[row.name] = String(entry.actual[row.name]); });
    lines.push("", "※ 아래 줄은 계산기의 '휴대폰 칭량 결과 넣기'에 쓰입니다.", "ELEMCALC1:" + C.b64encode(data));
    return lines.join("\n");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  }

  $("shareBtn").onclick = function () {
    if (!current) return;
    var r = compute(current), left = r.rows.length - r.done;
    if (!Object.keys(current.actual).length) { toast("먼저 칭량값을 입력하세요."); return; }
    if (left > 0 && !confirm("아직 완료되지 않은 원료가 " + left + "개 있습니다. 그래도 보낼까요?")) return;
    var text = resultText(current);
    if (navigator.share) {
      navigator.share({ title: "[칭량 결과] " + current.plan.n, text: text }).catch(function (e) {
        if (e && e.name === "AbortError") return;
        copyText(text).then(function () { toast("결과를 복사했습니다. 카톡에 붙여 넣으세요."); });
      });
    } else {
      copyText(text).then(function () { toast("결과를 복사했습니다. 카톡에 붙여 넣으세요."); },
                          function () { toast("복사하지 못했습니다."); });
    }
  };

  // ----- settings sheet -----

  function openSheet() {
    $("tolG").value = settings.tolG;
    $("tolW").value = settings.tolW;
    $("scale").checked = settings.scale;
    $("awake").checked = settings.awake;
    $("sheetBg").style.display = "block";
    requestAnimationFrame(function () { $("sheet").classList.add("open"); });
  }

  function closeSheet() {
    var g = C.parseNumber($("tolG").value), w = C.parseNumber($("tolW").value);
    if (g !== null && !isNaN(g) && g >= 0) settings.tolG = g;
    if (w !== null && !isNaN(w) && w >= 0) settings.tolW = w;
    settings.scale = $("scale").checked;
    settings.awake = $("awake").checked;
    saveSettings();
    $("sheet").classList.remove("open");
    setTimeout(function () { $("sheetBg").style.display = "none"; }, 250);
    if (current) { update(); requestWake(); } else showHome();
  }

  $("settingsBtn").onclick = openSheet;
  $("closeSheet").onclick = closeSheet;
  $("sheetBg").onclick = closeSheet;
  $("back").onclick = function () { location.hash = ""; };
  $("clearBtn").onclick = function () {
    if (!current || !confirm("이 칭량에 입력한 값을 모두 지울까요?")) return;
    current.actual = {};
    touch();
    closeSheet();
    showPlan(current);
  };
  $("deleteBtn").onclick = function () {
    if (!current || !confirm("'" + current.plan.n + "'을(를) 목록에서 삭제할까요?")) return;
    var id = current.id;
    plans = plans.filter(function (p) { return p.id !== id; });
    savePlans();
    current = null;
    closeSheet();
    location.hash = "";
  };

  // ----- keep the screen on while weighing -----

  function requestWake() {
    if (!current || !settings.awake || !("wakeLock" in navigator) || wakeLock) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () {});
  }

  function releaseWake() {
    if (wakeLock) wakeLock.release().catch(function () {});
    wakeLock = null;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") requestWake();
  });

  window.addEventListener("scroll", function () {
    $("nav").classList.toggle("scrolled", window.scrollY > 50);
  }, { passive: true });

  window.addEventListener("hashchange", route);
  route();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();

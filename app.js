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
  var storageWarned = false;

  // ----- storage -----

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  var plans = load(KEY_PLANS, []);
  var settings = Object.assign({}, DEFAULTS, load(KEY_SETTINGS, {}));

  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {   // private browsing, storage full, or storage switched off
      if (!storageWarned) {
        storageWarned = true;
        toast("이 휴대폰에 저장하지 못했습니다. 비공개(시크릿) 모드라면 일반 창에서 열어 주세요.", 6000);
      }
    }
  }
  function savePlans() { store(KEY_PLANS, plans); }
  function saveSettings() { store(KEY_SETTINGS, settings); }

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

  function unitOf(plan) { return plan.u || "g"; }

  /** A mass in the plan's unit, to the decimals the PC uses (balance resolution). */
  function m(x, plan) { return C.fmt(x, plan.q == null ? 4 : plan.q); }

  function signed(text) { return (text.charAt(0) !== "-" && parseFloat(text) !== 0 ? "+" : "") + text; }

  function now() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
           p(d.getHours()) + ":" + p(d.getMinutes());
  }

  var toastTimer;
  function toast(text, ms) {
    var t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, ms || 2600);
  }

  function compute(entry) {
    return C.compute(entry.plan, entry.actual,
                     { scale: settings.scale, tolerance: C.toUnit(settings.tolG, entry.plan) });
  }

  // ----- routing -----

  var LINK_HELP = {
    broken: "링크가 중간에 잘려 칭량 정보를 읽지 못했습니다. QR 코드를 다시 찍거나, 카톡으로 받았다면 " +
            "링크 전체가 한 덩어리로 왔는지 확인해 주세요. (PC에서 '링크 복사'로 다시 보내면 됩니다.)",
    newer: "PC 계산기가 이 화면보다 새 버전입니다. 인터넷이 연결된 상태에서 이 페이지를 닫았다가 " +
           "다시 열면 새 버전으로 바뀝니다. 그래도 안 되면 브라우저에서 새로고침해 주세요.",
    format: "칭량 정보 형식이 올바르지 않습니다. PC 계산기의 '휴대폰으로 보내기'에서 만든 QR 코드나 " +
            "링크인지 확인해 주세요."
  };

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
          history.replaceState(null, "", location.pathname);
          showHome(LINK_HELP[e.code] || LINK_HELP.format);
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
      showHome(hash.indexOf("id=") === 0 ?
        "이 칭량은 목록에 없습니다(삭제했거나 다른 휴대폰·브라우저에서 받은 것). QR 코드를 다시 찍어 주세요." : "");
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
          '<div class="sub num">' + esc(p.plan.d) + " · " + esc(m(r.total, p.plan)) + " " + esc(unitOf(p.plan)) +
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
    var plan = entry.plan, unit = esc(unitOf(plan));
    document.title = plan.n + " · 칭량";
    $("back").hidden = false;
    $("backSpacer").hidden = true;
    $("bottom").hidden = false;
    $("planActions").hidden = false;
    $("navTitle").textContent = plan.n;

    var html = "<h1>" + esc(plan.n) + "</h1>" +
      '<div class="meta num">' + esc(plan.d) + " 계산 · 총 " + esc(plan.t) + " " + unit + "</div>" +
      '<div class="progress"><div class="bar"><i id="bar"></i></div>' +
      '<div class="label"><span id="doneText"></span><span id="totalText" class="num"></span></div></div>' +
      '<div id="banner"></div>' +
      "<h2>원료</h2>";
    plan.m.forEach(function (mat, i) {
      html += '<div class="card mat" id="mat' + i + '"><div class="top"><div>' +
        '<div class="name">' + esc(mat[0]) + "</div>" +
        '<div class="desc">' + esc(mat[1]) + "</div></div>" +
        '<div class="badge" id="badge' + i + '"></div></div>' +
        '<div class="target num"><span class="label">목표</span>' +
        '<span class="value" id="target' + i + '"></span><span class="unit">' + unit + '</span>' +
        '<span class="was" id="was' + i + '"></span></div>' +
        '<label class="field"><input id="in' + i + '" type="text" inputmode="decimal" ' +
        'enterkeyhint="next" autocomplete="off" placeholder="저울 값 입력">' +
        '<span class="unit">' + unit + '</span></label>' +
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

    plan.m.forEach(function (mat, i) {
      var input = $("in" + i);
      input.value = entry.actual[mat[0]] || "";
      input.oninput = function () {
        if (input.value.trim()) entry.actual[mat[0]] = input.value.trim();
        else delete entry.actual[mat[0]];
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
    var unit = unitOf(plan);
    $("bar").style.width = (r.done / n * 100) + "%";
    $("doneText").textContent = r.done === n ? "모두 칭량했습니다 ✓" : r.done + " / " + n + " 칭량 완료";
    $("totalText").textContent = "장입 " + m(r.total, plan) + " " + unit;

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
      $("target" + i).textContent = m(row.target, plan);
      $("was" + i).textContent = m(row.target, plan) !== m(row.plan, plan) ? m(row.plan, plan) + " " + unit : "";
      var text = "";
      if (row.status === "todo") text = "";
      else if (row.status === "invalid") text = "숫자만 입력하세요 (예: 12.345). 쉼표(,)도 소수점으로 읽습니다.";
      else if (row.status === "ok") text = "✓ 완료 · 차이 " + signed(m(row.diff, plan)) + " " + unit;
      else if (row.status === "short") text = m(-row.diff, plan) + " " + unit + " 더 넣으세요.";
      else text = m(row.diff, plan) + " " + unit + " 넘었습니다." +
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
          '<td class="' + (off ? "off" : "good") + '">' + signed(C.fmt(d, 2)) + "</td>";
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

  // ----- sending the result back to the PC -----

  function resultText(entry) {
    var plan = entry.plan, r = compute(entry), unit = unitOf(plan);
    var lines = ["[칭량 결과] " + plan.n, now() + " 칭량 (" + plan.d + " 계산)"];
    if (entry.memo.trim()) lines.push("메모: " + entry.memo.trim());
    lines.push("");
    r.rows.forEach(function (row) {
      lines.push(row.name + ": " + (row.typed ? m(row.value, plan) : "-") + " " + unit +
                 " (목표 " + m(row.target, plan) + ")");
    });
    if (r.k > 1 + 1e-9) lines.push("배율 ×" + C.fmt(r.k, 4) + " · 총 " + m(r.total, plan) + " " + unit);
    if (r.wt) {
      lines.push("");
      lines.push((r.partial ? "예상" : "실제") + " 조성 wt%: " + (r.order || []).map(function (s) {
        return s + " " + C.fmt(r.wt[s], 2);
      }).join(" · "));
    }
    var data = { v: 1, n: plan.n, d: plan.d, k: r.k, u: unit, memo: entry.memo.trim(), at: now(), a: {} };
    r.rows.forEach(function (row) { if (row.typed) data.a[row.name] = String(entry.actual[row.name]); });
    lines.push("", "※ 아래 줄은 계산기의 '휴대폰 칭량 결과 넣기'에 쓰입니다.", "ELEMCALC1:" + C.b64encode(data));
    return lines.join("\n");
  }

  /** Copy to the clipboard; resolves true/false instead of failing. */
  function copyText(text) {
    var legacy = function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
                                                      function () { return legacy(); });
    }
    return Promise.resolve(legacy());
  }

  /** Ready to send? Asks when some materials are not done yet. */
  function readyText() {
    if (!current) return null;
    var r = compute(current), left = r.rows.length - r.done;
    if (!Object.keys(current.actual).length) { toast("먼저 칭량값을 입력하세요."); return null; }
    if (left > 0 && !confirm("아직 완료되지 않은 원료가 " + left + "개 있습니다. 그래도 보낼까요?")) return null;
    return resultText(current);
  }

  /** When copying is not allowed: show the text so it can be selected and copied by hand. */
  function showManualCopy(text) {
    $("manualText").value = text;
    $("copyBg").style.display = "block";
    $("copySheet").hidden = false;
    setTimeout(function () { $("manualText").focus(); $("manualText").select(); }, 50);
  }

  function hideManualCopy() {
    $("copySheet").hidden = true;
    $("copyBg").style.display = "none";
  }

  function copyResult(text) {
    copyText(text).then(function (ok) {
      if (ok) toast("결과를 복사했습니다. 카톡 '나와의 채팅'에 붙여 넣으세요.", 3600);
      else showManualCopy(text);
    });
  }

  $("copyBtn").onclick = function () {
    var text = readyText();
    if (text) copyResult(text);
  };

  $("shareBtn").onclick = function () {
    var text = readyText();
    if (!text) return;
    if (!navigator.share) { copyResult(text); return; }
    navigator.share({ title: "[칭량 결과] " + current.plan.n, text: text }).catch(function (e) {
      if (e && e.name === "AbortError") return;   // closed the share sheet
      copyResult(text);
    });
  };

  $("closeCopy").onclick = hideManualCopy;
  $("copyBg").onclick = hideManualCopy;

  // ----- settings sheet -----

  function openSheet() {
    $("tolG").value = settings.tolG;
    $("tolW").value = settings.tolW;
    $("scale").checked = settings.scale;
    $("awake").checked = settings.awake;
    showOfflineStatus();
    $("sheetBg").style.display = "block";
    requestAnimationFrame(function () { $("sheet").classList.add("open"); });
  }

  function closeSheet() {
    var g = C.parseNumber($("tolG").value), w = C.parseNumber($("tolW").value);
    if (g !== null && !isNaN(g) && g >= 0) settings.tolG = g;
    else if ($("tolG").value.trim()) toast("칭량 허용 오차가 숫자가 아니어서 바꾸지 않았습니다.");
    if (w !== null && !isNaN(w) && w >= 0) settings.tolW = w;
    else if ($("tolW").value.trim()) toast("조성 허용 오차가 숫자가 아니어서 바꾸지 않았습니다.");
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

  // ----- offline -----

  function showNetwork() {
    $("offline").hidden = navigator.onLine !== false;
  }

  /** Settings sheet line: can this page open without internet? (service worker + cache) */
  function showOfflineStatus() {
    var el = $("offlineStatus");
    if (!("serviceWorker" in navigator) || !window.caches) {
      el.textContent = "이 브라우저는 오프라인 사용을 지원하지 않습니다. 인터넷이 될 때 열어 주세요.";
      return;
    }
    caches.keys().then(function (keys) {
      var ready = navigator.serviceWorker.controller &&
        keys.some(function (k) { return k.indexOf("elemcalc-") === 0; });
      el.textContent = ready ? "✓ 인터넷이 끊겨도 이 화면을 열고 칭량할 수 있습니다." :
        "오프라인 사용 준비 중입니다. 인터넷이 될 때 한 번 더 열어 두면 됩니다.";
    }).catch(function () { el.textContent = ""; });
  }

  window.addEventListener("online", function () { showNetwork(); toast("인터넷에 다시 연결됐습니다."); });
  window.addEventListener("offline", showNetwork);
  showNetwork();

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

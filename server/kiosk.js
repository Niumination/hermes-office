/**
 * kiosk.js — wall-display status page.
 *
 * A TV in the corner of a client's office running this all day is the
 * cheapest advertising the product has, and the only feature that sells
 * while nobody is using it. That framing drives every decision below.
 *
 * IT DOWNGRADES ITSELF
 * --------------------
 * The single most important rule here: the kiosk renders the GUEST view by
 * default, even when the request carries a valid owner cookie.
 *
 * This looks wrong until you picture the actual deployment. The screen is on
 * a wall. It is seen by visitors, the cleaner, a delivery driver, whoever
 * walks past during a demo, and every phone camera in the room. The person
 * who sets it up will do so from their own laptop, logged in as owner, and
 * will never think about the cookie again. Defaulting to the owner view
 * would put a live dollar figure on a public wall, forever, by accident.
 *
 * An owner who genuinely wants numbers on the screen passes `?reveal=1` and
 * must still hold an owner session. Opt-in, per-URL, visible in the address
 * bar of the machine that runs it.
 *
 * NO BUILD STEP, NO NETWORK
 * -------------------------
 * Self-contained HTML: inline CSS, inline SVG, no fonts, no CDN, no bundle.
 * A kiosk that breaks when the asset pipeline changes is a kiosk that will be
 * showing a broken page during someone's board meeting. It also means this
 * page renders inside the sandboxed preview, where external resources do not
 * load at all.
 *
 * It server-renders the current state, so the first paint is correct with
 * JavaScript disabled. The refresh loop is progressive enhancement, and falls
 * back to a plain meta refresh.
 *
 * STALENESS IS SHOWN, NOT HIDDEN
 * ------------------------------
 * If the refresh fails, the page keeps displaying the last good state AND
 * says how old it is. A wall screen frozen on stale data that looks live is
 * worse than no screen: it will be trusted.
 */

/** Burn state → display. Same five states and hues as the shader and the replay renderer. */
const BURN_DISPLAY = Object.freeze({
  normal: { label: "NORMAL", accent: "#5ac8be", bg: "#0e1a1f", text: "Semua dalam anggaran" },
  warm: { label: "HANGAT", accent: "#e0b054", bg: "#1f1a10", text: "Belanja meningkat" },
  hot: { label: "PANAS", accent: "#e88c3c", bg: "#241408", text: "Mendekati batas" },
  critical: { label: "KRITIS", accent: "#e45848", bg: "#260f0f", text: "Nyaris melewati batas" },
  tripped: { label: "TERPUTUS", accent: "#7896e6", bg: "#101428", text: "Breaker jatuh — belanja dihentikan" },
});

export const KIOSK_REFRESH_MS = 15_000;

/**
 * Escape text for HTML.
 *
 * Agent names, room labels and tool names arrive from telemetry — they are
 * arbitrary attacker-influenced strings, and this page is the one place in
 * the product that renders them as raw markup. Every interpolation below goes
 * through here. There is a test that posts a <script> tag as an agent name.
 */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Reduce a full snapshot to what a wall may show.
 *
 * Separate from rendering on purpose: redaction decided inside a template is
 * redaction nobody can test. This returns plain data, and the tests assert on
 * it directly rather than grepping HTML.
 */
export function kioskModel({ policy, burn, reveal = false, now = Date.now() }) {
  const state = burn?.global?.state ?? "normal";
  const display = BURN_DISPLAY[state] ?? BURN_DISPLAY.normal;

  const rooms = (policy?.rooms ?? [])
    .map((r) => ({
      room: r.room,
      label: r.label || r.room,
      trust: r.trust ?? null,
      state: r.state ?? null,
      occupants: (r.occupants ?? []).map((o) => o.agent).filter(Boolean).sort(),
    }))
    .sort((a, b) => b.occupants.length - a.occupants.length || String(a.room).localeCompare(b.room));

  const agents = rooms.flatMap((r) => r.occupants);

  return {
    burn: {
      state,
      label: display.label,
      accent: display.accent,
      bg: display.bg,
      caption: display.text,
      // Ratio is already in the guest contract — it is a temperature, not a
      // sum. Dollars are not, and only appear with an explicit reveal.
      ratio: typeof burn?.global?.ratio === "number" ? burn.global.ratio : null,
      spentHourUsd: reveal ? (burn?.global?.spentHourUsd ?? null) : null,
      limitHourUsd: reveal ? (burn?.global?.limitHourUsd ?? null) : null,
    },
    rooms,
    totals: {
      agents: agents.length,
      rooms: rooms.length,
      occupiedRooms: rooms.filter((r) => r.occupants.length > 0).length,
      pendingApprovals: (policy?.pendingApprovals ?? []).length,
    },
    reveal,
    generatedAt: now,
  };
}

function ratioBar(ratio, accent) {
  if (ratio == null) return "";
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return `<div class="bar"><span style="width:${pct}%;background:${accent}"></span></div>
          <div class="barlabel">${pct}% dari anggaran per jam</div>`;
}

function roomCard(r, accent) {
  const occupied = r.occupants.length > 0;
  const people = r.occupants
    .slice(0, 6)
    .map((a) => `<li>${esc(a)}</li>`)
    .join("");
  const more = r.occupants.length > 6 ? `<li class="more">+${r.occupants.length - 6} lagi</li>` : "";
  return `<article class="room${occupied ? " on" : ""}"${occupied ? ` style="border-color:${accent}"` : ""}>
    <header${occupied ? ` style="background:${accent}"` : ""}>
      <span class="name">${esc(r.label)}</span>
      ${r.trust != null ? `<span class="trust">trust ${esc(r.trust)}</span>` : ""}
    </header>
    <ul>${people}${more}</ul>
  </article>`;
}

/**
 * Render the whole page. Pure: same model in, same HTML out.
 */
export function renderKiosk(model, { refreshMs = KIOSK_REFRESH_MS } = {}) {
  const b = model.burn;
  const money =
    model.reveal && b.spentHourUsd != null
      ? `<div class="money">$${Number(b.spentHourUsd).toFixed(2)}${
          b.limitHourUsd ? ` / $${Number(b.limitHourUsd).toFixed(2)}` : ""
        } per jam</div>`
      : "";

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hermes Office — Status</title>
<!-- Plain meta refresh as the floor: if the fetch loop below fails, or JS is
     off entirely, the wall still updates. -->
<noscript><meta http-equiv="refresh" content="${Math.round(refreshMs / 1000)}"></noscript>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:${b.bg};color:#eceef0;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
       padding:2.5vh 2.5vw;display:flex;flex-direction:column;gap:2.2vh;overflow:hidden;
       transition:background .8s ease}
  header.top{display:flex;align-items:baseline;justify-content:space-between;gap:1rem}
  h1{font-size:clamp(20px,2.6vw,40px);letter-spacing:.04em;font-weight:700}
  .sub{color:#9aa4ad;font-size:clamp(11px,1.1vw,16px)}
  .state{display:flex;align-items:center;gap:.9rem}
  .pill{background:${b.accent};color:${b.bg};font-weight:700;letter-spacing:.08em;
        padding:.45em 1.1em;border-radius:999px;font-size:clamp(13px,1.5vw,24px)}
  .caption{color:#c3cbd2;font-size:clamp(12px,1.2vw,18px)}
  .money{font-size:clamp(14px,1.4vw,22px);color:${b.accent};font-variant-numeric:tabular-nums}
  .bar{height:10px;background:#2c343c;border-radius:999px;overflow:hidden}
  .bar span{display:block;height:100%;transition:width .8s ease}
  .barlabel{color:#8d969e;font-size:clamp(10px,1vw,14px);margin-top:.35em}
  .grid{flex:1;display:grid;gap:1.2vh 1vw;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
        align-content:start;overflow:hidden}
  .room{border:1px solid #3a434b;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.02)}
  .room.on{background:rgba(255,255,255,.05)}
  .room header{display:flex;justify-content:space-between;align-items:center;gap:.5rem;
               padding:.5em .7em;background:#2a323a}
  .room.on header{color:${b.bg}}
  .room .name{font-weight:700;font-size:clamp(12px,1.15vw,18px)}
  .room .trust{font-size:clamp(9px,.85vw,13px);opacity:.75}
  .room ul{list-style:none;padding:.5em .7em;display:flex;flex-direction:column;gap:.25em;
           font-size:clamp(11px,1.05vw,16px)}
  .room ul:empty{padding:.9em}
  .room li::before{content:"● ";color:${b.accent}}
  .room li.more{opacity:.6}
  .room li.more::before{content:""}
  footer{display:flex;justify-content:space-between;color:#79828a;
         font-size:clamp(10px,.95vw,14px)}
  .stale{color:#e45848;font-weight:700}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body data-burn="${esc(b.state)}">
<header class="top">
  <div>
    <h1>HERMES OFFICE</h1>
    <div class="sub">${model.totals.agents} agent · ${model.totals.occupiedRooms}/${model.totals.rooms} ruangan aktif${
      model.totals.pendingApprovals ? ` · ${model.totals.pendingApprovals} menunggu persetujuan` : ""
    }</div>
  </div>
  <div class="state">
    <div style="text-align:right">
      <div class="caption">${esc(b.caption)}</div>
      ${money}
    </div>
    <span class="pill">${esc(b.label)}</span>
  </div>
</header>
${ratioBar(b.ratio, b.accent)}
<main class="grid">
${model.rooms.map((r) => roomCard(r, b.accent)).join("\n")}
</main>
<footer>
  <span>denah lantai adalah kebijakan</span>
  <span id="age" data-at="${model.generatedAt}">baru saja</span>
</footer>
<script>
(function(){
  var REFRESH=${refreshMs}, at=${model.generatedAt}, failures=0;
  var age=document.getElementById('age');
  function tick(){
    var s=Math.round((Date.now()-at)/1000);
    // Showing stale data that looks live is worse than showing nothing: a
    // wall screen gets trusted precisely because nobody is interacting
    // with it.
    if(s>${Math.round((refreshMs * 3) / 1000)}){
      age.className='stale';
      age.textContent='TERPUTUS — data '+s+'s lalu';
    } else {
      age.className='';
      age.textContent=s<2?'baru saja':s+'s lalu';
    }
  }
  setInterval(tick,1000);
  function refresh(){
    fetch(location.pathname+location.search,{headers:{'x-kiosk':'1'}})
      .then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); })
      .then(function(html){
        var doc=new DOMParser().parseFromString(html,'text/html');
        document.querySelector('main').innerHTML=doc.querySelector('main').innerHTML;
        document.querySelector('header.top').innerHTML=doc.querySelector('header.top').innerHTML;
        document.body.setAttribute('style',doc.body.getAttribute('style')||'');
        var oldBar=document.querySelector('.bar'), newBar=doc.querySelector('.bar');
        if(oldBar&&newBar) oldBar.parentNode.replaceChild(newBar,oldBar);
        var s=doc.querySelector('style'); if(s) document.querySelector('style').textContent=s.textContent;
        at=Number(doc.getElementById('age').dataset.at)||Date.now();
        failures=0; tick();
      })
      .catch(function(){
        // Keep the last good frame. Back off so a dead server is not hammered
        // by a screen nobody is watching.
        failures++;
        if(failures>3) REFRESH=Math.min(REFRESH*2,300000);
      });
  }
  setInterval(function(){ refresh(); },REFRESH);
})();
</script>
</body>
</html>`;
}

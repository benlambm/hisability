// Renders key poses and tween samples for catalog demos, for visual authoring review.
// Query: ?cat=lower|upper|core|cardio|all&ids=a,b&samples=6&alt=1
import {
  buildFigureSVG, solvePose, keyPose, poseAt, cycleSeconds, contactGaps,
} from '../js/figure.js';

const q = new URLSearchParams(location.search);
const cat = q.get('cat') ?? 'all';
const ids = q.get('ids') ? q.get('ids').split(',') : null;
const samples = Number(q.get('samples') ?? 6);
const out = document.getElementById('out');
const report = [];

function cell(demo, pose, caption, isKey, bad) {
  const c = document.createElement('div');
  c.className = 'cell' + (isKey ? ' key' : '');
  const { svg, update } = buildFigureSVG(demo, { frame: 'scene' });
  update(solvePose(pose, demo));
  c.appendChild(svg);
  const cap = document.createElement('div');
  cap.className = 'cap' + (bad ? ' bad' : '');
  cap.textContent = caption;
  c.appendChild(cap);
  return c;
}

function renderDemo(title, sub, demo) {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('div');
  label.className = 'label';
  label.innerHTML = `${title}<small>${sub}</small>`;
  row.appendChild(label);
  const entry = { title, keys: [] };
  demo.keys.forEach((k, i) => {
    const pose = keyPose(demo, i);
    const solved = solvePose(pose, demo);
    const airborne = (pose.lift ?? 0) > 0;
    const contacts = k.contacts ?? demo.contacts;
    const gaps = contacts && !airborne ? contactGaps(solved, contacts) : {};
    const bad = Object.values(gaps).some((g) => Math.abs(g) > 3.5);
    const gapText = Object.entries(gaps).map(([n, g]) => `${n.replace(/^(near|far)/, (m) => m[0])}:${g}`).join(' ');
    entry.keys.push({ key: i + 1, gaps });
    row.appendChild(cell(demo, pose, `key ${i + 1} ${airborne ? 'airborne ' + pose.lift : gapText}`, true, bad));
  });
  const cyc = cycleSeconds(demo);
  if (cyc > 0) {
    for (let s = 0; s < samples; s++) {
      const t = (cyc * (s + 0.5)) / samples;
      row.appendChild(cell(demo, poseAt(demo, t), `t=${t.toFixed(2)}s`, false, false));
    }
  }
  report.push(entry);
  out.appendChild(row);
}

async function main() {
  const cats = cat === 'all' ? ['lower', 'upper', 'core', 'cardio'] : [cat];
  for (const c of cats) {
    let list;
    try {
      list = (await import(`../js/catalog/${c}.js`)).default;
    } catch (e) {
      out.insertAdjacentHTML('beforeend', `<p class="err">${c}: ${e.message}</p>`);
      continue;
    }
    const h = document.createElement('h2');
    h.textContent = `${c} (${list.length})`;
    out.appendChild(h);
    for (const m of list) {
      if (ids && !ids.includes(m.id)) continue;
      try {
        renderDemo(m.name, `${m.id} · ${m.demo.view ?? 'side'} · ${m.impact}`, m.demo);
        if (q.get('alt') !== '0' && m.alt?.demo) renderDemo(`↳ ${m.alt.name}`, 'alternative', m.alt.demo);
      } catch (e) {
        out.insertAdjacentHTML('beforeend', `<p class="err">${m.id}: ${e.message}</p>`);
      }
    }
  }
  window.__report = report;
  window.__ready = true;
}

main().catch((e) => {
  out.insertAdjacentHTML('beforeend', `<p class="err">${e.stack}</p>`);
  window.__ready = true;
});

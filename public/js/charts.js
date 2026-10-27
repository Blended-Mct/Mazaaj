// Small, dependency-free charts for the dashboard. Every chart has a hover/focus
// tooltip and a table twin; text never takes the series colour.

import { html, render, fmt } from './lib.js';

const MOODS = [
  { key: 'upset', label: 'Upset' },
  { key: 'frustrated', label: 'Frustrated' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'positive', label: 'Positive' },
];

function tooltip(host) {
  let tip = host.querySelector(':scope > .tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'presentation');
    host.appendChild(tip);
  }
  return {
    show(title, rows, x, y) {
      tip.replaceChildren();
      const t = document.createElement('div');
      t.className = 'tt-title';
      t.textContent = title;
      tip.appendChild(t);
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'tt-row';
        const key = document.createElement('i');
        key.className = 'key';
        if (r.color) key.style.background = r.color;
        const v = document.createElement('b');
        v.textContent = r.value;
        const l = document.createElement('span');
        l.textContent = r.label;
        row.append(key, v, l);
        tip.appendChild(row);
      }
      tip.classList.add('on');
      const hostW = host.clientWidth;
      const w = tip.offsetWidth;
      const left = Math.min(Math.max(0, x + 14), hostW - w);
      tip.style.left = `${x + 14 + w > hostW ? Math.max(0, x - w - 14) : left}px`;
      tip.style.top = `${Math.max(0, y - 10)}px`;
    },
    hide() { tip.classList.remove('on'); },
  };
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Path for a rect with rounded top corners only (data end up, square at the baseline). */
function topRounded(x, y, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * 100% stacked columns of the estimated mood mix per week.
 * weeks: [{ asOf, counts: { positive, neutral, frustrated, upset, unknown } }]
 */
export function moodMixChart(host, weeks) {
  const width = Math.max(320, host.clientWidth);
  const m = { top: 10, right: 104, bottom: 30, left: 40 };
  const plotH = 220;
  const plotW = width - m.left - m.right;
  const band = plotW / weeks.length;
  const colW = Math.min(24, band * 0.6);
  const y = (share) => m.top + plotH - share * plotH;
  const known = (c) => c.positive + c.neutral + c.frustrated + c.upset;
  const every = weeks.length > 9 ? 2 : 1;

  const cols = weeks.map((w, i) => {
    const total = known(w.counts) || 1;
    const cx = m.left + band * i + band / 2;
    let acc = 0;
    const segs = MOODS.map((s, k) => {
      const share = w.counts[s.key] / total;
      const y1 = y(acc + share);
      const y0 = y(acc);
      acc += share;
      const h = Math.max(0, y0 - y1 - (k === MOODS.length - 1 ? 0 : 2));
      return { ...s, share, top: y1, h, isTop: k === MOODS.length - 1 };
    });
    return { w, i, cx, total, segs };
  });
  const last = cols[cols.length - 1];

  const svgMarkup = html`<svg viewBox="0 0 ${width} ${m.top + plotH + m.bottom}" role="img" aria-label="Estimated mood mix by week, share of customers with an estimate">
    <g class="grid">${[0, 0.25, 0.5, 0.75, 1].map((t) => html`<line x1="${m.left}" x2="${m.left + plotW}" y1="${y(t)}" y2="${y(t)}"></line>`)}</g>
    <g class="axis">${[0, 0.25, 0.5, 0.75, 1].map((t) => html`<text x="${m.left - 8}" y="${y(t) + 4}" text-anchor="end" class="tabular">${t * 100}%</text>`)}</g>
    ${cols.map((c) => html`<g class="col">
      <rect class="hover-band" x="${c.cx - band / 2 + 2}" y="${m.top}" width="${band - 4}" height="${plotH}" rx="6"></rect>
      ${c.segs.filter((s) => s.h > 0).map((s) => (s.isTop
        ? html`<path class="fill-${s.key}" d="${topRounded(c.cx - colW / 2, s.top, colW, s.h, 4)}"></path>`
        : html`<rect class="fill-${s.key}" x="${c.cx - colW / 2}" y="${s.top}" width="${colW}" height="${s.h}"></rect>`))}
      ${c.i % every === 0 || c.i === cols.length - 1 ? html`<text class="lbl" x="${c.cx}" y="${m.top + plotH + 18}" text-anchor="middle">${fmt.date(c.w.asOf)}</text>` : ''}
      <rect class="hit" data-col="${c.i}" tabindex="0" x="${c.cx - band / 2}" y="${m.top}" width="${band}" height="${plotH}"
        aria-label="${fmt.date(c.w.asOf)}: ${c.segs.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(', ')}"></rect>
    </g>`)}
    <line class="baseline" x1="${m.left}" x2="${m.left + plotW}" y1="${y(0)}" y2="${y(0)}"></line>
    ${last.segs.filter((s) => s.h >= 14).map((s) => html`<text class="lbl-ink" x="${last.cx + colW / 2 + 8}" y="${s.top + s.h / 2 + 4}">${s.label} <tspan class="lbl-strong">${Math.round(s.share * 100)}%</tspan></text>`)}
  </svg>`;

  render(host, html`<div class="legend" aria-hidden="true">${[...MOODS].reverse().map((s) => html`<span><i class="${s.key}"></i>${s.label}</span>`)}</div>${svgMarkup}`);
  host.style.position = 'relative';
  const tip = tooltip(host);
  const colorOf = (key) => cssVar(`--mood-${key}`);
  const show = (el, evt) => {
    const c = cols[Number(el.dataset.col)];
    const rect = host.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const x = evt?.clientX ? evt.clientX - rect.left : box.left - rect.left + box.width / 2;
    const yy = evt?.clientY ? evt.clientY - rect.top : box.top - rect.top + 20;
    tip.show(`Week to ${fmt.date(c.w.asOf)} · ${c.total} with an estimate`, [...c.segs].reverse().map((s) => ({
      value: `${Math.round(s.share * 100)}%`, label: `${s.label} (${c.w.counts[s.key]})`, color: colorOf(s.key),
    })).concat([{ value: String(c.w.counts.unknown), label: 'Unknown (not in chart)', color: '' }]), x, yy);
  };
  host.querySelectorAll('.hit').forEach((el) => {
    el.addEventListener('pointermove', (e) => show(el, e));
    el.addEventListener('pointerleave', () => tip.hide());
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', () => tip.hide());
  });
}

export function moodMixTable(weeks) {
  return html`<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Week to</th>${[...MOODS].reverse().map((s) => html`<th class="num">${s.label}</th>`)}<th class="num">Unknown</th><th class="num">Frustrated or upset</th></tr></thead>
    <tbody>${weeks.map((w) => html`<tr><td>${fmt.date(w.asOf)}</td>${[...MOODS].reverse().map((s) => html`<td class="num">${w.counts[s.key]}</td>`)}<td class="num">${w.counts.unknown}</td><td class="num">${w.negativeShare}%</td></tr>`)}</tbody>
  </table></div>`;
}

/**
 * Horizontal bars (HTML) — one series, value at the tip, optional note column.
 * rows: [{ label, value, valueText, note, noteClass, tip: [{label, value}] }]
 */
export function barList(host, rows, { fill = 'accent', ariaLabel = '' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  render(host, html`<div class="hbars" role="list" aria-label="${ariaLabel}">
    ${rows.map((r, i) => html`<div class="hbar-row" role="listitem" tabindex="0" data-row="${i}">
      <span class="hbar-label">${r.label}</span>
      <span class="hbar-track"><span class="hbar hbar-${fill}" style="width:calc((100% - 56px) * ${(r.value / max).toFixed(4)})"></span><span class="hbar-val">${r.valueText ?? r.value}</span></span>
      <span class="hbar-note ${r.noteClass || ''}">${r.note || ''}</span>
    </div>`)}
  </div>`);
  host.style.position = 'relative';
  const tip = tooltip(host);
  host.querySelectorAll('.hbar-row').forEach((el) => {
    const r = rows[Number(el.dataset.row)];
    const show = (e) => {
      const rect = host.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      tip.show(r.label, r.tip || [{ value: r.valueText ?? String(r.value), label: '' }],
        e?.clientX ? e.clientX - rect.left : box.width / 2, box.bottom - rect.top);
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', () => tip.hide());
    el.addEventListener('focus', () => show());
    el.addEventListener('blur', () => tip.hide());
  });
}

export const deltaNote = (change, { upIsBad = true } = {}) => {
  if (change === null || change === undefined) return { note: 'new', noteClass: '' };
  if (Math.abs(change) < 5) return { note: `±${Math.abs(Math.round(change))}%`, noteClass: '' };
  const up = change > 0;
  const bad = upIsBad ? up : !up;
  return { note: `${up ? '▲' : '▼'} ${Math.abs(Math.round(change))}%`, noteClass: bad ? 'bad' : 'good' };
};

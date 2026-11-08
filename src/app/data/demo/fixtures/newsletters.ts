/** Promotions: five newsletters with distinct looks, a few issues each, plus one-off promos. */
import { escapeHtml, formatLongDate, formatShortDate, svgDataUri } from '../util';
import { PROMOS, type Ctx, type MessageSpec, type Person, type ThreadSpec } from './model';
import { P } from './people';
import { button, preheader } from './templates';

const img = (svg: string, w: number, h: number, alt: string, style = '') =>
  `<img src="${svgDataUri(svg)}" width="${w}" height="${h}" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;${style}">`;

function listHeaders(domain: string, oneClick = true): MessageSpec['headers'] {
  return {
    listUnsubscribe: oneClick
      ? `<https://${domain}/unsubscribe?u=ar-7731>, <mailto:unsubscribe@${domain}?subject=unsubscribe>`
      : `<mailto:unsubscribe@${domain}?subject=unsubscribe>`,
    ...(oneClick ? { listUnsubscribePost: 'List-Unsubscribe=One-Click' } : {}),
    listId: `<news.${domain}>`,
  };
}

function footer(o: { name: string; domain: string; address: string; why: string; color?: string }): string {
  const c = o.color ?? '#8a8a8a';
  return `<tr><td style="padding:28px 32px 36px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${c};text-align:center">
${escapeHtml(o.why)}<br>
<a href="https://${o.domain}/preferences" style="color:${c}">Email preferences</a> &nbsp;·&nbsp; <a href="https://${o.domain}/unsubscribe?u=ar-7731" style="color:${c}">Unsubscribe</a> &nbsp;·&nbsp; <a href="https://${o.domain}/web" style="color:${c}">View in browser</a><br><br>
${escapeHtml(o.name)}, ${escapeHtml(o.address)}${o.why.includes('no tracking') ? '' : `<img src="https://${o.domain}/wf/open?u=ar-7731" width="1" height="1" alt="" style="display:block;border:0">`}</td></tr>`;
}

const page = (bg: string, inner: string, width: number, pre: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:${bg}">${preheader(pre)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg}"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${width}px">${inner}</table></td></tr></table></body></html>`;

// Margin Notes

interface MarginIssue {
  no: number;
  headline: string;
  intro: string;
  notes: { title: string; body: string; link: string }[];
  tool: { name: string; body: string };
  palette: [string, string, string];
}

function marginHero([a, b, c]: [string, string, string], no: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260"><rect width="600" height="260" fill="${a}"/><circle cx="470" cy="120" r="150" fill="${b}"/><rect x="60" y="150" width="220" height="220" rx="110" fill="${c}"/><rect x="300" y="40" width="12" height="180" fill="#1d1b16"/><text x="40" y="84" font-family="Georgia,serif" font-size="64" font-style="italic" fill="#1d1b16">No. ${no}</text></svg>`;
}

function marginNotes(i: MarginIssue, date: number): string {
  const ink = '#1d1b16';
  const inner = `
<tr><td style="padding:12px 4px;font-family:Georgia,serif;font-size:13px;color:#6f6656;text-align:center;letter-spacing:2px;text-transform:uppercase">Margin Notes · Issue ${i.no} · ${formatLongDate(date)}</td></tr>
<tr><td style="background:#fffdf7;border-radius:4px 4px 0 0;overflow:hidden">${img(marginHero(i.palette, i.no), 600, 260, `Margin Notes issue ${i.no}`)}</td></tr>
<tr><td style="background:#fffdf7;padding:32px 40px 8px;font-family:Georgia,serif;font-size:34px;line-height:40px;color:${ink}">${escapeHtml(i.headline)}</td></tr>
<tr><td style="background:#fffdf7;padding:8px 40px 24px;font-family:Georgia,serif;font-size:17px;line-height:28px;color:#3b362c">${i.intro}</td></tr>
${i.notes
  .map(
    (n, k) => `<tr><td style="background:#fffdf7;padding:0 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6dfcf"><tr>
<td width="48" valign="top" style="padding:20px 0;font-family:Georgia,serif;font-size:28px;color:#b0a58f">${k + 1}</td>
<td style="padding:20px 0"><a href="${n.link}" style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${ink};text-decoration:none">${escapeHtml(n.title)}</a>
<div style="font-family:Georgia,serif;font-size:16px;line-height:25px;color:#4a4437;padding-top:6px">${n.body}</div></td></tr></table></td></tr>`,
  )
  .join('')}
<tr><td style="background:#fffdf7;padding:16px 40px 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ecdc;border-radius:4px"><tr><td style="padding:20px 24px;font-family:Helvetica,Arial,sans-serif">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8a7f69">Tool of the week</div>
<div style="font-size:18px;font-weight:700;color:${ink};padding:6px 0">${escapeHtml(i.tool.name)}</div>
<div style="font-family:Georgia,serif;font-size:15px;line-height:23px;color:#4a4437">${i.tool.body}</div></td></tr></table></td></tr>
<tr><td style="background:#fffdf7;padding:0 40px 32px;font-family:Georgia,serif;font-size:16px;color:#3b362c">Until next Sunday,<br><i>Wren</i></td></tr>
${footer({ name: 'Margin Notes', domain: 'marginnotes.example', address: 'PO Box 112, Hudson, NY', why: 'You subscribed to Margin Notes, a Sunday letter about design and the people who do it.' })}`;
  return page('#f1ebdd', inner, 600, `${i.headline}. ${i.intro}`);
}

// Stride & Co.

interface StrideIssue {
  kicker: string;
  headline: string;
  sub: string;
  products: { name: string; detail: string; price: number; was?: number; colors: [string, string] }[];
  code?: string;
  hero: [string, string];
}

function shoe([body, sole]: [string, string]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="180" viewBox="0 0 260 180"><rect width="260" height="180" fill="#f2f2ef"/><ellipse cx="130" cy="150" rx="100" ry="8" fill="#dcdcd6"/><path d="M40 128c0-30 18-58 46-66l30-6c10 18 30 28 52 30 22 2 42 10 50 26 4 8 2 16-6 16H48c-5 0-8-0-8 0z" fill="${body}"/><path d="M36 128h190c6 0 10 6 8 12l-2 4H40c-4 0-6-4-6-8z" fill="${sole}"/><path d="M92 74l10 26M106 70l10 24M120 68l10 22" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/></svg>`;
}

function stride(i: StrideIssue): string {
  const [h1, h2] = i.hero;
  const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${h1}"/><stop offset="1" stop-color="${h2}"/></linearGradient></defs><rect width="600" height="300" fill="url(#g)"/><path d="M0 230 C150 180 300 280 600 200 L600 300 L0 300z" fill="#000" opacity=".18"/><path d="M-20 260 C180 210 360 300 620 230" stroke="#fff" stroke-width="3" fill="none" opacity=".6" stroke-dasharray="14 10"/></svg>`;
  const cards = i.products
    .map(
      (p) => `<td width="50%" valign="top" style="padding:8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td>${img(shoe(p.colors), 260, 180, p.name)}</td></tr>
<tr><td style="padding:14px 16px 4px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#111">${escapeHtml(p.name)}</td></tr>
<tr><td style="padding:0 16px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#666">${escapeHtml(p.detail)}</td></tr>
<tr><td style="padding:8px 16px 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#111">$${p.price}${p.was ? ` <span style="color:#999;text-decoration:line-through;font-weight:400;font-size:14px">$${p.was}</span>` : ''}</td></tr>
</table></td>`,
    )
    .reduce<string[]>((rows, cell, k) => {
      if (k % 2 === 0) rows.push(cell);
      else rows[rows.length - 1] += cell;
      return rows;
    }, [])
    .map((r) => `<tr>${r}</tr>`)
    .join('');
  const inner = `
<tr><td style="padding:16px 8px;font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#111">STRIDE<span style="color:${h1}">&amp;</span>CO.</td></tr>
<tr><td style="border-radius:20px;overflow:hidden;background:${h1}">${img(hero, 600, 300, i.headline)}</td></tr>
<tr><td style="padding:28px 8px 4px;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${h2}">${escapeHtml(i.kicker)}</td></tr>
<tr><td style="padding:0 8px;font-family:Helvetica,Arial,sans-serif;font-size:40px;line-height:44px;font-weight:900;letter-spacing:-1px;color:#111">${escapeHtml(i.headline)}</td></tr>
<tr><td style="padding:12px 8px 20px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#444">${i.sub}</td></tr>
${i.code ? `<tr><td style="padding:0 8px 20px"><table role="presentation" cellpadding="0" cellspacing="0" style="border:2px dashed #111;border-radius:12px"><tr><td style="padding:12px 20px;font-family:Menlo,monospace;font-size:18px;font-weight:700;letter-spacing:3px">${escapeHtml(i.code)}</td></tr></table></td></tr>` : ''}
<tr><td style="padding:0 8px 24px">${button('Shop the drop', 'https://strideandco.example/new', '#111111')}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table></td></tr>
<tr><td style="padding:24px 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#444;text-align:center">Free gait analysis in store, every Saturday. Free returns on unworn shoes for 60 days.</td></tr>
${footer({ name: 'Stride & Co. Running', domain: 'strideandco.example', address: '1480 College Ave, Berkeley, CA', why: 'You’re getting this because you bought shoes from us and said yes to emails.' })}`;
  return page('#f2f2ef', inner, 600, `${i.headline} ${i.sub}`.replace(/<[^>]+>/g, ''));
}

// Low Tide Coffee

interface CoffeeIssue {
  month: string;
  roast: string;
  origin: string;
  producer: string;
  process: string;
  altitude: string;
  notes: string[];
  story: string;
  bag: string;
}

function coffeeBag(color: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320" viewBox="0 0 560 320"><rect width="560" height="320" fill="#efe4d6"/><circle cx="430" cy="90" r="46" fill="#e9b872"/><path d="M0 250 C120 220 220 270 340 240 S500 210 560 230 L560 320 L0 320z" fill="#cfb79a"/><path d="M200 70h160l14 30v190H186V100z" fill="${color}"/><path d="M200 70h160l-6 18H206z" fill="#000" opacity=".2"/><rect x="214" y="150" width="132" height="86" rx="6" fill="#f8f1e6"/><text x="280" y="186" font-family="Georgia,serif" font-size="17" text-anchor="middle" fill="#3b2a1e">${escapeHtml(label)}</text><text x="280" y="210" font-family="Helvetica,Arial,sans-serif" font-size="10" letter-spacing="2" text-anchor="middle" fill="#7a6250">LOW TIDE</text><circle cx="110" cy="270" r="9" fill="#5b3a24"/><circle cx="132" cy="282" r="8" fill="#6b4630"/><circle cx="460" cy="276" r="9" fill="#5b3a24"/></svg>`;
}

function lowTide(i: CoffeeIssue): string {
  const inner = `
<tr><td style="padding:20px 24px 12px;font-family:Georgia,serif;font-size:26px;color:#3b2a1e;text-align:center">Low Tide <span style="font-style:italic">Coffee</span></td></tr>
<tr><td style="background:#fffaf2;border-radius:24px 24px 0 0;overflow:hidden">${img(coffeeBag(i.bag, i.roast), 560, 320, `${i.roast} coffee bag`)}</td></tr>
<tr><td style="background:#fffaf2;padding:28px 36px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#a0623a">${escapeHtml(i.month)} roast</td></tr>
<tr><td style="background:#fffaf2;padding:6px 36px 12px;font-family:Georgia,serif;font-size:36px;line-height:42px;color:#3b2a1e">${escapeHtml(i.roast)}</td></tr>
<tr><td style="background:#fffaf2;padding:0 36px 16px">${i.notes
    .map(
      (n) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border-radius:100px;background:#f3e3cf;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#5b3a24">${escapeHtml(n)}</span>`,
    )
    .join('')}</td></tr>
<tr><td style="background:#fffaf2;padding:0 36px 20px;font-family:Georgia,serif;font-size:16px;line-height:26px;color:#4a3a2e">${i.story}</td></tr>
<tr><td style="background:#fffaf2;padding:0 36px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #ead9c4;border-bottom:1px solid #ead9c4;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#5b4a3c">
<tr><td style="padding:10px 0;width:40%;color:#9a826c">Origin</td><td style="padding:10px 0">${escapeHtml(i.origin)}</td></tr>
<tr><td style="padding:10px 0;color:#9a826c;border-top:1px solid #f3e7d7">Producer</td><td style="padding:10px 0;border-top:1px solid #f3e7d7">${escapeHtml(i.producer)}</td></tr>
<tr><td style="padding:10px 0;color:#9a826c;border-top:1px solid #f3e7d7">Process</td><td style="padding:10px 0;border-top:1px solid #f3e7d7">${escapeHtml(i.process)}</td></tr>
<tr><td style="padding:10px 0;color:#9a826c;border-top:1px solid #f3e7d7">Altitude</td><td style="padding:10px 0;border-top:1px solid #f3e7d7">${escapeHtml(i.altitude)}</td></tr></table></td></tr>
<tr><td style="background:#fffaf2;padding:0 36px 32px;border-radius:0 0 24px 24px">${button('Add to my next box', 'https://lowtidecoffee.example/box', '#3b2a1e')}<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8a7461;padding-top:12px">Your next subscription box ships on the 1st. Skip or swap anytime.</div></td></tr>
${footer({ name: 'Low Tide Coffee Roasters', domain: 'lowtidecoffee.example', address: '22 Wharf St, Santa Cruz, CA', why: 'You’re a Low Tide subscriber. We send one letter a month, with the new roast.', color: '#9a826c' })}`;
  return page('#efe4d6', inner, 560, `${i.notes.join(', ')}. ${i.story}`);
}

// Farewise

interface DealsIssue {
  headline: string;
  sub: string;
  deals: { city: string; country: string; when: string; price: number; was: number; tint: string }[];
}

function skyline(tint: string, seed: number): string {
  const blocks = Array.from({ length: 9 }, (_, k) => {
    const h = 30 + ((seed * (k + 3) * 37) % 70);
    return `<rect x="${k * 22}" y="${120 - h}" width="18" height="${h}" fill="#0b2545" opacity="${0.55 + (k % 3) * 0.12}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect width="200" height="120" fill="${tint}"/><circle cx="150" cy="40" r="20" fill="#fff6d5"/>${blocks}</svg>`;
}

function farewise(i: DealsIssue): string {
  const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e5ba8"/><stop offset="1" stop-color="#7cc4f2"/></linearGradient></defs><rect width="600" height="200" fill="url(#s)"/><path d="M60 140 Q300 20 540 120" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-dasharray="6 8"/><path d="M528 110l20 8-18 12z" fill="#ffffff"/><circle cx="60" cy="140" r="7" fill="#ffd166"/></svg>`;
  const rows = i.deals
    .map(
      (d, k) => `<tr><td style="padding:8px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden"><tr>
<td width="160" style="width:160px">${img(skyline(d.tint, k + 2), 200, 120, d.city, 'max-width:160px')}</td>
<td style="padding:12px 16px;font-family:Helvetica,Arial,sans-serif"><div style="font-size:18px;font-weight:700;color:#0b2545">${escapeHtml(d.city)}</div><div style="font-size:13px;color:#5a6b7d;padding:2px 0 8px">${escapeHtml(d.country)} · ${escapeHtml(d.when)}</div><div style="font-size:13px;color:#5a6b7d">Round trip from SFO</div></td>
<td align="right" style="padding:12px 16px;font-family:Helvetica,Arial,sans-serif;white-space:nowrap"><div style="font-size:24px;font-weight:800;color:#0a7c4a">$${d.price}</div><div style="font-size:12px;color:#8a99a8;text-decoration:line-through">usually $${d.was}</div></td>
</tr></table></td></tr>`,
    )
    .join('');
  const inner = `
<tr><td style="padding:8px 4px 16px;font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:#1e5ba8">farewise<span style="color:#ffb703">.</span></td></tr>
<tr><td style="border-radius:16px;overflow:hidden">${img(hero, 600, 200, 'Flight path')}</td></tr>
<tr><td style="padding:24px 4px 4px;font-family:Helvetica,Arial,sans-serif;font-size:28px;line-height:34px;font-weight:800;color:#0b2545">${escapeHtml(i.headline)}</td></tr>
<tr><td style="padding:4px 4px 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#46586b">${i.sub}</td></tr>
${rows}
<tr><td style="padding:16px 4px">${button('See all deals from SFO', 'https://farewise.example/deals/sfo', '#1e5ba8')}</td></tr>
<tr><td style="padding:0 4px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#7a8a99">Prices were found in the last 24 hours and change fast. Farewise doesn’t sell tickets, we find them.</td></tr>
${footer({ name: 'Farewise', domain: 'farewise.example', address: '77 Gate St, Denver, CO', why: 'You’re getting deals from San Francisco (SFO) because you set up a Farewise alert.' })}`;
  return page('#eaf2fb', inner, 600, `${i.sub} ${i.deals.map((d) => `${d.city} $${d.price}`).join(', ')}.`);
}

// Patch Notes

interface PatchIssue {
  no: number;
  lede: string;
  items: { title: string; source: string; blurb: string }[];
  quick: string[];
  sponsor: { name: string; body: string };
}

function patchNotes(i: PatchIssue, date: number): string {
  const mono = 'Menlo,Consolas,monospace';
  const inner = `
<tr><td style="padding:24px 28px 8px;background:#0d1117;border-radius:12px 12px 0 0;font-family:${mono};font-size:13px;color:#7ee787">$ patch-notes --issue ${i.no} --date ${formatShortDate(date).toLowerCase().replace(' ', '-')}</td></tr>
<tr><td style="padding:0 28px 24px;background:#0d1117;font-family:Helvetica,Arial,sans-serif;font-size:30px;font-weight:800;color:#f0f6fc">Patch Notes Weekly</td></tr>
<tr><td style="padding:24px 28px 8px;background:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:25px;color:#24292f">${i.lede}</td></tr>
${i.items
  .map(
    (it, k) => `<tr><td style="padding:16px 28px;background:#ffffff;border-top:1px solid #eaeef2"><div style="font-family:${mono};font-size:12px;color:#8250df">${String(k + 1).padStart(2, '0')} / ${escapeHtml(it.source)}</div>
<a href="https://patchnotes.example/r/${i.no}-${k + 1}" style="display:block;padding:4px 0;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#0969da;text-decoration:none">${escapeHtml(it.title)}</a>
<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#424a53">${it.blurb}</div></td></tr>`,
  )
  .join('')}
<tr><td style="padding:16px 28px;background:#f6f8fa;border-top:1px solid #eaeef2;font-family:Helvetica,Arial,sans-serif"><div style="font-family:${mono};font-size:12px;color:#57606a;padding-bottom:8px">// quick links</div>${i.quick
    .map((q) => `<div style="font-size:14px;line-height:22px;color:#24292f">→ ${escapeHtml(q)}</div>`)
    .join('')}</td></tr>
<tr><td style="padding:16px 28px 24px;background:#ffffff;border-top:1px solid #eaeef2;border-radius:0 0 12px 12px;font-family:Helvetica,Arial,sans-serif"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8c959f">Sponsor</div><div style="font-size:15px;line-height:23px;color:#424a53;padding-top:4px"><b>${escapeHtml(i.sponsor.name)}</b> ${i.sponsor.body}</div></td></tr>
${footer({ name: 'Patch Notes Weekly', domain: 'patchnotes.example', address: '1 Commit Ct, Portland, OR', why: 'You signed up for Patch Notes Weekly. One email, every Friday, no tracking pixels.' })}`;
  return page('#eaeef2', inner, 600, i.lede);
}

function promo(id: string, subject: string, from: Person, at: number, html: string, domain: string, extra: Partial<ThreadSpec> = {}, oneClick = true): ThreadSpec {
  return { id, subject, labels: [...PROMOS], messages: [{ from, at, html, headers: listHeaders(domain, oneClick) }], ...extra };
}

export function promoThreads(c: Ctx): ThreadSpec[] {
  const sun = (weeksAgo: number) => {
    const d = new Date(c.now);
    const back = d.getDay() + weeksAgo * 7;
    return c.d(back, '07:00');
  };
  const fri = (weeksAgo: number) => {
    const d = new Date(c.now);
    const back = ((d.getDay() - 5 + 7) % 7) + weeksAgo * 7;
    return c.d(back, '06:30');
  };

  const margin: MarginIssue[] = [
    {
      no: 142,
      headline: 'The quiet power of the second draft',
      intro: 'This week I’ve been thinking about how much good design happens after the presentation, when nobody is watching and you finally get to fix the thing that bugged you. Three links, one tool, and a small confession about kerning.',
      notes: [
        { title: 'Why the best interfaces feel slower', body: 'A thoughtful essay about friction that earns its place. The section on confirmation dialogs is worth the whole read.', link: 'https://marginnotes.example/l/142-1' },
        { title: 'A field guide to empty states', body: '47 empty states from real products, sorted by what they ask you to do next. Bookmark it.', link: 'https://marginnotes.example/l/142-2' },
        { title: 'Type specimens from a 1960s print shop', body: 'Someone scanned an entire drawer of wood type. The ampersands alone.', link: 'https://marginnotes.example/l/142-3' },
      ],
      tool: { name: 'Contrast Kit', body: 'Paste two colors, get every WCAG ratio plus a preview at three text sizes. Free, and it doesn’t want your email.' },
      palette: ['#f6d7b0', '#e86a33', '#2f5d50'],
    },
    {
      no: 141,
      headline: 'Designing for the tired version of your user',
      intro: 'We design for people at their best: rested, focused, curious. But most people meet our work at 11pm with one eye open. This week is about that person.',
      notes: [
        { title: 'Night mode is not dark mode', body: 'A short piece on why reducing brightness and reducing decisions are different jobs.', link: 'https://marginnotes.example/l/141-1' },
        { title: 'The undo button is a design system', body: 'Every destructive action needs a way back. A good argument for building undo first.', link: 'https://marginnotes.example/l/141-2' },
        { title: 'Small type, big feelings', body: 'How three newspapers redesigned their captions, with before and after.', link: 'https://marginnotes.example/l/141-3' },
      ],
      tool: { name: 'Pocket Grid', body: 'A tiny overlay that draws your layout grid on top of any screen. I use it every day.' },
      palette: ['#d9e4f5', '#5b7fd1', '#f2b84b'],
    },
    {
      no: 140,
      headline: 'On naming things',
      intro: 'Product names, button labels, file names, layer names. This issue is about the words that hold our work together, and why "Final_v7_REAL" is a cry for help.',
      notes: [
        { title: 'The verbs in your interface', body: 'Pick one verb per action and never let it drift. A checklist you can run in an afternoon.', link: 'https://marginnotes.example/l/140-1' },
        { title: 'What a good settings page reads like', body: 'Five settings pages read aloud. The good ones sound like a person.', link: 'https://marginnotes.example/l/140-2' },
        { title: 'A museum of retired product names', body: 'Funny, then a little sad, then useful.', link: 'https://marginnotes.example/l/140-3' },
      ],
      tool: { name: 'Layer Tidy', body: 'Renames messy layers in bulk using rules you write once. Your future self says thanks.' },
      palette: ['#e7f0d8', '#6a994e', '#bc4749'],
    },
  ];

  const strides: StrideIssue[] = [
    {
      kicker: 'Just landed',
      headline: 'The Tempo 4 is here.',
      sub: 'Lighter foam, a wider toe box, and the same snappy ride you liked in the 3. Come try a pair on our treadmill, we won’t judge your form.',
      products: [
        { name: 'Tempo 4', detail: 'Daily trainer · 8.1 oz', price: 145, colors: ['#ff5a36', '#1f1f1f'] },
        { name: 'Tempo 4 Trail', detail: 'Grippy, rock plate · 9.4 oz', price: 160, colors: ['#3a6b35', '#d9c9a3'] },
        { name: 'Glide Racer', detail: 'Race day · 6.9 oz', price: 210, colors: ['#2b59c3', '#f2f2f2'] },
        { name: 'Recovery Slide', detail: 'For after the long one', price: 55, colors: ['#8e7dbe', '#eeeeee'] },
      ],
      hero: ['#ff5a36', '#7a1f0e'],
    },
    {
      kicker: 'Members only',
      headline: '20% off everything for the long run.',
      sub: 'Marathon season is almost here. Use your member code at checkout or show this email in store. Ends Sunday at midnight.',
      products: [
        { name: 'Cloudline 2', detail: 'Max cushion · 9.8 oz', price: 136, was: 170, colors: ['#e9e4d8', '#3d3d3d'] },
        { name: 'Pace Short 5"', detail: 'With phone pocket', price: 44, was: 55, colors: ['#1f1f1f', '#ff5a36'] },
        { name: 'Merino Crew', detail: 'Three pack', price: 32, was: 40, colors: ['#b56576', '#f1f1f1'] },
        { name: 'Night Vest', detail: 'Reflective, adjustable', price: 36, was: 45, colors: ['#d9ed92', '#2d2d2d'] },
      ],
      code: 'LONGRUN20',
      hero: ['#2b59c3', '#0b1f4d'],
    },
    {
      kicker: 'Run club',
      headline: 'Saturday 8am. 5K, all paces.',
      sub: 'We meet outside the shop, run the lake loop, and finish with free coffee from our friends at Low Tide. Nobody gets left behind, we have a sweeper.',
      products: [
        { name: 'Club Tee', detail: 'Recycled, very soft', price: 28, colors: ['#ffb703', '#023047'] },
        { name: 'Tempo 3', detail: 'Last season, last sizes', price: 99, was: 135, colors: ['#219ebc', '#ffffff'] },
      ],
      hero: ['#ffb703', '#fb5607'],
    },
  ];

  const coffees: CoffeeIssue[] = [
    {
      month: 'October',
      roast: 'Huila Sunrise',
      origin: 'Huila, Colombia',
      producer: 'Luz Marina Trujillo',
      process: 'Washed',
      altitude: '1,750 m',
      notes: ['Red apple', 'Panela', 'Orange zest'],
      story: 'Luz Marina has farmed the same hillside for 31 years. This lot was picked in three passes so only the ripest cherries went in, and you can taste it: bright and sweet, like the first cold morning of fall.',
      bag: '#c8553d',
    },
    {
      month: 'September',
      roast: 'Kochere Blue',
      origin: 'Yirgacheffe, Ethiopia',
      producer: 'Kochere washing station',
      process: 'Natural',
      altitude: '1,900 m',
      notes: ['Blueberry', 'Jasmine', 'Dark chocolate'],
      story: 'Dried on raised beds for 21 days, turned by hand every few hours. It’s the kind of coffee that makes people say "wait, what is that?" on the first sip.',
      bag: '#3d5a80',
    },
    {
      month: 'August',
      roast: 'Finca Esperanza',
      origin: 'Huehuetenango, Guatemala',
      producer: 'The Morales family',
      process: 'Honey',
      altitude: '1,600 m',
      notes: ['Milk chocolate', 'Toasted almond', 'Plum'],
      story: 'Our most requested coffee is back. Three generations of the Morales family work this farm together, and their grandmother still does the final sort by hand.',
      bag: '#6a994e',
    },
  ];

  const deals: DealsIssue[] = [
    {
      headline: 'Lisbon for $412 round trip',
      sub: 'Fares to Europe dropped overnight. Here are the best ones from SFO for late fall and early winter.',
      deals: [
        { city: 'Lisbon', country: 'Portugal', when: 'Nov to Feb', price: 412, was: 890, tint: '#ffd6a5' },
        { city: 'Mexico City', country: 'Mexico', when: 'Nov to Mar', price: 198, was: 420, tint: '#caffbf' },
        { city: 'Tokyo', country: 'Japan', when: 'Jan to Mar', price: 568, was: 1150, tint: '#ffc6ff' },
        { city: 'Reykjavík', country: 'Iceland', when: 'Dec to Feb', price: 389, was: 760, tint: '#bde0fe' },
      ],
    },
    {
      headline: 'Weekend escapes under $150',
      sub: 'Short hops for a long weekend. Pack a bag, leave Friday after work.',
      deals: [
        { city: 'Portland', country: 'Oregon', when: 'Weekends in Nov', price: 118, was: 240, tint: '#d8f3dc' },
        { city: 'San Diego', country: 'California', when: 'Through Dec', price: 89, was: 190, tint: '#fde2e4' },
        { city: 'Tucson', country: 'Arizona', when: 'Through Feb', price: 146, was: 300, tint: '#ffe5b4' },
      ],
    },
    {
      headline: 'Mistake fare? Tokyo for $498',
      sub: 'This looks like a pricing error and it might not last the day. Book refundable if you can.',
      deals: [
        { city: 'Tokyo', country: 'Japan', when: 'Feb to Apr', price: 498, was: 1210, tint: '#ffc6ff' },
        { city: 'Seoul', country: 'South Korea', when: 'Feb to Apr', price: 541, was: 1090, tint: '#e2ece9' },
      ],
    },
  ];

  const patches: PatchIssue[] = [
    {
      no: 218,
      lede: 'Good morning. This week: a browser engine finally ships container queries for everything, a long read on why dates are hard, and a delightful tiny database.',
      items: [
        { title: 'Container style queries are everywhere now', source: 'web platform', blurb: 'All three major engines support them. Time to delete a few hundred lines of resize observers.' },
        { title: 'Falsehoods designers believe about dates', source: 'essay', blurb: 'Time zones, calendars, and the person whose birthday is February 29th. Useful for anyone who has ever drawn a date picker.' },
        { title: 'A 600 line database you can actually read', source: 'open source', blurb: 'Written as a teaching project, now quietly used in production by several small teams.' },
        { title: 'The cost of a loading spinner', source: 'research', blurb: 'People rated identical waits as 30% longer with a spinner than with a progress bar that moves.' },
      ],
      quick: ['A color picker that works with a screen reader', 'The 2026 state of web fonts survey results', 'How one team cut their CSS by 70% with cascade layers'],
      sponsor: { name: 'Shipyard CI.', body: 'Fast builds for small teams. Your first 2,000 minutes a month are free.' },
    },
    {
      no: 217,
      lede: 'A quieter week. Two good postmortems, a debate about tabs, and the return of a classic.',
      items: [
        { title: 'Postmortem: the day our search index ate itself', source: 'engineering blog', blurb: 'Honest, specific, and kind. This is how to write one.' },
        { title: 'Tabs vs. sidebar, a settings page story', source: 'design', blurb: 'One team’s journey from 6 tabs to 14 sections, and what they learned about search.' },
        { title: 'Keyboard shortcuts nobody uses (and the ones everybody does)', source: 'data', blurb: 'Usage data from a large email client. Archive is king.' },
      ],
      quick: ['Variable fonts: a practical primer', 'A tiny library for relative dates in 40 languages', 'Interview: the person who maintains your favorite CLI'],
      sponsor: { name: 'Quietlog.', body: 'Error tracking that doesn’t wake you up for things that don’t matter.' },
    },
    {
      no: 216,
      lede: 'Hello from a very rainy Portland. This issue is mostly about accessibility, because three great things came out at once.',
      items: [
        { title: 'Focus rings are a feature', source: 'accessibility', blurb: 'A visual guide to focus styles that look good and pass contrast in both themes.' },
        { title: 'What screen reader users wish you knew about live regions', source: 'interviews', blurb: 'Eight people, eight setups, a lot of practical advice.' },
        { title: 'Reduced motion without reduced joy', source: 'design', blurb: 'Swap movement for fades and color, not for nothing.' },
      ],
      quick: ['The accessibility tree, explained with cats', 'Forced colors mode in 10 minutes', 'Free audit checklist (no signup)'],
      sponsor: { name: 'Lumen Fonts.', body: 'Open licensed typefaces for interfaces, hinted for small sizes.' },
    },
  ];

  const out: ThreadSpec[] = [];
  margin.forEach((m, k) => {
    const at = sun(k);
    out.push(promo(`p-margin-${m.no}`, `Margin Notes No. ${m.no}: ${m.headline}`, P.margin, at, marginNotes(m, at), 'marginnotes.example', k === 0 ? { unread: true } : {}));
  });
  strides.forEach((s, k) => {
    out.push(promo(`p-stride-${k + 1}`, [`${s.headline} 👟`, `Members only: 20% off ends Sunday`, `Run club this Saturday ☀️`][k]!, P.stride, c.d(2 + k * 9, '10:00'), stride(s), 'strideandco.example', k === 1 ? { unread: true } : {}));
  });
  coffees.forEach((cf, k) => {
    out.push(promo(`p-lowtide-${k + 1}`, `${cf.month}’s roast: ${cf.roast} ☕`, P.lowtide, c.d(4 + k * 30, '08:00'), lowTide(cf), 'lowtidecoffee.example'));
  });
  deals.forEach((d, k) => {
    // Farewise only offers a web unsubscribe link, no one-click and no mailto.
    const t = promo(`p-farewise-${k + 1}`, `✈️ ${d.headline}`, P.farewise, c.d(1 + k * 6, '15:30'), farewise(d), 'farewise.example', k === 0 ? { unread: true } : {});
    t.messages[0]!.headers = { listUnsubscribe: '<https://farewise.example/alerts/stop?u=ar-7731>', listId: '<deals.farewise.example>' };
    out.push(t);
  });
  patches.forEach((pn, k) => {
    const at = fri(k);
    out.push(promo(`p-patch-${pn.no}`, `Patch Notes #${pn.no}: ${pn.items[0]!.title.toLowerCase()}`, P.patchnotes, at, patchNotes(pn, at), 'patchnotes.example', {}, false));
  });

  // Promotions over a year old, long archived: what Storage offers to clear out.
  const oldPromo = (id: string, subject: string, from: Person, daysAgo: number, bg: string, headline: string, body: string, domain: string, name: string) =>
    promo(
      id,
      subject,
      from,
      c.d(daysAgo, '09:00'),
      page(
        bg,
        `<tr><td style="padding:28px;background:#ffffff;border-radius:16px;font-family:Helvetica,Arial,sans-serif"><div style="font-size:26px;font-weight:800;color:#1f1f1f;padding-bottom:8px">${headline}</div><div style="font-size:15px;line-height:23px;color:#444444">${body}</div></td></tr>${footer({ name, domain, address: '210 Grain St, Grand Rapids, MI', why: `You’re getting this because you signed up for ${name} emails.` })}`,
        600,
        body,
      ),
      domain,
      { labels: ['CATEGORY_PROMOTIONS'] },
    );
  out.push(
    oldPromo('x-arch-promo-lowtide', 'Last call for the holiday blend ☕', P.lowtide, 420, '#f3ede4', 'The holiday blend is almost gone.', 'Two days left to grab a bag of our spiced winter roast before it’s back in the vault.', 'lowtidecoffee.example', 'Low Tide Coffee'),
    oldPromo('x-arch-promo-oakline', 'Spring refresh: 20% off outdoor lighting', P.oakline, 510, '#f4efe8', 'Brighter evenings start here.', 'String lights, lanterns and solar path lights, 20% off through Sunday.', 'oaklinehome.example', 'Oakline Home'),
    oldPromo('x-arch-promo-stride', 'Your running year in review 🏃', P.stride, 600, '#f2f2f2', 'Your year in miles.', 'You ran 412 miles this year. Here’s to the next 500.', 'strideandco.example', 'Stride & Co.'),
  );

  out.push(
    promo(
      'p-oakline-sale',
      'Our fall sale starts now: up to 30% off lighting',
      P.oakline,
      c.d(3, '09:00'),
      page(
        '#f4efe8',
        `<tr><td style="padding:28px;background:#2f2a24;border-radius:16px;font-family:Georgia,serif;color:#f4efe8;text-align:center"><div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:.7">Oakline Home</div><div style="font-size:40px;line-height:46px;padding:16px 0">Long evenings,<br>warm light.</div><div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;opacity:.85;padding-bottom:20px">Up to 30% off lamps, pendants and candles through Monday.</div><table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td style="border-radius:100px;background:#f4efe8"><a href="https://oaklinehome.example/sale" style="display:inline-block;padding:12px 26px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#2f2a24;text-decoration:none">Shop lighting</a></td></tr></table></td></tr>${footer({ name: 'Oakline Home', domain: 'oaklinehome.example', address: '210 Grain St, Grand Rapids, MI', why: 'You’re getting this because you shopped with Oakline Home.' })}`,
        600,
        'Up to 30% off lamps, pendants and candles through Monday. Long evenings, warm light.',
      ),
      'oaklinehome.example',
    ),
    promo(
      'p-reelhouse-new',
      'New this week on Reelhouse 🍿',
      P.reelhouse,
      c.d(5, '17:00'),
      page(
        '#141414',
        `<tr><td style="padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff"><div style="font-size:24px;font-weight:800;color:#e50914">REELHOUSE</div><div style="font-size:28px;font-weight:700;padding:16px 0 8px">Your Friday night, sorted.</div><div style="font-size:15px;color:#bbbbbb;line-height:22px">A slow-burn lighthouse mystery, a documentary about competitive bread baking, and the final season of the show you keep saying you’ll finish.</div></td></tr><tr><td style="padding:0 24px 24px">${button('Start watching', 'https://reelhouse.example/new', '#e50914')}</td></tr>${footer({ name: 'Reelhouse', domain: 'reelhouse.example', address: '12 Cinema Ct, Burbank, CA', why: 'You’re a Reelhouse member.', color: '#777777' })}`,
        600,
        'A lighthouse mystery, competitive bread baking, and the final season you keep meaning to finish.',
      ),
      'reelhouse.example',
    ),
    promo(
      'p-gatherly',
      'Design meetups near you this month',
      P.meetups,
      c.d(8, '12:00'),
      page(
        '#f5f3ff',
        `<tr><td style="padding:28px;background:#ffffff;border-radius:16px;font-family:Helvetica,Arial,sans-serif"><div style="font-size:22px;font-weight:800;color:#4c1d95">gatherly</div><div style="font-size:22px;font-weight:700;color:#1f1f1f;padding:16px 0 8px">3 events you might like</div><div style="font-size:15px;line-height:26px;color:#3c3c3c">• Figure drawing for designers, Thursday 7pm<br>• Accessibility night: live audits, Tuesday 6:30pm<br>• Type and coffee walk, Saturday 10am</div><div style="padding-top:20px">${button('See events', 'https://gatherly.example/oakland/design', '#6d28d9')}</div></td></tr>${footer({ name: 'Gatherly', domain: 'gatherly.example', address: '5 Commons Sq, Chicago, IL', why: 'You follow Design in Oakland on Gatherly.' })}`,
        600,
        'Figure drawing, an accessibility night, and a type walk. 3 events you might like.',
      ),
      'gatherly.example',
    ),
  );
  return out;
}

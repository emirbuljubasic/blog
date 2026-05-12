#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const hljs = require('highlight.js');

const SITE = 'https://blog.ljebu.com';
const root = __dirname;
const out = path.join(root, 'dist');

const HLJS_DARK = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark-dimmed.min.css';
const HLJS_LIGHT = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';

let tocHeadings = [];
const slugCounts = {};

function slugify(text) {
  const base = text.toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim().replace(/\s+/g, '-');
  const n = slugCounts[base] || 0;
  slugCounts[base] = n + 1;
  return n ? base + '-' + n : base;
}

function resetMarkdownState() {
  tocHeadings = [];
  for (const k in slugCounts) delete slugCounts[k];
}

marked.use({
  renderer: {
    blockquote(quote) {
      const m = quote.match(/^\s*<p>\[!(INFO|WARNING|CRITICAL|NOTE|TIP)\]([^]*?)<\/p>/i);
      if (!m) return false;
      const type = m[1].toLowerCase();
      const firstLine = m[2].trim();
      const rest = quote.slice(m[0].length);
      const body = (firstLine ? '<p>' + firstLine + '</p>' : '') + rest;
      return '<aside class="callout callout-' + type + '">'
        + '<div class="callout-title">' + type + '</div>'
        + '<div class="callout-body">' + body + '</div></aside>';
    },
    heading(text, level) {
      if (level === 2 || level === 3) {
        const id = slugify(text);
        tocHeadings.push({ level, text, id });
        return '<h' + level + ' id="' + id + '">' + text + '</h' + level + '>';
      }
      return false;
    },
    code(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      const html = language
        ? hljs.highlight(code, { language }).value
        : hljs.highlightAuto(code).value;
      return '<pre><code class="hljs' + (language ? ' language-' + language : '') + '">'
        + html + '</code></pre>';
    },
  },
});

function buildToc(headings) {
  if (headings.filter(h => h.level === 2).length < 2) return '';
  let html = '<nav class="toc"><div class="toc-title">Contents</div><ul>';
  let inSub = false;
  for (const h of headings) {
    if (h.level === 2) {
      if (inSub) { html += '</ul></li>'; inSub = false; }
      html += '<li><a href="#' + h.id + '">' + h.text + '</a>';
    } else if (h.level === 3) {
      if (!inSub) { html += '<ul>'; inSub = true; }
      html += '<li><a href="#' + h.id + '">' + h.text + '</a></li>';
    }
  }
  if (inSub) html += '</ul></li>';
  html += '</ul></nav>';
  return html;
}

function renderMarkdown(md) {
  let text = md;
  if (text.startsWith('---')) {
    const end = text.indexOf('---', 3);
    if (end !== -1) text = text.slice(end + 3);
  }
  text = text.replace(/^\s*#\s+[^\n]*\n+/, '');
  resetMarkdownState();
  const html = marked.parse(text);
  const toc = buildToc(tocHeadings);
  let intro = html, rest = '';
  if (toc) {
    const idx = html.indexOf('<h2');
    if (idx >= 0) { intro = html.slice(0, idx); rest = html.slice(idx); }
  }
  return { intro, rest, toc };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function layout({ title, description, canonical, body, isPost }) {
  const desc = description ? `<meta name="description" content="${escapeHtml(description)}">\n` : '';
  const canon = canonical ? `<link rel="canonical" href="${canonical}">\n` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${desc}${canon}<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="${HLJS_DARK}">
<link rel="stylesheet" href="${HLJS_LIGHT}" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>▸</text></svg>">
</head>
<body>
<header class="site-header">
  <a href="/" class="site-title">emir's blog</a>
  <p class="site-tagline">systems · virtualization · engineering</p>
</header>
${isPost ? '<nav id="nav"><a href="/" class="back">← posts</a></nav>' : '<nav id="nav"></nav>'}
<main id="content">${body}</main>
<footer>© 2026</footer>
</body>
</html>
`;
}

function renderIndex(posts) {
  if (!posts.length) return '<p class="empty">No posts yet.</p>';
  return posts.map(p => {
    const desc = p.description
      ? `<p class="post-desc">${escapeHtml(p.description)}</p>` : '';
    const tags = (p.tags || [])
      .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
    return `<article class="post-entry">`
      + `<time>${escapeHtml(p.date)}</time>`
      + `<div><a href="/${p.slug}">${escapeHtml(p.title)}</a>`
      + desc
      + `<div class="tags">${tags}</div></div>`
      + `</article>`;
  }).join('\n');
}

function renderPost(meta, parsed) {
  const tags = (meta.tags || [])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
  return `<article class="post"><h1>${escapeHtml(meta.title)}</h1>`
    + `<div class="post-meta"><time>${escapeHtml(meta.date)}</time>`
    + `<div class="tags">${tags}</div></div>`
    + `<div class="post-body">${parsed.intro}</div>`
    + parsed.toc
    + `<div class="post-body">${parsed.rest}</div></article>`;
}

function writeSitemap(posts) {
  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const homeLastmod = sorted[0]?.date ?? new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, lastmod: homeLastmod, changefreq: 'weekly', priority: '1.0' },
    ...sorted.map(p => ({ loc: `${SITE}/${p.slug}`, lastmod: p.date, priority: '0.8' })),
  ];
  const body = urls.map(u => {
    const parts = [`    <loc>${u.loc}</loc>`, `    <lastmod>${u.lastmod}</lastmod>`];
    if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
    return `  <url>\n${parts.join('\n')}\n  </url>`;
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  fs.writeFileSync(path.join(out, 'sitemap.xml'), xml);
}

function copyIfExists(from, to) {
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
}

function main() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const posts = JSON.parse(fs.readFileSync(path.join(root, 'posts.json'), 'utf8'));
  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));

  fs.writeFileSync(
    path.join(out, 'index.html'),
    layout({
      title: "emir's blog",
      canonical: `${SITE}/`,
      body: renderIndex(sorted),
      isPost: false,
    })
  );

  for (const meta of sorted) {
    const md = fs.readFileSync(path.join(root, 'posts', meta.slug + '.md'), 'utf8');
    const parsed = renderMarkdown(md);
    fs.writeFileSync(
      path.join(out, meta.slug + '.html'),
      layout({
        title: `${meta.title} — emir's blog`,
        description: meta.description,
        canonical: `${SITE}/${meta.slug}`,
        body: renderPost(meta, parsed),
        isPost: true,
      })
    );
  }

  copyIfExists(path.join(root, 'style.css'), path.join(out, 'style.css'));
  copyIfExists(path.join(root, 'robots.txt'), path.join(out, 'robots.txt'));
  writeSitemap(sorted);

  console.log(`built ${sorted.length} post(s) + index to ${path.relative(root, out)}/`);
}

main();

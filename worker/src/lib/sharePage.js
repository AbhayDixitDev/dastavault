/**
 * The page a share link opens (GET /s/:token), served by this API so links
 * work for anyone, without the app and without a hosted web app. It reads the
 * document from GET /api/shares/:token (asking for the password when the link
 * has one) and shows its pages, with download buttons when allowed.
 */
export function sharePageHtml(token) {
  const safeToken = String(token).replace(/[^A-Za-z0-9_-]/g, '')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shared document · DastaVault</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f7f8; --card:#fff; --fg:#18181b; --muted:#71717a; --line:#e4e4e7; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0b0d; --card:#17171a; --fg:#f4f4f5; --muted:#a1a1aa; --line:#27272a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:760px; margin:0 auto; padding:20px 16px 48px; }
  .brand { color:var(--muted); font-size:14px; margin-bottom:12px; }
  h1 { font-size:22px; margin:0 0 4px; overflow-wrap:anywhere; }
  .muted { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-top:16px; }
  .page { margin-top:16px; }
  .page img { width:100%; height:auto; border-radius:12px; border:1px solid var(--line); background:var(--card); display:block; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
  a.btn, button { display:inline-flex; align-items:center; justify-content:center; height:44px; padding:0 16px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--fg); text-decoration:none; font:inherit; font-weight:600; cursor:pointer; }
  a.btn.primary, button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  input { width:100%; height:44px; padding:0 12px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--fg); font:inherit; }
  .error { color:#dc2626; }
</style>
</head>
<body>
<main>
  <div class="brand">DastaVault · shared document</div>
  <div id="app"><p class="muted">Opening…</p></div>
</main>
<script>
(function () {
  var token = ${JSON.stringify(safeToken)};
  var app = document.getElementById('app');
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function show(nodes) { app.innerHTML = ''; nodes.forEach(function (n) { app.appendChild(n); }); }
  function message(text, isError) { show([el('div', { class: 'card' }, [el('p', { class: isError ? 'error' : 'muted', text: text })])]); }

  function askPassword(wrong) {
    var input = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'off' });
    var button = el('button', { class: 'primary', type: 'submit', text: 'Open' });
    var form = el('form', { class: 'card' }, [
      el('p', { text: wrong ? 'Wrong password. Try again.' : 'This link needs a password.', class: wrong ? 'error' : '' }),
      input, el('div', { class: 'row' }, [button]),
    ]);
    form.addEventListener('submit', function (e) { e.preventDefault(); load(input.value); });
    show([form]);
    input.focus();
  }

  function render(data) {
    var doc = data.document || {};
    var files = data.files || [];
    var pick = function (kind) { return files.filter(function (f) { return f.kind === kind; }); };
    var pages = pick('processed').length ? pick('processed') : pick('original');
    var images = pages.filter(function (f) { return /^image\\//.test(f.mime_type || ''); });
    var others = files.filter(function (f) { return f.kind === 'pdf' || (f.kind === 'original' && !/^image\\//.test(f.mime_type || '')); });
    var nodes = [el('h1', { text: doc.name || 'Document' })];
    if (doc.summary) nodes.push(el('p', { class: 'muted', text: doc.summary }));
    if (data.expires_at) nodes.push(el('p', { class: 'muted', text: 'This link works until ' + new Date(data.expires_at).toLocaleString() + '.' }));
    images.forEach(function (f, i) {
      var page = el('div', { class: 'page' }, [el('img', { src: f.url, alt: 'Page ' + (i + 1), loading: 'lazy' })]);
      if (f.download_url) page.appendChild(el('div', { class: 'row' }, [el('a', { class: 'btn', href: f.download_url, text: 'Download page ' + (i + 1) })]));
      nodes.push(page);
    });
    var actions = [];
    others.forEach(function (f) {
      actions.push(el('a', { class: 'btn primary', href: f.url, target: '_blank', rel: 'noopener', text: f.kind === 'pdf' ? 'Open PDF' : 'Open file' }));
      if (f.download_url) actions.push(el('a', { class: 'btn', href: f.download_url, text: 'Download' }));
    });
    if (actions.length) nodes.push(el('div', { class: 'card' }, [el('div', { class: 'row' }, actions)]));
    if (!images.length && !actions.length) nodes.push(message('This document has no files to show.'));
    show(nodes);
  }

  function load(password) {
    var headers = password ? { 'x-share-password': password } : {};
    fetch('/api/shares/' + encodeURIComponent(token), { headers: headers })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.status === 200) return render(r.body);
        if (r.status === 401) return askPassword(Boolean(password));
        if (r.status === 410) return message('This link has expired.', true);
        if (r.status === 404) return message('This link is no longer available.', true);
        message((r.body && r.body.error) || 'Could not open this link. Try again later.', true);
      })
      .catch(function () { message('Could not reach the server. Check your internet and try again.', true); });
  }
  load('');
})();
</script>
</body>
</html>`
}

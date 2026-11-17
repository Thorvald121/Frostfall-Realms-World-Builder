/**
 * Strict, browser-side rich text parser for legacy Codex/Manuscript HTML.
 * Returns inert descriptors; React renders only approved elements and attributes.
 * Never allow a source document to provide scripts, event handlers, CSS or SVG.
 * The migration to a structured editor can reuse this normalization boundary.
 */
export const RICH_TEXT_TAGS = Object.freeze([
  'p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'hr',
  'a', 'span', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
]);
const ALLOWED = new Set(RICH_TEXT_TAGS);
const DISCARD_CONTENT = new Set([
  'script', 'style', 'svg', 'math', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'template', 'noscript', 'meta', 'link', 'base',
  'form', 'input', 'select', 'textarea', 'button', 'video', 'audio',
  'canvas', 'picture', 'source', 'foreignobject',
]);
const VOID = new Set(['br', 'hr', 'img']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_HTML_LENGTH = 2_000_000;
const MAX_DEPTH = 48;
const MAX_NODES = 20000;

export function safeHref(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > 2048 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  if (s.startsWith('#') && /^#[A-Za-z0-9_-]+$/.test(s)) return s;
  try {
    const url = new URL(s);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return s;
  } catch { /* relative / malformed link: deliberately blocked */ }
  return null;
}

export function safeImageSrc(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > 11_000_000) return null;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.protocol === 'https:' && /\.supabase\.co$/i.test(url.hostname) &&
      url.pathname.startsWith('/storage/v1/object/public/')) return s;
  } catch { /* block */ }
  return null;
}

/**
 * Convert HTML into inert descriptors. DOMParser creates a disconnected DOM,
 * and NO source-created element is subsequently mounted into the page.
 */
export function parseSafeRichText(html, Parser = typeof DOMParser !== 'undefined' ? DOMParser : null) {
  const input = typeof html === 'string' ? html : String(html ?? '');
  if (!Parser) return input ? [{ kind: 'text', text: input }] : [];
  if (input.length > MAX_HTML_LENGTH) return [{ kind: 'text', text: input.slice(0, MAX_HTML_LENGTH) }];
  const parsed = new Parser().parseFromString(input, 'text/html');
  let count = 0;
  function walk(node, depth) {
    if (++count > MAX_NODES || depth > MAX_DEPTH) return [];
    if (node.nodeType === 3) return [{ kind: 'text', text: node.textContent || '' }];
    if (node.nodeType !== 1) return [];
    const tag = node.localName?.toLowerCase();
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || DISCARD_CONTENT.has(tag)) return [];
    const children = VOID.has(tag) ? [] : Array.from(node.childNodes).flatMap((child) => walk(child, depth + 1));
    if (!ALLOWED.has(tag)) return children;
    const props = {};
    if (tag === 'a') {
      const href = safeHref(node.getAttribute('href'));
      if (href) { props.href = href; props.target = '_blank'; props.rel = 'noopener noreferrer nofollow'; }
    }
    if (tag === 'img') {
      const src = safeImageSrc(node.getAttribute('src'));
      if (!src) return [];
      props.src = src;
      props.alt = (node.getAttribute('alt') || '').slice(0, 256);
      props.loading = 'lazy';
    }
    if (tag === 'span') {
      const mentionId = node.getAttribute('data-mention-id');
      const linkedId = node.getAttribute('data-id');
      if (mentionId && SAFE_ID.test(mentionId)) {
        props['data-mention-id'] = mentionId;
        props['data-mention-title'] = (node.getAttribute('data-mention-title') || '').slice(0, 200);
        props.contentEditable = false;
        props.className = 'ff-safe-mention';
      } else if (linkedId && SAFE_ID.test(linkedId) && node.classList.contains('mention-chip')) {
        props['data-id'] = linkedId;
        props.className = 'mention-chip ff-safe-mention';
      }
    }
    return [{ kind: 'element', tag, props, children }];
  }
  return Array.from(parsed.body.childNodes).flatMap((node) => walk(node, 0));
}

/** Serialize our inert descriptors to safe editor HTML; never serialize source nodes. */
export function sanitizeRichHtml(html, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return escapeHtml(html);
  const root = doc.createElement('div');
  function append(parent, descriptor) {
    if (descriptor.kind === 'text') { parent.appendChild(doc.createTextNode(descriptor.text)); return; }
    const element = doc.createElement(descriptor.tag);
    for (const [key, value] of Object.entries(descriptor.props)) {
      if (key === 'className') element.setAttribute('class', value);
      else if (key === 'contentEditable') element.setAttribute('contenteditable', 'false');
      else element.setAttribute(key, String(value));
    }
    for (const child of descriptor.children) append(element, child);
    parent.appendChild(element);
  }
  for (const node of parseSafeRichText(html, doc.defaultView?.DOMParser || DOMParser)) append(root, node);
  return root.innerHTML;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

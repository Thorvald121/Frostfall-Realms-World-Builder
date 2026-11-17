"""Runs restricted rich-text attack cases inside a real local Chromium DOM.
No network or Supabase credentials. Requires Python Playwright and Chromium.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
source = (Path(__file__).resolve().parents[1]/'lib/domain/richTextSafety.js').read_text()
source = source.replace('export const ', 'const ').replace('export function ', 'function ')
source += '\nwindow.ffP6 = { parseSafeRichText, sanitizeRichHtml, safeHref, safeImageSrc };'
attacks = [
    '<img src=x onerror="window.pwned=true">',
    '<svg onload="window.pwned=true"><script>window.pwned=true</script></svg>',
    '<p onclick="window.pwned=true">text</p>',
    '<a href="javascript:window.pwned=true">bad</a>',
    '<iframe srcdoc="<script>window.pwned=true</script>"></iframe>',
    '<math><mtext><table><mtext><img src=x onerror="window.pwned=true"></mtext></table></mtext></math>',
    '<p style="color:transparent"><strong>invisible text</strong></p>',
    '<span data-id="x\" onclick=\"window.pwned=true" class="mention-chip">mention</span>',
    '<a href="data:text/html,<script>alert(1)</script>">bad</a>',
]
checks = 0
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    page.goto('about:blank')
    page.add_script_tag(content=source)
    for attack in attacks:
        result = page.evaluate('''(attack) => {
          document.body.innerHTML = '';
          window.pwned = false;
          const normalized = window.ffP6.sanitizeRichHtml(attack);
          document.body.innerHTML = normalized;
          return {
            result: normalized,
            pwned: window.pwned,
            nodes: document.body.querySelectorAll('script,iframe,object,embed,svg,math,style,form,input').length,
            dangerous: Array.from(document.body.querySelectorAll('*')).some(node =>
               Array.from(node.attributes).some(attr => /^on/i.test(attr.name) || /^javascript:/i.test(attr.value)))
          };
        }''', attack)
        assert not result['pwned'] and result['nodes']==0 and not result['dangerous'], result
        checks += 1
    positives = page.evaluate('''() => {
        const html = '<h2>Chapter</h2><p><em>Rime</em> and <strong>fire</strong></p><table><tr><td>year 0</td></tr></table><span class="mention-chip" data-id="id_42">Elara</span>';
        const output = window.ffP6.sanitizeRichHtml(html);
        const tree = window.ffP6.parseSafeRichText(html);
        return {output, tree};
    }''')
    assert '<h2>Chapter</h2>' in positives['output']
    assert '<em>Rime</em>' in positives['output']
    assert '<strong>fire</strong>' in positives['output']
    assert '<table>' in positives['output']
    assert 'data-id="id_42"' in positives['output']
    checks+=1
    browser.close()
print(f'P6_BROWSER_RICH_TEXT_SANITIZER_PASS {checks} cases')

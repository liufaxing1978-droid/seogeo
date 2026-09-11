import { describe, expect, it } from 'vitest';
import { renderMainSiteArticleHtml } from '../../src/modules/publication/main-site-article-html.js';

describe('renderMainSiteArticleHtml', () => {
  it('converts a Markdown article into the safe structural HTML supported by the main site', () => {
    expect(renderMainSiteArticleHtml([
      '# 六壬伏英馆',
      '',
      '六壬伏英馆是民间法脉与文化传承的一部分。',
      '',
      '## 传承与文化',
      '',
      '- 师徒传承',
      '- 坛仪制度',
      '',
      '> 具体源流仍应以文献与地方资料核证。',
      '',
      '了解 **六壬文化**，可阅读[兴善堂](https://xingshantang.org)。',
    ].join('\n'))).toBe([
      '<h2>六壬伏英馆</h2>',
      '<p>六壬伏英馆是民间法脉与文化传承的一部分。</p>',
      '<h2>传承与文化</h2>',
      '<ul><li>师徒传承</li><li>坛仪制度</li></ul>',
      '<blockquote><p>具体源流仍应以文献与地方资料核证。</p></blockquote>',
      '<p>了解 <strong>六壬文化</strong>，可阅读<a href="https://xingshantang.org/" rel="noopener noreferrer">兴善堂</a>。</p>',
    ].join('\n'));
  });

  it('escapes raw HTML instead of passing it into a main-site article', () => {
    expect(renderMainSiteArticleHtml('正文 <script>alert(1)</script>')).toBe(
      '<p>正文 &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });
});

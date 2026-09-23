import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractBlocks, findMainContainer } from '../src/content/extract.js';

function makeDoc(html: string): Document {
  const dom = new JSDOM(html, { url: 'https://example.com/article' });
  return dom.window.document;
}

describe('findMainContainer', () => {
  it('picks the article element over nav/footer noise', () => {
    const doc = makeDoc(`
      <body>
        <nav><p>Home About Contact</p></nav>
        <article id="main-article"><p>Real content here.</p></article>
        <footer><p>Copyright 2026</p></footer>
      </body>
    `);
    expect(findMainContainer(doc).id).toBe('main-article');
  });

  it('falls back to main/[role=main] when there is no article', () => {
    const doc = makeDoc(`
      <body>
        <header><p>Site header</p></header>
        <main id="the-main"><p>The real text.</p></main>
      </body>
    `);
    expect(findMainContainer(doc).id).toBe('the-main');
  });

  it('falls back to the element with the most paragraph text', () => {
    const doc = makeDoc(`
      <body>
        <div id="sidebar"><p>short</p></div>
        <div id="content"><p>${'word '.repeat(200)}</p></div>
      </body>
    `);
    expect(findMainContainer(doc).id).toBe('content');
  });
});

describe('extractBlocks', () => {
  it('skips nav, footer and other structural noise', () => {
    const doc = makeDoc(`
      <body>
        <article>
          <nav><p>Nav link text that should never appear.</p></nav>
          <p>First real paragraph of the article.</p>
          <footer><p>Footer text that should never appear.</p></footer>
        </article>
      </body>
    `);
    const blocks = extractBlocks(doc).map((b) => b.text);
    expect(blocks).toEqual(['First real paragraph of the article.']);
  });

  it('skips hidden elements', () => {
    const doc = makeDoc(`
      <body>
        <article>
          <p style="display:none">Hidden paragraph.</p>
          <p style="visibility:hidden">Also hidden.</p>
          <p>Visible paragraph.</p>
        </article>
      </body>
    `);
    const blocks = extractBlocks(doc).map((b) => b.text);
    expect(blocks).toEqual(['Visible paragraph.']);
  });

  it('skips obvious comment/cookie containers', () => {
    const doc = makeDoc(`
      <body>
        <article>
          <div class="cookie-consent"><p>We use cookies.</p></div>
          <div id="comments"><p>Great article!</p></div>
          <p>The actual article text.</p>
        </article>
      </body>
    `);
    const blocks = extractBlocks(doc).map((b) => b.text);
    expect(blocks).toEqual(['The actual article text.']);
  });

  it('converts bold text, headings and list items to light markdown', () => {
    const doc = makeDoc(`
      <body>
        <article>
          <h2>A Heading</h2>
          <p>Some <strong>bold</strong> text here.</p>
          <ul><li>First item</li><li>Second item</li></ul>
        </article>
      </body>
    `);
    const blocks = extractBlocks(doc).map((b) => b.text);
    expect(blocks).toEqual(['## A Heading', 'Some **bold** text here.', '- First item', '- Second item']);
  });

  it('returns the element each block came from', () => {
    const doc = makeDoc(`<body><article><p id="p1">Hello world, this is a paragraph.</p></article></body>`);
    const blocks = extractBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect((blocks[0]?.element as Element).id).toBe('p1');
  });

  it('does not duplicate a paragraph nested inside a blockquote', () => {
    const doc = makeDoc(`
      <body>
        <article><blockquote><p>Quoted text goes here.</p></blockquote></article>
      </body>
    `);
    const blocks = extractBlocks(doc).map((b) => b.text);
    expect(blocks).toEqual(['Quoted text goes here.']);
  });
});

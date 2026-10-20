import sanitize from 'sanitize-html';
export function cleanHtml(html: string, publicBase = '') {
  let heading = 0;
  return sanitize(html, {
    allowedTags: [
      'p',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'a',
      'img',
      'blockquote',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'code',
      'pre',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_, attrs) => ({
        tagName: 'a',
        attribs: {
          ...attrs,
          href:
            publicBase &&
            /^\/(?:mappools|teams|matches|staff|rules|register)(?:\/|\?|#|$)/.test(attrs.href || '')
              ? publicBase + attrs.href
              : attrs.href === '/' && publicBase
                ? publicBase
                : attrs.href,
          rel: 'noopener noreferrer',
        },
      }),
      h1: (_, a) => ({ tagName: 'h2', attribs: { ...a, id: `section-${++heading}` } }),
      h2: (_, a) => ({ tagName: 'h2', attribs: { ...a, id: `section-${++heading}` } }),
      h3: (_, a) => ({ tagName: 'h3', attribs: { ...a, id: `section-${++heading}` } }),
      h4: (_, a) => ({ tagName: 'h4', attribs: { ...a, id: `section-${++heading}` } }),
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !/^(https:\/\/|\/api\/media\/|\/[^/])/.test(frame.attribs.src || ''),
  });
}
export function tableOfContents(html: string) {
  return [...html.matchAll(/<h([234]) id="([^"]+)"[^>]*>(.*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    id: m[2],
    text: headingText(m[3]),
  }));
}
function headingText(html: string) {
  let text = '';
  // Read decoded text from the existing HTML parser, not escaped HTML output.
  sanitize(`<p>${html}</p>`, {
    allowedTags: ['p'],
    allowedAttributes: {},
    exclusiveFilter: (frame) => {
      if (frame.tag === 'p') text = frame.text;
      return false;
    },
  });
  return text;
}

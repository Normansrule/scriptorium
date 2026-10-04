/** DOMPurify settings shared by the web book, the EPUB and the app proof: keep MathML and our figure markup, drop anything active. */
export const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true, svg: false },
  ADD_TAGS: ['picture', 'source', 'annotation', 'semantics'],
  ADD_ATTR: ['srcset', 'media', 'loading', 'encoding', 'aria-hidden', 'data-model'],
  // DOMPurify's default URI rule blocks javascript:, vbscript: and data: in links.
  ADD_URI_SAFE_ATTR: ['media', 'aria-hidden', 'encoding'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
};

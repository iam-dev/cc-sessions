/**
 * Tests that the UI HTML includes resume block CSS and JS
 */
import { getUIHtml } from '../../src/server/ui';

describe('UI resume block', () => {
  let html: string;

  beforeAll(() => { html = getUIHtml(); });

  it('includes .resume-block CSS class', () => {
    expect(html).toContain('.resume-block');
  });

  it('includes .resume-copy-btn CSS class', () => {
    expect(html).toContain('.resume-copy-btn');
  });

  it('includes claude --resume in JS', () => {
    expect(html).toContain('claude --resume');
  });

  it('includes clipboard copy logic', () => {
    expect(html).toContain('navigator.clipboard');
    expect(html).toContain('execCommand');    // fallback
  });

  it('includes "Resume in Claude Code" section title', () => {
    expect(html).toContain('RESUME IN CLAUDE CODE');
  });
});

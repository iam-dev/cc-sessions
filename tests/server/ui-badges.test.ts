/**
 * Tests that the UI HTML includes tag badge CSS and rendering logic
 */
import { getUIHtml } from '../../src/server/ui';

describe('UI tag badges', () => {
  let html: string;

  beforeAll(() => {
    html = getUIHtml();
  });

  it('includes .tag-badge CSS class', () => {
    expect(html).toContain('.tag-badge');
  });

  it('references pre-compact badge text with emoji in JS', () => {
    expect(html).toContain('\uD83D\uDCF8 pre-compact');
  });

  it('references snapshot badge text with emoji in JS', () => {
    expect(html).toContain('\uD83D\uDCCC snapshot');
  });
});

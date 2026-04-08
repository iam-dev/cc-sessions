/**
 * Tests that the UI HTML includes health score visual indicators
 */
import { getUIHtml } from '../../src/server/ui';

describe('UI health indicators', () => {
  let html: string;

  beforeAll(() => {
    html = getUIHtml();
  });

  it('includes .health-dot CSS class', () => {
    expect(html).toContain('.health-dot');
  });

  it('includes health-green CSS string', () => {
    expect(html).toContain('health-green');
  });

  it('includes health-red CSS string', () => {
    expect(html).toContain('health-red');
  });

  it('includes computeHealth function name in JS', () => {
    expect(html).toContain('computeHealth');
  });

  it('includes healthBadgeNode function name in JS', () => {
    expect(html).toContain('healthBadgeNode');
  });

  it('includes healthLabel function name in JS', () => {
    expect(html).toContain('healthLabel');
  });
});

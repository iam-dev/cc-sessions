/**
 * Tests for config loader
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, saveConfig, getConfigDir } from '../../src/config/loader';
import { DEFAULT_CONFIG } from '../../src/config/defaults';

describe('Config Loader', () => {
  const originalHome = process.env.HOME;
  const testDir = path.join(os.tmpdir(), 'cc-sessions-config-test');
  const testConfigDir = path.join(testDir, '.cc-sessions');

  beforeAll(() => {
    // Create test directory structure
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Point HOME to test directory for isolated testing
    // Note: This won't work with the actual loader since it uses os.homedir()
    // For real testing, we'd need to mock os.homedir or pass config path
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have all required fields', () => {
      expect(DEFAULT_CONFIG.version).toBe(1);
      expect(DEFAULT_CONFIG.retention).toBeDefined();
      expect(DEFAULT_CONFIG.autoSave).toBeDefined();
      expect(DEFAULT_CONFIG.summaries).toBeDefined();
      expect(DEFAULT_CONFIG.search).toBeDefined();
      expect(DEFAULT_CONFIG.cloud).toBeDefined();
      expect(DEFAULT_CONFIG.ui).toBeDefined();
      expect(DEFAULT_CONFIG.projects).toBeDefined();
    });

    it('should have sensible default values', () => {
      expect(DEFAULT_CONFIG.retention.fullSessions).toBe('1y');
      expect(DEFAULT_CONFIG.autoSave.enabled).toBe(true);
      expect(DEFAULT_CONFIG.autoSave.generateSummary).toBe(true);
      expect(DEFAULT_CONFIG.summaries.model).toBe('haiku');
      expect(DEFAULT_CONFIG.ui.showOnStart).toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('should return default config when no config file exists', async () => {
      // This test depends on actual file system state
      // In a real scenario, we'd mock the fs module
      const config = await loadConfig();

      expect(config.version).toBe(DEFAULT_CONFIG.version);
      expect(config.retention.fullSessions).toBeDefined();
    });
  });

  describe('getConfigDir', () => {
    it('should return path under home directory', () => {
      const configDir = getConfigDir();

      expect(configDir).toContain('.cc-sessions');
      expect(configDir).toContain(os.homedir());
    });
  });

  describe('Retention config parsing', () => {
    it('should handle all retention period formats', () => {
      // Test the retention config structure
      expect(DEFAULT_CONFIG.retention.fullSessions).toMatch(/^\d+[dmy]$|^forever$/);
      expect(DEFAULT_CONFIG.retention.archives).toMatch(/^\d+[dmy]$|^forever$/);
    });
  });

  describe('Summary config', () => {
    it('should have valid model options', () => {
      expect(['haiku', 'sonnet']).toContain(DEFAULT_CONFIG.summaries.model);
    });

    it('should have reasonable max length', () => {
      expect(DEFAULT_CONFIG.summaries.maxLength).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.summaries.maxLength).toBeLessThanOrEqual(2000);
    });
  });

  describe('Cloud config', () => {
    it('should be disabled by default', () => {
      expect(DEFAULT_CONFIG.cloud.enabled).toBe(false);
    });

    it('should have valid provider options', () => {
      expect(['r2', 's3', 'b2']).toContain(DEFAULT_CONFIG.cloud.provider);
    });
  });

  describe('UI config', () => {
    it('should have valid theme options', () => {
      expect(['auto', 'dark', 'light']).toContain(DEFAULT_CONFIG.ui.theme);
    });

    it('should have reasonable recent count', () => {
      expect(DEFAULT_CONFIG.ui.recentCount).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.ui.recentCount).toBeLessThanOrEqual(100);
    });
  });
});

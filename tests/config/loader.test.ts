/**
 * Tests for config loader
 */

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import { loadConfig, saveConfig, getConfigDir, getConfigFile } from '../../src/config/loader';
import { DEFAULT_CONFIG } from '../../src/config/defaults';

const mockExistsSync = fs.existsSync as jest.Mock;
const mockMkdirSync = fs.mkdirSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockWriteFileSync = fs.writeFileSync as jest.Mock;

// Passthrough for non-config-yml reads
const realReadFileSync = jest.requireActual<typeof import('fs')>('fs').readFileSync;

describe('Config Loader', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── DEFAULT_CONFIG ──────────────────────────────────────────────────────────

  describe('DEFAULT_CONFIG', () => {
    it('has all required fields', () => {
      expect(DEFAULT_CONFIG.version).toBe(1);
      expect(DEFAULT_CONFIG.retention).toBeDefined();
      expect(DEFAULT_CONFIG.autoSave).toBeDefined();
      expect(DEFAULT_CONFIG.summaries).toBeDefined();
      expect(DEFAULT_CONFIG.search).toBeDefined();
      expect(DEFAULT_CONFIG.cloud).toBeDefined();
      expect(DEFAULT_CONFIG.ui).toBeDefined();
      expect(DEFAULT_CONFIG.projects).toBeDefined();
    });

    it('has sensible default values', () => {
      expect(DEFAULT_CONFIG.retention.fullSessions).toBe('1y');
      expect(DEFAULT_CONFIG.autoSave.enabled).toBe(true);
      expect(DEFAULT_CONFIG.autoSave.generateSummary).toBe(true);
      expect(DEFAULT_CONFIG.summaries.model).toBe('haiku');
      expect(DEFAULT_CONFIG.ui.showOnStart).toBe(true);
    });
  });

  // ── getConfigDir / getConfigFile ────────────────────────────────────────────

  describe('getConfigDir', () => {
    it('returns path under home directory', () => {
      const configDir = getConfigDir();
      expect(configDir).toContain('.cc-sessions');
      expect(configDir).toContain(os.homedir());
    });
  });

  describe('getConfigFile', () => {
    it('returns path to config.yml inside config dir', () => {
      const configFile = getConfigFile();
      expect(configFile).toContain('config.yml');
      expect(configFile).toContain(getConfigDir());
    });
  });

  // ── loadConfig ──────────────────────────────────────────────────────────────

  describe('loadConfig', () => {
    it('returns DEFAULT_CONFIG when config file does not exist', async () => {
      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        if (p.toString().includes('config.yml')) return false;
        return true;
      });

      const config = await loadConfig();
      expect(config.version).toBe(DEFAULT_CONFIG.version);
      expect(config.autoSave.enabled).toBe(DEFAULT_CONFIG.autoSave.enabled);
    });

    it('creates config dir when it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined as never);

      await loadConfig();

      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('returns DEFAULT_CONFIG when YAML parsing fails', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return 'invalid: : yaml: [[[';
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.version).toBe(DEFAULT_CONFIG.version);
    });

    it('merges auto_save config from YAML', async () => {
      const yaml = `
version: 1
auto_save:
  enabled: false
  interval_minutes: 15
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.autoSave.enabled).toBe(false);
      expect(config.autoSave.intervalMinutes).toBe(15);
    });

    it('merges retention config from YAML', async () => {
      const yaml = `
version: 1
retention:
  full_sessions: 90d
  archives: 2y
  override_claude_retention: true
  max_storage_gb: 5
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.retention.fullSessions).toBe('90d');
      expect(config.retention.archives).toBe('2y');
      expect(config.retention.overrideClaudeRetention).toBe(true);
      expect(config.retention.maxStorageGb).toBe(5);
    });

    it('merges summaries config from YAML', async () => {
      const yaml = `
version: 1
summaries:
  model: sonnet
  max_length: 1000
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.summaries.model).toBe('sonnet');
      expect(config.summaries.maxLength).toBe(1000);
    });

    it('merges search config from YAML', async () => {
      const yaml = `
version: 1
search:
  enabled: false
  fuzzy_threshold: 0.5
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.search.enabled).toBe(false);
      expect(config.search.fuzzyThreshold).toBe(0.5);
    });

    it('merges cloud config from YAML', async () => {
      const yaml = `
version: 1
cloud:
  enabled: true
  provider: s3
  bucket: my-bucket
  region: eu-west-1
  sync_on_save: true
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.cloud.enabled).toBe(true);
      expect(config.cloud.provider).toBe('s3');
      expect(config.cloud.bucket).toBe('my-bucket');
      expect(config.cloud.region).toBe('eu-west-1');
      expect(config.cloud.syncOnSave).toBe(true);
    });

    it('merges ui config from YAML', async () => {
      const yaml = `
version: 1
ui:
  show_on_start: false
  recent_count: 20
  theme: dark
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.ui.showOnStart).toBe(false);
      expect(config.ui.recentCount).toBe(20);
      expect(config.ui.theme).toBe('dark');
    });

    it('merges projects config from YAML', async () => {
      const yaml = `
version: 1
projects:
  overrides:
    /my/project:
      retention: 30d
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.projects.overrides['/my/project']).toBeDefined();
    });

    it('falls back to defaults when subsections are absent', async () => {
      const yaml = `version: 1`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().includes('config.yml')) return yaml;
        return realReadFileSync(p);
      });

      const config = await loadConfig();
      expect(config.autoSave.enabled).toBe(DEFAULT_CONFIG.autoSave.enabled);
      expect(config.cloud.enabled).toBe(DEFAULT_CONFIG.cloud.enabled);
    });
  });

  // ── saveConfig ──────────────────────────────────────────────────────────────

  describe('saveConfig', () => {
    it('writes config as YAML to the config file', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockReturnValue(undefined);

      await saveConfig(DEFAULT_CONFIG);

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      expect(typeof writtenContent).toBe('string');
      expect(writtenContent).toContain('version');
      expect(writtenContent).toContain('auto_save');
    });

    it('creates config dir when it does not exist before saving', async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined as never);
      mockWriteFileSync.mockReturnValue(undefined);

      await saveConfig(DEFAULT_CONFIG);

      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('includes all config sections in the output YAML', async () => {
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockReturnValue(undefined);

      await saveConfig(DEFAULT_CONFIG);

      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain('retention');
      expect(content).toContain('summaries');
      expect(content).toContain('cloud');
      expect(content).toContain('ui');
    });
  });

  // ── Retention config parsing ────────────────────────────────────────────────

  describe('Retention config parsing', () => {
    it('default retention periods match expected patterns', () => {
      expect(DEFAULT_CONFIG.retention.fullSessions).toMatch(/^\d+[dmy]$|^forever$/);
      expect(DEFAULT_CONFIG.retention.archives).toMatch(/^\d+[dmy]$|^forever$/);
    });
  });

  // ── Summary config ──────────────────────────────────────────────────────────

  describe('Summary config', () => {
    it('has valid model options', () => {
      expect(['haiku', 'sonnet']).toContain(DEFAULT_CONFIG.summaries.model);
    });

    it('has reasonable max length', () => {
      expect(DEFAULT_CONFIG.summaries.maxLength).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.summaries.maxLength).toBeLessThanOrEqual(2000);
    });
  });

  // ── Cloud config ────────────────────────────────────────────────────────────

  describe('Cloud config', () => {
    it('is disabled by default', () => {
      expect(DEFAULT_CONFIG.cloud.enabled).toBe(false);
    });

    it('has valid provider options', () => {
      expect(['r2', 's3', 'b2']).toContain(DEFAULT_CONFIG.cloud.provider);
    });
  });

  // ── UI config ───────────────────────────────────────────────────────────────

  describe('UI config', () => {
    it('has valid theme options', () => {
      expect(['auto', 'dark', 'light']).toContain(DEFAULT_CONFIG.ui.theme);
    });

    it('has reasonable recent count', () => {
      expect(DEFAULT_CONFIG.ui.recentCount).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.ui.recentCount).toBeLessThanOrEqual(100);
    });
  });
});

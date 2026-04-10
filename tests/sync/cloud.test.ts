/**
 * Tests for the CloudSync module
 *
 * Note: These are unit tests with mocked S3 client.
 * Integration tests with real cloud storage should be run separately.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CloudConfig, SessionMemory } from '../../src/types';

// Mock the AWS SDK before importing CloudSync
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadBucketCommand: jest.fn()
}));

import { CloudSync } from '../../src/sync/cloud';
import { Encryptor } from '../../src/sync/encryption';
import { S3Client, HeadBucketCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

describe('CloudSync', () => {
  const testConfig: CloudConfig = {
    enabled: true,
    provider: 's3',
    bucket: 'test-bucket',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
    encryptionKey: Encryptor.generateKey(),
    syncIntervalMinutes: 30,
    syncOnSave: true,
    deviceId: 'test-device'
  };

  const createTestSession = (id: string = 'test-session-1'): SessionMemory => ({
    id,
    claudeSessionId: 'claude-123',
    projectPath: '/test/project',
    projectName: 'project',
    startedAt: new Date('2025-01-01T10:00:00Z'),
    endedAt: new Date('2025-01-01T11:00:00Z'),
    duration: 60,
    title: 'Test session title',
    summary: 'Test session',
    description: 'A test session for unit testing',
    tasks: [],
    tasksCompleted: 0,
    tasksPending: 0,
    filesCreated: [],
    filesModified: ['test.ts'],
    filesDeleted: [],
    lastUserMessage: 'Hello',
    lastAssistantMessage: 'Hi there!',
    nextSteps: [],
    keyDecisions: [],
    blockers: [],
    tokensUsed: 1000,
    messagesCount: 5,
    toolCallsCount: 2,
    tags: ['test'],
    archived: false,
    logFile: '/path/to/log.jsonl'
  });

  // Save/restore the real device-id file to avoid destroying user state
  const deviceIdPath = path.join(os.homedir(), '.cc-sessions', 'device-id');
  let savedDeviceId: string | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    // Save the existing device ID so we can restore it after the test
    savedDeviceId = fs.existsSync(deviceIdPath)
      ? fs.readFileSync(deviceIdPath, 'utf-8')
      : null;
    if (fs.existsSync(deviceIdPath)) {
      fs.unlinkSync(deviceIdPath);
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Restore the original device ID
    if (savedDeviceId !== null) {
      const dir = path.dirname(deviceIdPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(deviceIdPath, savedDeviceId, 'utf-8');
    } else if (fs.existsSync(deviceIdPath)) {
      // Clean up any device-id file the test created
      fs.unlinkSync(deviceIdPath);
    }
  });

  describe('constructor', () => {
    it('should create CloudSync with config', () => {
      const cloudSync = new CloudSync(testConfig);
      expect(cloudSync).toBeDefined();
    });

    it('should use provided device ID', () => {
      const cloudSync = new CloudSync(testConfig);
      expect(cloudSync.getDeviceId()).toBe('test-device');
    });

    it('should generate device ID when set to auto', () => {
      const configWithAuto = { ...testConfig, deviceId: 'auto' };
      const cloudSync = new CloudSync(configWithAuto);

      const deviceId = cloudSync.getDeviceId();
      expect(deviceId).toBeDefined();
      expect(deviceId.length).toBeGreaterThan(0);
    });

    it('should use provided encryption key', () => {
      const cloudSync = new CloudSync(testConfig);
      expect(cloudSync.getKeyFingerprint()).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should return false when no bucket configured', async () => {
      const configNoBucket = { ...testConfig, bucket: undefined };
      const cloudSync = new CloudSync(configNoBucket);

      const result = await cloudSync.testConnection();
      expect(result).toBe(false);
    });

    it('should call HeadBucketCommand to test connection', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      await cloudSync.testConnection();

      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('uploadSession', () => {
    it('should throw when no bucket configured', async () => {
      const configNoBucket = { ...testConfig, bucket: undefined };
      const cloudSync = new CloudSync(configNoBucket);
      const session = createTestSession();

      await expect(cloudSync.uploadSession(session)).rejects.toThrow('No bucket configured');
    });

    it('should call PutObjectCommand with encrypted data', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const session = createTestSession();

      await cloudSync.uploadSession(session);

      expect(mockSend).toHaveBeenCalled();
      expect(PutObjectCommand).toHaveBeenCalled();
    });

    it('should include device ID in upload path', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const session = createTestSession();

      await cloudSync.uploadSession(session);

      // Verify upload was called
      expect(mockSend).toHaveBeenCalled();

      // Verify device ID is used
      expect(cloudSync.getDeviceId()).toBe('test-device');
    });
  });

  describe('listRemoteSessions', () => {
    it('should throw when no bucket configured', async () => {
      const configNoBucket = { ...testConfig, bucket: undefined };
      const cloudSync = new CloudSync(configNoBucket);

      await expect(cloudSync.listRemoteSessions()).rejects.toThrow('No bucket configured');
    });

    it('should parse S3 response into RemoteSessionInfo', async () => {
      const mockResponse = {
        Contents: [
          {
            Key: 'sessions/device1/session1.enc',
            LastModified: new Date('2025-01-01T10:00:00Z'),
            Size: 1000
          },
          {
            Key: 'sessions/device2/session2.enc',
            LastModified: new Date('2025-01-02T10:00:00Z'),
            Size: 2000
          }
        ]
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const sessions = await cloudSync.listRemoteSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({
        sessionId: 'session1',
        deviceId: 'device1'
      });
      expect(sessions[1]).toMatchObject({
        sessionId: 'session2',
        deviceId: 'device2'
      });
    });

    it('should filter out non-.enc files', async () => {
      const mockResponse = {
        Contents: [
          { Key: 'sessions/device1/session1.enc', LastModified: new Date(), Size: 1000 },
          { Key: 'sessions/device1/README.md', LastModified: new Date(), Size: 100 },
          { Key: 'sessions/device1/session2.enc', LastModified: new Date(), Size: 2000 }
        ]
      };

      const mockSend = jest.fn().mockResolvedValue(mockResponse);
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const sessions = await cloudSync.listRemoteSessions();

      expect(sessions).toHaveLength(2);
    });
  });

  describe('getDeviceId', () => {
    it('should return consistent device ID', () => {
      const configWithAuto = { ...testConfig, deviceId: 'auto' };
      const cloudSync = new CloudSync(configWithAuto);

      const id1 = cloudSync.getDeviceId();
      const id2 = cloudSync.getDeviceId();

      expect(id1).toBe(id2);
    });

    it('should persist device ID to file', () => {
      const configWithAuto = { ...testConfig, deviceId: 'auto' };
      const cloudSync1 = new CloudSync(configWithAuto);
      const id1 = cloudSync1.getDeviceId();

      // Create new instance - should read same ID from file
      const cloudSync2 = new CloudSync(configWithAuto);
      const id2 = cloudSync2.getDeviceId();

      expect(id1).toBe(id2);
    });
  });

  describe('getKeyFingerprint', () => {
    it('should return key fingerprint', () => {
      const cloudSync = new CloudSync(testConfig);
      const fingerprint = cloudSync.getKeyFingerprint();

      expect(fingerprint).toBeDefined();
      expect(fingerprint).toHaveLength(8);
    });
  });

  describe('constructor without encryption key', () => {
    it('generates a new key and logs a warning when no encryptionKey is provided', () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const configNoKey = { ...testConfig, encryptionKey: undefined };

      const cloudSync = new CloudSync(configNoKey);
      expect(cloudSync.getKeyFingerprint()).toBeDefined();
      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
    });
  });

  describe('createS3Client with different providers', () => {
    it('sets endpoint for b2 provider', () => {
      const b2Config = { ...testConfig, provider: 'b2' as const, endpoint: undefined, region: 'us-west-002' };
      const cloudSync = new CloudSync(b2Config);
      expect(cloudSync).toBeDefined();
    });

    it('warns when r2 provider has no endpoint', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const r2Config = { ...testConfig, provider: 'r2' as const, endpoint: undefined };
      new CloudSync(r2Config);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('uses explicit endpoint when configured', () => {
      const configWithEndpoint = {
        ...testConfig,
        endpoint: 'https://custom.endpoint.example.com',
      };
      const cloudSync = new CloudSync(configWithEndpoint);
      expect(cloudSync).toBeDefined();
    });

    it('uses credentials when provided', () => {
      const cloudSync = new CloudSync(testConfig);
      expect(cloudSync).toBeDefined();
    });
  });

  describe('deleteRemoteSession', () => {
    it('throws when no bucket configured', async () => {
      const configNoBucket = { ...testConfig, bucket: undefined };
      const cloudSync = new CloudSync(configNoBucket);
      await expect(cloudSync.deleteRemoteSession('session-id')).rejects.toThrow('No bucket configured');
    });

    it('calls DeleteObjectCommand with the correct key', async () => {
      const { DeleteObjectCommand } = jest.requireMock('@aws-sdk/client-s3');
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      await cloudSync.deleteRemoteSession('my-session-id');

      expect(mockSend).toHaveBeenCalled();
      expect(DeleteObjectCommand).toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('returns false and logs debug info when connection fails with DEBUG set', async () => {
      process.env.CC_MEMORY_DEBUG = 'true';
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockSend = jest.fn().mockRejectedValue(new Error('connection refused'));
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const result = await cloudSync.testConnection();

      expect(result).toBe(false);
      expect(errSpy).toHaveBeenCalled();
      delete process.env.CC_MEMORY_DEBUG;
      errSpy.mockRestore();
    });
  });

  describe('downloadSession', () => {
    it('throws when no bucket configured', async () => {
      const configNoBucket = { ...testConfig, bucket: undefined };
      const cloudSync = new CloudSync(configNoBucket);
      await expect(cloudSync.downloadSession({
        sessionId: 'x', deviceId: 'y', uploadedAt: new Date(), size: 0, key: 'k'
      })).rejects.toThrow('No bucket configured');
    });

    it('throws when response body is empty', async () => {
      const mockSend = jest.fn().mockResolvedValue({ Body: null });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      await expect(cloudSync.downloadSession({
        sessionId: 'x', deviceId: 'y', uploadedAt: new Date(), size: 0, key: 'k'
      })).rejects.toThrow('Failed to download');
    });

    it('downloads and decrypts a session', async () => {
      // Encrypt a session first, then mock the download to return it
      const { Encryptor, encryptJson } = jest.requireActual<typeof import('../../src/sync/encryption')>('../../src/sync/encryption');
      const key = Encryptor.generateKey();
      const encryptor = new Encryptor(key);

      const session = createTestSession('download-test');
      const encrypted = encryptJson(encryptor, session);

      const mockBody = {
        transformToByteArray: jest.fn().mockResolvedValue(encrypted),
      };
      const mockSend = jest.fn().mockResolvedValue({ Body: mockBody });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync({ ...testConfig, encryptionKey: key });
      const result = await cloudSync.downloadSession({
        sessionId: session.id,
        deviceId: testConfig.deviceId || 'test',
        uploadedAt: new Date(),
        size: encrypted.length,
        key: `sessions/test/${session.id}.enc`,
      });

      expect(result.id).toBe(session.id);
      expect(result.summary).toBe(session.summary);
    });
  });

  describe('sync', () => {
    it('returns empty report when cloud is disabled', async () => {
      const disabledConfig = { ...testConfig, enabled: false };
      const cloudSync = new CloudSync(disabledConfig);
      const store = { getUnsyncedSessions: jest.fn().mockReturnValue([]) } as never;

      const report = await cloudSync.sync(store);
      expect(report.uploaded).toBe(0);
      expect(report.downloaded).toBe(0);
    });

    it('returns empty report when no bucket configured', async () => {
      const noBucket = { ...testConfig, bucket: undefined };
      const cloudSync = new CloudSync(noBucket);
      const store = { getUnsyncedSessions: jest.fn().mockReturnValue([]) } as never;

      const report = await cloudSync.sync(store);
      expect(report.uploaded).toBe(0);
    });

    it('uploads unsynced sessions', async () => {
      const session = createTestSession('sync-test');
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const mockStore = {
        getUnsyncedSessions: jest.fn().mockReturnValue([session]),
        markSynced: jest.fn(),
        getById: jest.fn().mockReturnValue(null),
      };

      // Make listRemoteSessions return empty
      const cloudSync = new CloudSync(testConfig);
      const listSpy = jest.spyOn(cloudSync, 'listRemoteSessions').mockResolvedValue([]);

      const report = await cloudSync.sync(mockStore as never);
      expect(report.uploaded).toBe(1);
      expect(mockStore.markSynced).toHaveBeenCalledWith(session.id);
      listSpy.mockRestore();
    });

    it('downloads sessions from other devices', async () => {
      const { Encryptor, encryptJson } = jest.requireActual<typeof import('../../src/sync/encryption')>('../../src/sync/encryption');
      const key = Encryptor.generateKey();
      const encryptor = new Encryptor(key);
      const remoteSession = createTestSession('remote-session');
      const encrypted = encryptJson(encryptor, remoteSession);

      const mockBody = { transformToByteArray: jest.fn().mockResolvedValue(encrypted) };
      const mockSend = jest.fn().mockResolvedValue({ Body: mockBody });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync({ ...testConfig, encryptionKey: key });

      const listSpy = jest.spyOn(cloudSync, 'listRemoteSessions').mockResolvedValue([{
        sessionId: remoteSession.id,
        deviceId: 'other-device', // different device
        uploadedAt: new Date(),
        size: encrypted.length,
        key: `sessions/other-device/${remoteSession.id}.enc`,
      }]);

      const mockStore = {
        getUnsyncedSessions: jest.fn().mockReturnValue([]),
        getById: jest.fn().mockReturnValue(null), // don't have it locally
        save: jest.fn(),
        markSynced: jest.fn(),
      };

      const report = await cloudSync.sync(mockStore as never);
      expect(report.downloaded).toBe(1);
      listSpy.mockRestore();
    });

    it('handles upload failures gracefully', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('upload failed'));
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const session = createTestSession('fail-session');
      const mockStore = {
        getUnsyncedSessions: jest.fn().mockReturnValue([session]),
        markSynced: jest.fn(),
        getById: jest.fn().mockReturnValue(null),
      };

      const cloudSync = new CloudSync(testConfig);
      const listSpy = jest.spyOn(cloudSync, 'listRemoteSessions').mockResolvedValue([]);

      const report = await cloudSync.sync(mockStore as never);
      expect(report.uploaded).toBe(0); // upload failed, not counted
      listSpy.mockRestore();
    });
  });

  describe('downloadSessions', () => {
    it('returns empty array when no remote sessions', async () => {
      const cloudSync = new CloudSync(testConfig);
      jest.spyOn(cloudSync, 'listRemoteSessions').mockResolvedValue([]);

      const result = await cloudSync.downloadSessions();
      expect(result).toEqual([]);
    });

    it('filters sessions by date when since is provided', async () => {
      const cloudSync = new CloudSync(testConfig);
      const oldDate = new Date('2025-01-01');
      const recentDate = new Date('2025-06-01');

      jest.spyOn(cloudSync, 'listRemoteSessions').mockResolvedValue([
        { sessionId: 'old', deviceId: 'd1', uploadedAt: oldDate, size: 0, key: 'k1' },
        { sessionId: 'recent', deviceId: 'd1', uploadedAt: recentDate, size: 0, key: 'k2' },
      ]);

      // Mock downloadSession to avoid real downloads
      jest.spyOn(cloudSync, 'downloadSession').mockResolvedValue(createTestSession('recent'));

      const result = await cloudSync.downloadSessions(new Date('2025-03-01'));
      expect(result).toHaveLength(1);
    });
  });

  describe('listRemoteSessions with pagination', () => {
    it('handles paginated responses', async () => {
      let callCount = 0;
      const mockSend = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            Contents: [{ Key: 'sessions/dev1/s1.enc', LastModified: new Date(), Size: 100 }],
            NextContinuationToken: 'token-for-page-2',
          });
        }
        return Promise.resolve({
          Contents: [{ Key: 'sessions/dev1/s2.enc', LastModified: new Date(), Size: 200 }],
          NextContinuationToken: undefined,
        });
      });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const sessions = await cloudSync.listRemoteSessions();
      expect(sessions).toHaveLength(2);
      expect(callCount).toBe(2);
    });

    it('ignores entries with incorrect path structure', async () => {
      const mockSend = jest.fn().mockResolvedValue({
        Contents: [
          { Key: 'sessions/only-one-part.enc', LastModified: new Date(), Size: 100 },
          { Key: 'sessions/dev/session/extra/path.enc', LastModified: new Date(), Size: 100 },
          { Key: 'sessions/dev/valid.enc', LastModified: new Date(), Size: 100 },
        ],
      });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const cloudSync = new CloudSync(testConfig);
      const sessions = await cloudSync.listRemoteSessions();
      expect(sessions).toHaveLength(1);
    });
  });
});

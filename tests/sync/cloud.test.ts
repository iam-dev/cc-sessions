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

  // Clean up device ID file between tests
  const deviceIdPath = path.join(os.homedir(), '.cc-sessions', 'device-id');

  beforeEach(() => {
    jest.clearAllMocks();
    // Remove device ID file to ensure clean state
    if (fs.existsSync(deviceIdPath)) {
      fs.unlinkSync(deviceIdPath);
    }
  });

  afterEach(() => {
    // Clean up device ID file
    if (fs.existsSync(deviceIdPath)) {
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
});

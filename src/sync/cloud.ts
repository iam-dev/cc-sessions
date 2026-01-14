/**
 * Cloud Sync for cc-sessions
 *
 * S3-compatible cloud storage with end-to-end encryption.
 * Supports AWS S3, Cloudflare R2, and Backblaze B2.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand
} from '@aws-sdk/client-s3';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import type { CloudConfig, SessionMemory, SyncReport } from '../types';
import { Encryptor, encryptJson, decryptJson } from './encryption';
import { SessionStore } from '../store/sessions';

/**
 * Remote session metadata
 */
export interface RemoteSessionInfo {
  sessionId: string;
  deviceId: string;
  uploadedAt: Date;
  size: number;
  key: string;
}

/**
 * Provider-specific S3 endpoint configurations
 */
const PROVIDER_ENDPOINTS: Record<string, string | undefined> = {
  r2: undefined, // Set via endpoint in config
  s3: undefined, // Uses AWS default
  b2: undefined  // Set via endpoint in config
};

/**
 * Device ID file path
 */
const DEVICE_ID_PATH = path.join(os.homedir(), '.cc-sessions', 'device-id');

export class CloudSync {
  private client: S3Client;
  private config: CloudConfig;
  private encryptor: Encryptor;
  private deviceId: string;

  constructor(config: CloudConfig) {
    this.config = config;
    this.deviceId = this.getOrGenerateDeviceId();

    // Initialize encryptor
    if (config.encryptionKey) {
      this.encryptor = new Encryptor(config.encryptionKey);
    } else {
      // Generate and save a new key
      const newKey = Encryptor.generateKey();
      this.encryptor = new Encryptor(newKey);
      console.log('cc-sessions: Generated new encryption key. Save this in your config:');
      console.log(`  encryptionKey: "${newKey}"`);
    }

    // Initialize S3 client
    this.client = this.createS3Client();
  }

  /**
   * Create S3 client based on provider
   */
  private createS3Client(): S3Client {
    const clientConfig: {
      region: string;
      endpoint?: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
      };
    } = {
      region: this.config.region || 'auto'
    };

    // Set endpoint for non-AWS providers
    if (this.config.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
    } else if (this.config.provider === 'r2') {
      // R2 requires account ID in endpoint
      console.warn('cc-sessions: R2 endpoint not configured. Please set cloud.endpoint in config.');
    } else if (this.config.provider === 'b2') {
      // B2 uses region-specific endpoint
      const region = this.config.region || 'us-west-002';
      clientConfig.endpoint = `https://s3.${region}.backblazeb2.com`;
    }

    // Set credentials if provided
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey
      };
    }

    return new S3Client(clientConfig);
  }

  /**
   * Get or generate a unique device ID
   */
  private getOrGenerateDeviceId(): string {
    if (this.config.deviceId && this.config.deviceId !== 'auto') {
      return this.config.deviceId;
    }

    // Try to read existing device ID
    if (fs.existsSync(DEVICE_ID_PATH)) {
      try {
        return fs.readFileSync(DEVICE_ID_PATH, 'utf-8').trim();
      } catch {
        // Fall through to generate new ID
      }
    }

    // Generate new device ID
    const deviceId = this.generateDeviceId();

    // Save to file
    const dir = path.dirname(DEVICE_ID_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DEVICE_ID_PATH, deviceId, 'utf-8');

    return deviceId;
  }

  /**
   * Generate a unique device ID
   */
  private generateDeviceId(): string {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const random = crypto.randomBytes(4).toString('hex');
    return `${hostname}_${random}`;
  }

  /**
   * Get the current device ID
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Get the S3 key for a session
   */
  private getSessionKey(sessionId: string): string {
    return `sessions/${this.deviceId}/${sessionId}.enc`;
  }

  /**
   * Test connection to cloud storage
   */
  async testConnection(): Promise<boolean> {
    if (!this.config.bucket) {
      console.error('cc-sessions: No bucket configured');
      return false;
    }

    try {
      await this.client.send(new HeadBucketCommand({
        Bucket: this.config.bucket
      }));
      return true;
    } catch (error) {
      if (process.env.CC_MEMORY_DEBUG) {
        console.error('cc-sessions: Connection test failed:', error);
      }
      return false;
    }
  }

  /**
   * Upload a session to cloud storage
   */
  async uploadSession(session: SessionMemory): Promise<void> {
    if (!this.config.bucket) {
      throw new Error('No bucket configured for cloud sync');
    }

    // Encrypt session data
    const encrypted = encryptJson(this.encryptor, session);
    const key = this.getSessionKey(session.id);

    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: encrypted,
      ContentType: 'application/octet-stream',
      Metadata: {
        'x-session-id': session.id,
        'x-device-id': this.deviceId,
        'x-timestamp': session.startedAt.toISOString(),
        'x-key-fingerprint': this.encryptor.getKeyFingerprint()
      }
    }));

    if (process.env.CC_MEMORY_DEBUG) {
      console.log(`cc-sessions: Uploaded session ${session.id} to cloud`);
    }
  }

  /**
   * Download a session from cloud storage
   */
  async downloadSession(info: RemoteSessionInfo): Promise<SessionMemory> {
    if (!this.config.bucket) {
      throw new Error('No bucket configured for cloud sync');
    }

    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: info.key
    }));

    if (!response.Body) {
      throw new Error(`Failed to download session ${info.sessionId}: empty response`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    // @ts-expect-error - response.Body is a stream
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const encrypted = Buffer.concat(chunks);

    // Decrypt
    const session = decryptJson<SessionMemory>(this.encryptor, encrypted);

    // Restore Date objects
    session.startedAt = new Date(session.startedAt);
    session.endedAt = new Date(session.endedAt);
    if (session.archivedAt) {
      session.archivedAt = new Date(session.archivedAt);
    }
    if (session.syncedAt) {
      session.syncedAt = new Date(session.syncedAt);
    }

    return session;
  }

  /**
   * List all sessions in cloud storage
   */
  async listRemoteSessions(): Promise<RemoteSessionInfo[]> {
    if (!this.config.bucket) {
      throw new Error('No bucket configured for cloud sync');
    }

    const sessions: RemoteSessionInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: 'sessions/',
        ContinuationToken: continuationToken
      }));

      for (const obj of response.Contents || []) {
        if (!obj.Key || !obj.Key.endsWith('.enc')) continue;

        // Parse key: sessions/{deviceId}/{sessionId}.enc
        const parts = obj.Key.split('/');
        if (parts.length !== 3) continue;

        const deviceId = parts[1];
        const sessionId = parts[2].replace('.enc', '');

        sessions.push({
          sessionId,
          deviceId,
          uploadedAt: obj.LastModified || new Date(),
          size: obj.Size || 0,
          key: obj.Key
        });
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return sessions;
  }

  /**
   * Delete a session from cloud storage
   */
  async deleteRemoteSession(sessionId: string): Promise<void> {
    if (!this.config.bucket) {
      throw new Error('No bucket configured for cloud sync');
    }

    const key = this.getSessionKey(sessionId);

    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    }));
  }

  /**
   * Perform full sync with cloud storage
   */
  async sync(store: SessionStore): Promise<SyncReport> {
    const report: SyncReport = {
      uploaded: 0,
      downloaded: 0,
      conflicts: 0
    };

    if (!this.config.enabled) {
      return report;
    }

    if (!this.config.bucket) {
      console.error('cc-sessions: No bucket configured for cloud sync');
      return report;
    }

    try {
      // Step 1: Upload unsynced local sessions
      const unsynced = store.getUnsyncedSessions();

      for (const session of unsynced) {
        try {
          await this.uploadSession(session);
          store.markSynced(session.id);
          report.uploaded++;
        } catch (error) {
          if (process.env.CC_MEMORY_DEBUG) {
            console.error(`cc-sessions: Failed to upload session ${session.id}:`, error);
          }
        }
      }

      // Step 2: Download sessions from other devices
      const remoteSessions = await this.listRemoteSessions();

      for (const info of remoteSessions) {
        // Skip our own uploads
        if (info.deviceId === this.deviceId) continue;

        // Check if we already have this session
        const local = store.getById(info.sessionId);
        if (local) {
          // Already have it
          continue;
        }

        try {
          const session = await this.downloadSession(info);
          // Mark as synced since it came from cloud
          session.synced = true;
          session.syncedAt = new Date();
          store.save(session);
          report.downloaded++;
        } catch (error) {
          if (process.env.CC_MEMORY_DEBUG) {
            console.error(`cc-sessions: Failed to download session ${info.sessionId}:`, error);
          }
        }
      }

      if (process.env.CC_MEMORY_DEBUG) {
        console.log(`cc-sessions: Sync complete - uploaded: ${report.uploaded}, downloaded: ${report.downloaded}`);
      }

    } catch (error) {
      console.error('cc-sessions: Sync failed:', error);
    }

    return report;
  }

  /**
   * Download sessions since a specific date
   */
  async downloadSessions(since?: Date): Promise<SessionMemory[]> {
    const sessions: SessionMemory[] = [];
    const remoteSessions = await this.listRemoteSessions();

    for (const info of remoteSessions) {
      // Filter by date if specified
      if (since && info.uploadedAt < since) {
        continue;
      }

      try {
        const session = await this.downloadSession(info);
        sessions.push(session);
      } catch (error) {
        if (process.env.CC_MEMORY_DEBUG) {
          console.error(`cc-sessions: Failed to download session ${info.sessionId}:`, error);
        }
      }
    }

    return sessions;
  }

  /**
   * Get the encryption key fingerprint (for verification)
   */
  getKeyFingerprint(): string {
    return this.encryptor.getKeyFingerprint();
  }
}

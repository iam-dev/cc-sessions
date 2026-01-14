/**
 * End-to-End Encryption for cc-sessions Cloud Sync
 *
 * Uses AES-256-GCM for authenticated encryption.
 * Format: | IV (16 bytes) | Auth Tag (16 bytes) | Encrypted Data |
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

export class Encryptor {
  private key: Buffer;

  /**
   * Create an Encryptor with the given key
   * @param key - Hex-encoded 256-bit key, or undefined to auto-generate
   */
  constructor(key?: string) {
    if (key) {
      this.key = Buffer.from(key, 'hex');
      if (this.key.length !== KEY_LENGTH) {
        throw new Error(`Invalid key length: expected ${KEY_LENGTH} bytes, got ${this.key.length}`);
      }
    } else {
      this.key = crypto.randomBytes(KEY_LENGTH);
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   * @param data - String data to encrypt
   * @returns Buffer containing: IV (16) + AuthTag (16) + EncryptedData
   */
  encrypt(data: string): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    // Format: IV + AuthTag + EncryptedData
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypt data encrypted with AES-256-GCM
   * @param data - Buffer containing IV + AuthTag + EncryptedData
   * @returns Decrypted string
   */
  decrypt(data: Buffer): string {
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data: too short');
    }

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Generate a new 256-bit encryption key
   * @returns Hex-encoded key string
   */
  static generateKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
  }

  /**
   * Derive a key from a password using PBKDF2
   * @param password - User password
   * @param salt - Salt buffer (should be stored alongside encrypted data)
   * @returns Hex-encoded derived key
   */
  static deriveKey(password: string, salt: Buffer): string {
    const key = crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
    return key.toString('hex');
  }

  /**
   * Generate a random salt for key derivation
   * @returns 16-byte salt buffer
   */
  static generateSalt(): Buffer {
    return crypto.randomBytes(16);
  }

  /**
   * Get the current key as a hex string (for storage)
   */
  getKeyHex(): string {
    return this.key.toString('hex');
  }

  /**
   * Get a fingerprint of the key (for verification without exposing the key)
   * @returns First 8 characters of SHA-256 hash of the key
   */
  getKeyFingerprint(): string {
    const hash = crypto.createHash('sha256').update(this.key).digest('hex');
    return hash.slice(0, 8);
  }

  /**
   * Validate that the key is properly formatted
   */
  validateKey(): boolean {
    return this.key.length === KEY_LENGTH;
  }

  /**
   * Create an Encryptor from a password (derives key from password)
   * @param password - User password
   * @param salt - Salt buffer
   */
  static fromPassword(password: string, salt: Buffer): Encryptor {
    const keyHex = Encryptor.deriveKey(password, salt);
    return new Encryptor(keyHex);
  }
}

/**
 * Utility function to encrypt a JSON object
 */
export function encryptJson(encryptor: Encryptor, obj: unknown): Buffer {
  const json = JSON.stringify(obj);
  return encryptor.encrypt(json);
}

/**
 * Utility function to decrypt a JSON object
 */
export function decryptJson<T>(encryptor: Encryptor, data: Buffer): T {
  const json = encryptor.decrypt(data);
  return JSON.parse(json) as T;
}

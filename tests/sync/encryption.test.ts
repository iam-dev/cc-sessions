/**
 * Tests for the Encryption module
 */

import { Encryptor, encryptJson, decryptJson } from '../../src/sync/encryption';

describe('Encryptor', () => {
  describe('constructor', () => {
    it('should create encryptor with provided key', () => {
      const key = Encryptor.generateKey();
      const encryptor = new Encryptor(key);
      expect(encryptor.validateKey()).toBe(true);
      expect(encryptor.getKeyHex()).toBe(key);
    });

    it('should auto-generate key if not provided', () => {
      const encryptor = new Encryptor();
      expect(encryptor.validateKey()).toBe(true);
      expect(encryptor.getKeyHex()).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it('should throw error for invalid key length', () => {
      expect(() => new Encryptor('tooshort')).toThrow('Invalid key length');
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt data correctly', () => {
      const encryptor = new Encryptor();
      const plaintext = 'Hello, World!';

      const encrypted = encryptor.encrypt(plaintext);
      const decrypted = encryptor.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const encryptor = new Encryptor();
      const plaintext = 'Test message';

      const encrypted1 = encryptor.encrypt(plaintext);
      const encrypted2 = encryptor.encrypt(plaintext);

      // Different IVs should produce different ciphertext
      expect(encrypted1.equals(encrypted2)).toBe(false);

      // But both should decrypt to the same plaintext
      expect(encryptor.decrypt(encrypted1)).toBe(plaintext);
      expect(encryptor.decrypt(encrypted2)).toBe(plaintext);
    });

    it('should fail decryption with wrong key', () => {
      const encryptor1 = new Encryptor();
      const encryptor2 = new Encryptor(); // Different key

      const plaintext = 'Secret message';
      const encrypted = encryptor1.encrypt(plaintext);

      expect(() => encryptor2.decrypt(encrypted)).toThrow();
    });

    it('should handle empty strings', () => {
      const encryptor = new Encryptor();
      const plaintext = '';

      const encrypted = encryptor.encrypt(plaintext);
      const decrypted = encryptor.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle large data', () => {
      const encryptor = new Encryptor();
      // 100KB of data
      const plaintext = 'x'.repeat(100 * 1024);

      const encrypted = encryptor.encrypt(plaintext);
      const decrypted = encryptor.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const encryptor = new Encryptor();
      const plaintext = 'Hello 世界! 🎉 émojis';

      const encrypted = encryptor.encrypt(plaintext);
      const decrypted = encryptor.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw for invalid encrypted data (too short)', () => {
      const encryptor = new Encryptor();
      const invalidData = Buffer.from('tooshort');

      expect(() => encryptor.decrypt(invalidData)).toThrow('Invalid encrypted data: too short');
    });
  });

  describe('key management', () => {
    it('should generate valid 256-bit keys', () => {
      const key = Encryptor.generateKey();

      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]+$/.test(key)).toBe(true);
    });

    it('should generate unique keys each time', () => {
      const key1 = Encryptor.generateKey();
      const key2 = Encryptor.generateKey();

      expect(key1).not.toBe(key2);
    });

    it('should derive consistent keys from password', () => {
      const password = 'my-secure-password';
      const salt = Encryptor.generateSalt();

      const key1 = Encryptor.deriveKey(password, salt);
      const key2 = Encryptor.deriveKey(password, salt);

      expect(key1).toBe(key2);
    });

    it('should derive different keys for different passwords', () => {
      const salt = Encryptor.generateSalt();

      const key1 = Encryptor.deriveKey('password1', salt);
      const key2 = Encryptor.deriveKey('password2', salt);

      expect(key1).not.toBe(key2);
    });

    it('should derive different keys for different salts', () => {
      const password = 'same-password';

      const key1 = Encryptor.deriveKey(password, Encryptor.generateSalt());
      const key2 = Encryptor.deriveKey(password, Encryptor.generateSalt());

      expect(key1).not.toBe(key2);
    });
  });

  describe('getKeyFingerprint', () => {
    it('should return consistent fingerprint for same key', () => {
      const key = Encryptor.generateKey();
      const encryptor = new Encryptor(key);

      const fp1 = encryptor.getKeyFingerprint();
      const fp2 = encryptor.getKeyFingerprint();

      expect(fp1).toBe(fp2);
    });

    it('should return different fingerprints for different keys', () => {
      const encryptor1 = new Encryptor();
      const encryptor2 = new Encryptor();

      expect(encryptor1.getKeyFingerprint()).not.toBe(encryptor2.getKeyFingerprint());
    });

    it('should return 8 character fingerprint', () => {
      const encryptor = new Encryptor();
      const fp = encryptor.getKeyFingerprint();

      expect(fp).toHaveLength(8);
      expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
    });
  });

  describe('fromPassword', () => {
    it('should create encryptor from password', () => {
      const password = 'my-password';
      const salt = Encryptor.generateSalt();

      const encryptor = Encryptor.fromPassword(password, salt);

      expect(encryptor.validateKey()).toBe(true);
    });

    it('should encrypt/decrypt with password-derived key', () => {
      const password = 'test-password';
      const salt = Encryptor.generateSalt();

      const encryptor = Encryptor.fromPassword(password, salt);
      const plaintext = 'Secret data';

      const encrypted = encryptor.encrypt(plaintext);
      const decrypted = encryptor.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });
});

describe('JSON utilities', () => {
  describe('encryptJson / decryptJson', () => {
    it('should encrypt and decrypt JSON objects', () => {
      const encryptor = new Encryptor();
      const obj = {
        name: 'Test',
        value: 123,
        nested: { array: [1, 2, 3] }
      };

      const encrypted = encryptJson(encryptor, obj);
      const decrypted = decryptJson<typeof obj>(encryptor, encrypted);

      expect(decrypted).toEqual(obj);
    });

    it('should handle complex objects', () => {
      const encryptor = new Encryptor();
      const obj = {
        id: 'test-123',
        timestamp: new Date().toISOString(),
        data: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ],
          metadata: {
            version: '1.0.0',
            flags: [true, false, true]
          }
        }
      };

      const encrypted = encryptJson(encryptor, obj);
      const decrypted = decryptJson<typeof obj>(encryptor, encrypted);

      expect(decrypted).toEqual(obj);
    });
  });
});

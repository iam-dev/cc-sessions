---
layout: default
title: Cloud Sync
nav_order: 5
---

# Cloud Sync (Pro Feature)

Sync your session memories across devices with end-to-end encryption.

## Overview

Cloud Sync enables:
- **Cross-device access** - Access sessions from any machine
- **Backup** - Never lose your session history
- **Team sharing** - Share sessions with team members (coming soon)

All data is encrypted client-side using AES-256-GCM before upload.

## Supported Providers

| Provider | Description | Pricing |
|----------|-------------|---------|
| **Cloudflare R2** | S3-compatible, no egress fees | Free tier available |
| **AWS S3** | Industry standard | Pay per use |
| **Backblaze B2** | Low-cost storage | $0.005/GB/month |

## Setup

### 1. Create a Bucket

#### Cloudflare R2

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > R2
2. Create a new bucket (e.g., `cc-sessions`)
3. Create an API token with read/write access
4. Note your Account ID

#### AWS S3

1. Go to [AWS S3 Console](https://s3.console.aws.amazon.com/)
2. Create a new bucket
3. Create an IAM user with S3 access
4. Generate access keys

#### Backblaze B2

1. Go to [Backblaze B2](https://www.backblaze.com/b2/)
2. Create a new bucket
3. Create an application key
4. Note your key ID and application key

### 2. Configure cc-sessions

Edit `~/.cc-sessions/config.yml`:

#### Cloudflare R2

```yaml
cloud:
  enabled: true
  provider: r2
  bucket: cc-sessions
  endpoint: https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
  access_key_id: YOUR_R2_ACCESS_KEY
  secret_access_key: YOUR_R2_SECRET_KEY
  sync_on_save: true
```

#### AWS S3

```yaml
cloud:
  enabled: true
  provider: s3
  bucket: my-cc-sessions-bucket
  region: us-east-1
  access_key_id: YOUR_AWS_ACCESS_KEY
  secret_access_key: YOUR_AWS_SECRET_KEY
  sync_on_save: true
```

#### Backblaze B2

```yaml
cloud:
  enabled: true
  provider: b2
  bucket: cc-sessions
  region: us-west-002
  endpoint: https://s3.us-west-002.backblazeb2.com
  access_key_id: YOUR_B2_KEY_ID
  secret_access_key: YOUR_B2_APPLICATION_KEY
  sync_on_save: true
```

### 3. Set Encryption Key

On first run, cc-sessions will generate an encryption key:

```
cc-sessions: Generated new encryption key. Save this in your config:
  encryptionKey: "a1b2c3d4e5f6..."
```

**Important:** Save this key! Without it, you cannot decrypt your cloud data.

Add to your config:

```yaml
cloud:
  encryption_key: "a1b2c3d4e5f6..."
```

## Encryption

### How It Works

1. Session data is serialized to JSON
2. A random 16-byte IV is generated
3. Data is encrypted using AES-256-GCM
4. Auth tag is appended for integrity verification
5. Format: `IV (16 bytes) | Auth Tag (16 bytes) | Encrypted Data`

### Key Management

- **Auto-generated**: 256-bit key created on first use
- **Fingerprint**: 8-character identifier for key verification
- **Password derivation**: Optional, derive key from password using PBKDF2

```yaml
# Using direct key (recommended)
cloud:
  encryption_key: "your-64-char-hex-key"

# Key fingerprint shown in logs
# cc-sessions: Using encryption key: a1b2c3d4
```

### Security Best Practices

1. **Backup your encryption key** - Store securely (password manager, encrypted note)
2. **Use unique buckets** - Don't share bucket with other applications
3. **Enable bucket versioning** - Protect against accidental deletion
4. **Set bucket policies** - Restrict access to your credentials only

## Sync Behavior

### Automatic Sync

When `sync_on_save: true`:
1. Session ends normally
2. Session is saved locally
3. Session is encrypted and uploaded to cloud
4. Session is marked as synced

### Manual Sync

Trigger sync via CLI:

```bash
cc-sessions sync
```

### Conflict Resolution

- Sessions are identified by unique ID
- Same session from same device: newer wins
- Same session from different device: both kept (conflict marker)

## Multi-Device Setup

### Device IDs

Each device gets a unique identifier:

```yaml
cloud:
  device_id: auto  # Auto-generated
  # or
  device_id: my-laptop  # Custom name
```

Device ID is stored in `~/.cc-sessions/device-id`.

### Syncing Across Devices

1. Configure cloud settings on each device
2. Use the **same encryption key** on all devices
3. Sessions sync automatically

```
Device A (laptop)                   Device B (desktop)
     │                                    │
     ├──► Upload session-123 ─────────────┤
     │                                    │
     │    ┌─────────────────────────┐    │
     │    │      Cloud Bucket       │    │
     │    │  sessions/laptop/...    │    │
     │    │  sessions/desktop/...   │    │
     │    └─────────────────────────┘    │
     │                                    │
     ├──◄ Download session-456 ◄──────────┤
     │                                    │
```

## Storage Structure

```
bucket/
├── sessions/
│   ├── laptop_a1b2/
│   │   ├── mem_abc123.enc
│   │   └── mem_def456.enc
│   └── desktop_c3d4/
│       ├── mem_ghi789.enc
│       └── mem_jkl012.enc
```

## Troubleshooting

### Connection Failed

```bash
# Test connection
CC_MEMORY_DEBUG=true cc-sessions sync
```

Check:
- Endpoint URL is correct
- Credentials are valid
- Bucket exists and is accessible

### Decryption Failed

- Verify encryption key matches across devices
- Check key fingerprint in logs
- Ensure data wasn't corrupted

### Sync Not Working

1. Check `cloud.enabled: true`
2. Verify `cloud.sync_on_save: true`
3. Check for errors: `CC_MEMORY_DEBUG=true`

## Cost Estimation

| Sessions/month | Data size | R2 | S3 | B2 |
|----------------|-----------|-----|-----|-----|
| 100 | ~50 MB | Free | ~$0.01 | ~$0.01 |
| 500 | ~250 MB | Free | ~$0.05 | ~$0.01 |
| 2000 | ~1 GB | Free | ~$0.02 | ~$0.01 |

*Estimates based on ~500KB per session average*

## API Usage

```typescript
import { CloudSync, loadConfig } from '@iam-dev/cc-sessions';

const config = await loadConfig();
const cloudSync = new CloudSync(config.cloud);

// Test connection
const connected = await cloudSync.testConnection();

// Upload a session
await cloudSync.uploadSession(session);

// List remote sessions
const remote = await cloudSync.listRemoteSessions();

// Full sync
const report = await cloudSync.sync(store);
console.log(`Uploaded: ${report.uploaded}, Downloaded: ${report.downloaded}`);
```

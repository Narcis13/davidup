/**
 * Asset store service for managing uploaded files.
 * Handles validation, storage, and retrieval of image and audio assets.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Metadata for a stored asset.
 */
export interface StoredAsset {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: number;
  userId: string;
}

/**
 * Options for uploading an asset.
 */
export interface AssetUploadOptions {
  userId: string;
  file: {
    name: string;
    type: string;
    data: Buffer;
  };
}

/**
 * Allowed MIME types and their file extensions.
 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/mp3': '.mp3', // Some browsers send audio/mp3
};

/**
 * Maximum file size: 50MB
 */
const MAX_SIZE = 50 * 1024 * 1024;

/**
 * Manages file uploads and storage.
 * Validates file types and sizes, stores files to disk, and tracks metadata.
 */
export class AssetStore {
  private assets = new Map<string, StoredAsset>();
  private uploadDir: string;

  constructor(uploadDir = './uploads') {
    this.uploadDir = uploadDir;
  }

  /**
   * Initialize the asset store by creating the upload directory.
   */
  async init(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true });
  }

  /**
   * Save an uploaded file.
   * @param options Upload options containing userId and file data
   * @returns The stored asset metadata
   * @throws Error if file type is invalid or file exceeds size limit
   */
  async save(options: AssetUploadOptions): Promise<StoredAsset> {
    const { userId, file } = options;

    // Validate type
    const extension = ALLOWED_TYPES[file.type];
    if (!extension) {
      throw new Error(`Invalid file type: ${file.type}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`);
    }

    // Validate size
    if (file.data.length > MAX_SIZE) {
      throw new Error(`File too large: ${file.data.length} bytes. Maximum: ${MAX_SIZE} bytes`);
    }

    const id = randomUUID();
    const filename = `${id}${extension}`;
    const filePath = path.join(this.uploadDir, filename);

    await fs.writeFile(filePath, file.data);

    const asset: StoredAsset = {
      id,
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.data.length,
      path: filePath,
      createdAt: Date.now(),
      userId,
    };

    this.assets.set(id, asset);
    return asset;
  }

  /**
   * Get asset metadata by ID.
   * @param id Asset ID
   * @returns Asset metadata or undefined if not found
   */
  get(id: string): StoredAsset | undefined {
    return this.assets.get(id);
  }

  /**
   * Get the file path for an asset.
   * @param id Asset ID
   * @returns File path or undefined if not found
   */
  getPath(id: string): string | undefined {
    return this.assets.get(id)?.path;
  }

  /**
   * Delete an asset and its file.
   * @param id Asset ID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const asset = this.assets.get(id);
    if (!asset) return false;

    try {
      await fs.unlink(asset.path);
    } catch {
      // File may already be deleted
    }

    this.assets.delete(id);
    return true;
  }

  /**
   * Get list of allowed MIME types.
   */
  static getAllowedTypes(): string[] {
    return Object.keys(ALLOWED_TYPES);
  }

  /**
   * Get maximum file size in bytes.
   */
  static getMaxSize(): number {
    return MAX_SIZE;
  }
}

// Singleton instance for use across the application
export const assetStore = new AssetStore();

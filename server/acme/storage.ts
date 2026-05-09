import fs from 'fs/promises';
import path from 'path';

export interface CertStorageProvider {
  saveFile(filename: string, content: Buffer | string): Promise<void>;
  readFile(filename: string): Promise<Buffer>;
  listFiles(): Promise<string[]>;
  fileExists(filename: string): Promise<boolean>;
}

export class LocalFsStorage implements CertStorageProvider {
  private baseDir: string;

  constructor(baseDir: string = './data') {
    this.baseDir = path.resolve(process.cwd(), baseDir);
  }

  private async ensureDir() {
    try {
      await fs.access(this.baseDir);
    } catch {
      await fs.mkdir(this.baseDir, { recursive: true });
    }
  }

  async saveFile(filename: string, content: Buffer | string): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.baseDir, filename);
    await fs.writeFile(filePath, content);
  }

  async readFile(filename: string): Promise<Buffer> {
    const filePath = path.join(this.baseDir, filename);
    return await fs.readFile(filePath);
  }

  async listFiles(): Promise<string[]> {
    await this.ensureDir();
    return await fs.readdir(this.baseDir);
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.baseDir, filename);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// Defaults
export const certStorage = new LocalFsStorage('./certs');
export const dataStorage = new LocalFsStorage('./data');

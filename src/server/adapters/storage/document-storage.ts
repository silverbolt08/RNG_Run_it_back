/** Where encrypted documents live. Callers hold only an opaque key, never a path. */
export interface DocumentStorage {
  put(plain: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

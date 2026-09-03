export interface StoragePutResult {
  fileKey: string;
}

export default interface StorageAdapter {
  // Store a stream or buffer to a stable location and return a fileKey
  put(nameHint: string, data: NodeJS.ReadableStream | Buffer): Promise<StoragePutResult>;
}

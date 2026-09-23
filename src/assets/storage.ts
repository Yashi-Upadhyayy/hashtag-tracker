export interface StoredAsset {
  key: string;
  contentType: string;
  bytes: number;
}
export interface AssetStorage {
  transfer(sourceUrl: string, key: string): Promise<StoredAsset>;
}

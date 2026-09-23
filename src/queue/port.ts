import { Endpoint } from '../media/model';
export interface JobQueue {
  enqueueSync(hashtag: string, endpoint: Endpoint): Promise<void>;
  enqueueAsset(assetId: string): Promise<void>;
  close(): Promise<void>;
}

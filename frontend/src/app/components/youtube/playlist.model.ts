export type PrivacyStatus = 'public' | 'private' | 'unlisted';

export interface PlaylistDraft {
  title: string;
  description: string;
  privacyStatus: PrivacyStatus;
}

export interface Playlist extends PlaylistDraft {
  id: string;
  itemCount: number;
}

export interface PlaylistPage {
  items: Playlist[];
  nextPageToken: string | null;
}

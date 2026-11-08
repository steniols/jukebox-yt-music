import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

export type PrivacyStatus = 'public' | 'private' | 'unlisted';

export interface User {
  id: string;
  display_name: string;
}

export interface Jukebox {
  id: number;
  title: string;
  active: boolean;
  youtubePlaylistId: string;
  queuedCount: number;
  shareToken: string | null;
}

export interface Track {
  id: number;
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  addedBy: string | null;
  votes?: number;
  votedByMe?: boolean;
}

export interface RoomState {
  /** Presente apenas para o dono. */
  id?: number;
  title: string;
  active: boolean;
  isHost: boolean;
  nowPlaying: Track | null;
  queue: Track[];
}

export interface ImportSummary {
  total: number;
  added: number;
  duplicates: number;
  unavailable: number;
  overLimit: number;
}

export interface ImportResult {
  data: RoomState;
  summary: ImportSummary;
}

interface Envelope<T> {
  data: T;
}

export function errorMessage(error: HttpErrorResponse): string {
  return error.error?.error || 'Não foi possível concluir. Tente novamente.';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  private unwrap<T>(request: Observable<Envelope<T>>): Observable<T> {
    return request.pipe(map((response) => response.data));
  }

  me(): Observable<User> {
    return this.unwrap(this.http.get<Envelope<User>>('/api/youtube/me'));
  }

  logout(): Observable<unknown> {
    return this.http.post('/api/youtube/logout', null);
  }

  listJukeboxes(): Observable<Jukebox[]> {
    return this.unwrap(this.http.get<Envelope<Jukebox[]>>('/api/jukeboxes'));
  }

  createJukebox(title: string, privacyStatus: PrivacyStatus): Observable<Jukebox> {
    return this.unwrap(
      this.http.post<Envelope<Jukebox>>('/api/jukeboxes', { title, privacyStatus }),
    );
  }

  setActive(id: number, active: boolean): Observable<Jukebox> {
    return this.unwrap(this.http.patch<Envelope<Jukebox>>(`/api/jukeboxes/${id}`, { active }));
  }

  regenerateLink(id: number): Observable<Jukebox> {
    return this.unwrap(this.http.post<Envelope<Jukebox>>(`/api/jukeboxes/${id}/link`, null));
  }

  deleteJukebox(id: number): Observable<unknown> {
    return this.http.delete(`/api/jukeboxes/${id}`);
  }

  private roomUrl(token: string): string {
    return `/api/rooms/${encodeURIComponent(token)}`;
  }

  getRoom(token: string): Observable<RoomState> {
    return this.unwrap(this.http.get<Envelope<RoomState>>(this.roomUrl(token)));
  }

  addTrack(token: string, url: string, addedBy: string): Observable<RoomState> {
    return this.unwrap(
      this.http.post<Envelope<RoomState>>(`${this.roomUrl(token)}/tracks`, { url, addedBy }),
    );
  }

  importPlaylist(token: string, url: string): Observable<ImportResult> {
    return this.http.post<ImportResult>(`${this.roomUrl(token)}/import`, { url });
  }

  vote(token: string, trackId: number): Observable<RoomState> {
    return this.unwrap(
      this.http.put<Envelope<RoomState>>(`${this.roomUrl(token)}/vote`, { trackId }),
    );
  }

  clearVote(token: string): Observable<RoomState> {
    return this.unwrap(this.http.delete<Envelope<RoomState>>(`${this.roomUrl(token)}/vote`));
  }

  advance(token: string, fromTrackId: number | null): Observable<RoomState> {
    return this.unwrap(
      this.http.post<Envelope<RoomState>>(`${this.roomUrl(token)}/advance`, { fromTrackId }),
    );
  }

  removeTrack(token: string, trackId: number): Observable<RoomState> {
    return this.unwrap(
      this.http.delete<Envelope<RoomState>>(`${this.roomUrl(token)}/tracks/${trackId}`),
    );
  }
}

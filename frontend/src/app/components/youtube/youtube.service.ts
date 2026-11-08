import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, Observable, of } from 'rxjs';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Playlist, PlaylistDraft, PlaylistPage } from './playlist.model';

@Injectable({
  providedIn: 'root'
})
export class YoutubeService {

  baseUrl = '/api/youtube'

  constructor(private snackBar: MatSnackBar, private http: HttpClient) { }

  showMessage(msg: string, isError: boolean = false): void {
    this.snackBar.open(msg, 'X', {
      duration: 4000,
      horizontalPosition: "right",
      verticalPosition: "top",
      panelClass: isError ? ['msg-error'] : ['msg-success']
    });
  }

  errorHandler(e: HttpErrorResponse): Observable<any> {
    this.showMessage(e.error?.error || "Ocorreu um erro!", true)
    return EMPTY;
  }

  login(): void {
    window.location.href = `${this.baseUrl}/login`;
  }

  logout(): Observable<any> {
    return this.http.post(`${this.baseUrl}/logout`, null).pipe(
      catchError(e => this.errorHandler(e))
    );
  }

  // Emite null quando não há sessão: visitante não é uma situação de erro.
  getUser(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/me`).pipe(
      catchError((e: HttpErrorResponse) => e.status === 401 ? of(null) : this.errorHandler(e))
    );
  }

  // Também emite null quando não há sessão.
  getPlaylists(pageToken?: string): Observable<PlaylistPage | null> {
    const params = pageToken ? new HttpParams().set('pageToken', pageToken) : undefined;
    return this.http.get<PlaylistPage>(`${this.baseUrl}/playlists`, { params }).pipe(
      catchError((e: HttpErrorResponse) => e.status === 401 ? of(null) : this.errorHandler(e))
    );
  }

  createPlaylist(draft: PlaylistDraft): Observable<{ data: Playlist }> {
    return this.http.post<{ data: Playlist }>(`${this.baseUrl}/playlists`, draft).pipe(
      catchError(e => this.errorHandler(e))
    );
  }

  updatePlaylist(id: string, draft: PlaylistDraft): Observable<{ data: Playlist }> {
    return this.http.put<{ data: Playlist }>(`${this.baseUrl}/playlists/${encodeURIComponent(id)}`, draft).pipe(
      catchError(e => this.errorHandler(e))
    );
  }

  deletePlaylist(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/playlists/${encodeURIComponent(id)}`).pipe(
      catchError(e => this.errorHandler(e))
    );
  }
}

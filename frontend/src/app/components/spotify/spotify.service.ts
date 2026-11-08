import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, Observable, of } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SpotifyService {

  baseUrl = '/api/spotify'

  constructor(private snackBar: MatSnackBar, private http: HttpClient) { }

  showMessage(msg: string, isError: boolean = false): void {
    this.snackBar.open(msg, 'X', {
      duration: 3000,
      horizontalPosition: "right",
      verticalPosition: "top",
      panelClass: isError ? ['msg-error'] : ['msg-success']
    });
  }

  errorHandler(e: any): Observable<any> {
    this.showMessage("Ocorreu um erro!", true)
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
}

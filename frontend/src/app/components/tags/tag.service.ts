import { Tag } from './tag.model';
import { map, catchError } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Injectable } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class TagService {

  baseUrl = 'http://localhost:8003/tags'

  constructor(private snackBar: MatSnackBar, private http: HttpClient) { }

  showMessage(msg: string, isError: boolean = false): void {
    this.snackBar.open(msg, 'X', {
      duration: 3000,
      horizontalPosition: "right",
      verticalPosition: "top",
      panelClass: isError ? ['msg-error'] : ['msg-success']
    })
  }

  errorHandler(e: any): Observable<any> {
    this.showMessage("Ocorreu um erro!", true)
    return EMPTY
  }

  create(tag: Tag): Observable<Tag> {
    const url = `${this.baseUrl}/save`
    return this.http.post<any>(url, tag).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )
  }

  getTags(): Observable<any> {
    const token = localStorage.getItem("githubToken");
    return this.http.post<any>(this.baseUrl, { token }).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )
  }

  getById(id: number): Observable<any> {
    const url = `${this.baseUrl}/${id}`
    return this.http.get<any>(url).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )  
  }

  update(tag: Tag): Observable<Tag> {
    const url = `${this.baseUrl}/save/${tag.id}`
    return this.http.put<any>(url, tag).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )
  }

  delete(id: string): Observable<Tag> {
    const url = `${this.baseUrl}/${id}`
    return this.http.delete<any>(url).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )
  }
}
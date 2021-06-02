import { map, catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class GithubService {

  baseUrl = 'http://localhost:8003/github'

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

  getUser(): Observable<any> {
    const token = localStorage.getItem("githubToken");
    const url = `${this.baseUrl}/github-get-userdata/${token}`
    return this.http.get<any>(url).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    ) 
  }

  getRepositories(): Observable<any> {
    const token = localStorage.getItem("githubToken");
    const user = localStorage.getItem("githubUsername");
    const url = `${this.baseUrl}/github-repositories`;
    const data = {
      token: token,
      user: user,
      search: "",
    };
    return this.http.post<any>(url, data).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )
  }

  getRepository(id: string): Observable<any> {
    const token = localStorage.getItem("githubToken");
    const user = localStorage.getItem("githubUsername"); 
    const url = `${this.baseUrl}/github-repository/${id}`;
    const data = {
      token: token,
      user: user,
    };
    return this.http.post<any>(url, data).pipe(
      map(obj => obj), catchError(e => this.errorHandler(e))
    )
  }
}
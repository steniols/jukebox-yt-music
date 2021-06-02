import { GithubService } from './../../github/github.service';
import { HeaderService } from './header.service';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent implements OnInit {

  username: string;
  name: string;

  constructor(private headerService: HeaderService, private githubService: GithubService) { }

  ngOnInit(): void {
    const token = localStorage.getItem("githubToken");
    if (token) {
      this.getUser() 
    }
  }

  get title(): string {
    return this.headerService.headerData.title
  }

  get icon(): string {
    return this.headerService.headerData.icon
  }

  get routeUrl(): string {
    return this.headerService.headerData.routeUrl
  }
 
  login(): void {
    window.location.href="http://localhost:8003/github";
  }

  logout(): void {
    localStorage.clear();
    window.location.href="http://localhost:4200/";
  }

  getUser(): void {
    this.githubService.getUser().subscribe((res) =>{
      this.username = res.data.login;
      this.name = res.data.name;
    }) 
  }
}

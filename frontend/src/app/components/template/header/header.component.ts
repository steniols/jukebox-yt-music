import { HeaderService } from './header.service';
import { Component, OnInit } from '@angular/core';
import { SpotifyService } from '../../spotify/spotify.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent implements OnInit {

  username: string;
  name: string;

  constructor(private headerService: HeaderService, private spotifyService: SpotifyService) { }

  ngOnInit(): void {
    const token = localStorage.getItem("token");
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
    window.location.href="http://localhost:8003/spotify/login";
  }

  logout(): void {
    localStorage.clear();
    window.location.href="http://localhost:4200/";
  }

  getUser(): void {
    this.spotifyService.getUser().subscribe((res) =>{
      this.username = res.data.id;
      this.name = res.data.display_name;
    }); 
  }
}

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
    this.getUser();
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
    this.spotifyService.login();
  }

  logout(): void {
    this.spotifyService.logout().subscribe(() => {
      window.location.href = "/";
    });
  }

  getUser(): void {
    this.spotifyService.getUser().subscribe((res) => {
      if (res) {
        this.username = res.data.id;
        this.name = res.data.display_name;
      }
    });
  }
}

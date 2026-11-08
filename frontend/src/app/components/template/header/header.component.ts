import { HeaderService } from './header.service';
import { Component, OnInit } from '@angular/core';
import { YoutubeService } from '../../youtube/youtube.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent implements OnInit {

  username: string;
  name: string;

  constructor(private headerService: HeaderService, private youtubeService: YoutubeService) { }

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
    this.youtubeService.login();
  }

  logout(): void {
    this.youtubeService.logout().subscribe(() => {
      window.location.href = "/";
    });
  }

  getUser(): void {
    this.youtubeService.getUser().subscribe((res) => {
      if (res) {
        this.username = res.data.id;
        this.name = res.data.display_name;
      }
    });
  }
}

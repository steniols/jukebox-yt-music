import { Router } from '@angular/router';
import { YoutubeService } from './../../components/youtube/youtube.service';
import { HeaderService } from './../../components/template/header/header.service';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.css']
})
export class UserComponent implements OnInit {

  username: string;
  name: string;

  constructor(private router: Router, private headerService: HeaderService, private youtubeService: YoutubeService) {
    headerService.headerData = {
      title: 'Dados do usuário',
      icon: 'account_circle',
      routeUrl: 'user'
    }
  }

  ngOnInit(): void {
    this.getUser();
  }

  getUser(): void {
    this.youtubeService.getUser().subscribe((res) => {
      if (!res) {
        this.router.navigate(["/"]);
        return;
      }
      this.username = res.data.id;
      this.name = res.data.display_name;
    });
  }

}

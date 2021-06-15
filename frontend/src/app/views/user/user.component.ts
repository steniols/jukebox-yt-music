import { Router } from '@angular/router';
import { SpotifyService } from './../../components/spotify/spotify.service';
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
  email: string;

  constructor(private router: Router, private headerService: HeaderService, private spotifyService: SpotifyService) { 
    headerService.headerData = {
      title: 'Dados do usuário',
      icon: 'account_circle',
      routeUrl: 'user'
    }

    if (!localStorage.getItem("token")) {
      this.router.navigate(["/"]);
    }
  }

  ngOnInit(): void {
    const token = localStorage.getItem("token");
    if (token) {
      this.getUser() 
    }
  }

  getUser(): void {
    this.spotifyService.getUser().subscribe((res) =>{
      console.log(res);
      this.username = res.data.id;
      this.name = res.data.display_name;
      this.email = res.data.email;
    }); 
  }

}

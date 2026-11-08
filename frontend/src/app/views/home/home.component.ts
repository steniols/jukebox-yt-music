import { ActivatedRoute, Router } from '@angular/router';
import { SpotifyService } from './../../components/spotify/spotify.service';
import { HeaderService } from './../../components/template/header/header.service';
import { Component, OnInit } from '@angular/core';

const LOGIN_ERRORS = {
  access_denied: 'O acesso à conta do Spotify não foi autorizado.',
  invalid_state: 'Não foi possível validar o login. Tente novamente.',
  spotify_error: 'O Spotify não concluiu o login. Tente novamente.'
};

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {

  constructor(
    private headerService: HeaderService,
    private spotifyService: SpotifyService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    headerService.headerData = {
      title: 'Início',
      icon: 'home',
      routeUrl: ''
    }
  }

  ngOnInit(): void {
    const loginError = this.route.snapshot.queryParamMap.get('login_error');
    if (loginError) {
      this.spotifyService.showMessage(LOGIN_ERRORS[loginError] || LOGIN_ERRORS.spotify_error, true);
      this.router.navigate(['/'], { replaceUrl: true });
    }
  }

}

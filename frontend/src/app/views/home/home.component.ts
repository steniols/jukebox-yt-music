import { ActivatedRoute, Router } from '@angular/router';
import { YoutubeService } from './../../components/youtube/youtube.service';
import { HeaderService } from './../../components/template/header/header.service';
import { Component, OnInit } from '@angular/core';

const LOGIN_ERRORS = {
  access_denied: 'O acesso à conta do Google não foi autorizado.',
  invalid_state: 'Não foi possível validar o login. Tente novamente.',
  missing_scope: 'Para usar o app, autorize o acesso ao YouTube na tela do Google.',
  google_error: 'O Google não concluiu o login. Tente novamente.'
};

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {

  constructor(
    private headerService: HeaderService,
    private youtubeService: YoutubeService,
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
      this.youtubeService.showMessage(LOGIN_ERRORS[loginError] || LOGIN_ERRORS.google_error, true);
      this.router.navigate(['/'], { replaceUrl: true });
    }
  }

}

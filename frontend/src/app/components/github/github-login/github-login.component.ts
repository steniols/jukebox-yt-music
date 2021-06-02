import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-github-login',
  templateUrl: './github-login.component.html',
  styleUrls: ['./github-login.component.css']
})
export class GithubLoginComponent implements OnInit {

  constructor(private router: Router, private route: ActivatedRoute) { }

  ngOnInit(): void {

    this.route.queryParams.subscribe(params => {
      const username = params['username'];
      if (username) {
        localStorage.setItem("githubUsername", username);
      }
      const token = params['token'];
      if (token) {
        localStorage.setItem("githubToken", token);
      }
      console.log("Token:", token);
      window.location.href="http://localhost:4200/";
    });
  }

}

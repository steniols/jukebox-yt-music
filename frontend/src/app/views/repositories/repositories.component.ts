import { HeaderService } from './../../components/template/header/header.service';
import { GithubService } from './../../components/github/github.service';
import { Router } from '@angular/router';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-repositories',
  templateUrl: './repositories.component.html',
  styleUrls: ['./repositories.component.css']
})
export class RepositoriesComponent implements OnInit {

  isLoading = true;
  repositories = []
  displayedColumns = ['id', 'name', 'description', 'action']

  constructor(private headerService: HeaderService, private router: Router, private githubService: GithubService) { 
    headerService.headerData = {
      title: 'Listagem de repositórios',
      icon: 'storefront',
      routeUrl: '/repositories'
    }

    if (!localStorage.getItem("githubToken")) {
      this.router.navigate(["/"]);
    }
  }

  ngOnInit(): void {
    this.getRepositories()
  }

  getRepositories(): void {
    this.githubService.getRepositories().subscribe((res) =>{
      this.repositories = res.repositories
      this.isLoading = false
    }) 
  }
}

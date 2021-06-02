import { ActivatedRoute } from '@angular/router';
import { GithubService } from './../../github/github.service';
import { Router } from '@angular/router';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-repository-update',
  templateUrl: './repository-update.component.html',
  styleUrls: ['./repository-update.component.css']
})
export class RepositoryUpdateComponent implements OnInit {

  repository: {id: '', name: '', description: ''}

  constructor(private router: Router, private githubService: GithubService, private route: ActivatedRoute) { }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get("id");
    this.githubService.getRepository(id).subscribe((repo) => {
      console.log(repo)
      this.repository = repo.data;
    });
  }

  updateRepository(): void {
  }

  cancel(): void {
    this.router.navigate(["/repositories"]);
  }
}

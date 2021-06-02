import { SpotifyLoginComponent } from './components/spotify/spotify-login/spotify-login.component';
import { RepositoryUpdateComponent } from './components/repositories/repository-update/repository-update.component';
import { RepositoriesComponent } from './views/repositories/repositories.component';
import { GithubLoginComponent } from './components/github/github-login/github-login.component';
import { ProductDeleteComponent } from './components/product/product-delete/product-delete.component';
import { ProductUpdateComponent } from './components/product/product-update/product-update.component';
import { NgModule } from "@angular/core";
import { Routes, RouterModule } from "@angular/router";

import { HomeComponent } from "./views/home/home.component";
import { ProductCrudComponent } from "./views/product-crud/product-crud.component";
import { ProductCreateComponent } from './components/product/product-create/product-create.component';


const routes: Routes = [
  {
    path: "",
    component: HomeComponent
  },
  {
    path: "products",
    component: ProductCrudComponent
  },
  {
    path: "products/create",
    component: ProductCreateComponent
  },
  {
    path: "products/update/:id",
    component: ProductUpdateComponent
  },
  {
    path: "products/delete/:id",
    component: ProductDeleteComponent
  },
  {
    path: "github",
    component: GithubLoginComponent
  },
  {
    path: "repositories",
    component: RepositoriesComponent
  },
  {
    path: "repositories/update/:id",
    component: RepositoryUpdateComponent
  },
  {
    path: "spotify",
    component: SpotifyLoginComponent
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}

import { UserComponent } from './views/user/user.component';
import { SpotifyLoginComponent } from './components/spotify/spotify-login/spotify-login.component';
import { NgModule } from "@angular/core";
import { Routes, RouterModule } from "@angular/router";

import { HomeComponent } from "./views/home/home.component";


const routes: Routes = [
  {
    path: "",
    component: HomeComponent
  },
  {
    path: "spotify",
    component: SpotifyLoginComponent
  },
  {
    path: "user",
    component: UserComponent
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}

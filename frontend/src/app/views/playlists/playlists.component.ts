import { Component, OnInit } from '@angular/core';
import { NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { Playlist, PlaylistDraft, PrivacyStatus } from './../../components/youtube/playlist.model';
import { YoutubeService } from './../../components/youtube/youtube.service';
import { HeaderService } from './../../components/template/header/header.service';

const emptyDraft = (): PlaylistDraft => ({ title: '', description: '', privacyStatus: 'private' });

@Component({
  selector: 'app-playlists',
  templateUrl: './playlists.component.html',
  styleUrls: ['./playlists.component.css']
})
export class PlaylistsComponent implements OnInit {

  playlists: Playlist[] = [];
  nextPageToken: string | null = null;
  displayedColumns = ['title', 'privacy', 'items', 'actions'];

  draft = emptyDraft();
  editingId: string | null = null;
  loading = false;
  saving = false;

  readonly privacyOptions: { value: PrivacyStatus, label: string }[] = [
    { value: 'private', label: 'Privada' },
    { value: 'unlisted', label: 'Não listada' },
    { value: 'public', label: 'Pública' }
  ];

  constructor(
    private router: Router,
    private headerService: HeaderService,
    private youtubeService: YoutubeService
  ) {
    headerService.headerData = {
      title: 'Playlists',
      icon: 'queue_music',
      routeUrl: 'playlists'
    }
  }

  ngOnInit(): void {
    this.load();
  }

  load(pageToken?: string): void {
    this.loading = true;
    this.youtubeService.getPlaylists(pageToken)
      .pipe(finalize(() => this.loading = false))
      .subscribe(page => {
        if (!page) {
          this.router.navigate(['/']);
          return;
        }
        this.playlists = pageToken ? [...this.playlists, ...page.items] : page.items;
        this.nextPageToken = page.nextPageToken;
      });
  }

  privacyLabel(value: PrivacyStatus): string {
    const option = this.privacyOptions.find(o => o.value === value);
    return option ? option.label : value;
  }

  musicUrl(playlist: Playlist): string {
    return `https://music.youtube.com/playlist?list=${encodeURIComponent(playlist.id)}`;
  }

  edit(playlist: Playlist): void {
    this.editingId = playlist.id;
    this.draft = {
      title: playlist.title,
      description: playlist.description,
      privacyStatus: playlist.privacyStatus
    };
  }

  cancel(form: NgForm): void {
    this.editingId = null;
    form.resetForm(emptyDraft());
  }

  save(form: NgForm): void {
    if (form.invalid || this.saving) {
      return;
    }

    const editingId = this.editingId;
    const request = editingId
      ? this.youtubeService.updatePlaylist(editingId, this.draft)
      : this.youtubeService.createPlaylist(this.draft);

    this.saving = true;
    request.pipe(finalize(() => this.saving = false)).subscribe(({ data }) => {
      this.playlists = editingId
        ? this.playlists.map(p => p.id === editingId ? data : p)
        : [data, ...this.playlists];
      this.youtubeService.showMessage(editingId ? 'Playlist atualizada.' : 'Playlist criada.');
      this.cancel(form);
    });
  }

  remove(playlist: Playlist, form: NgForm): void {
    if (!window.confirm(`Excluir a playlist "${playlist.title}" da sua conta do YouTube? Essa ação não pode ser desfeita.`)) {
      return;
    }

    this.youtubeService.deletePlaylist(playlist.id).subscribe(() => {
      this.playlists = this.playlists.filter(p => p.id !== playlist.id);
      if (this.editingId === playlist.id) {
        this.cancel(form);
      }
      this.youtubeService.showMessage('Playlist excluída.');
    });
  }

}

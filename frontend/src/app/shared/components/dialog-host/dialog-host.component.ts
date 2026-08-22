import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dialog-host.component.html',
  styleUrls: ['./dialog-host.component.css']
})
export class DialogHostComponent {
  dialog = inject(DialogService);

  respond(result: boolean) {
    this.dialog.respond(result);
  }
}

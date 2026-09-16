import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dialog-host.component.html',
  styleUrls: ['./dialog-host.component.css']
})
export class DialogHostComponent {
  dialog = inject(DialogService);

  respond(result: boolean) {
    this.dialog.respond(result);
  }

  /** A required prompt cannot be submitted empty — the server would refuse it. */
  get canSubmitPrompt(): boolean {
    const s = this.dialog.state();
    if (s?.variant !== 'prompt') return true;
    return !s.required || this.dialog.promptValue.trim().length > 0;
  }
}

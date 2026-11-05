import { Component, signal } from '@angular/core';

@Component({
  selector: 'operator-checklist',
  template: `
    <fieldset>
      <legend>Pre-use checklist</legend>
      <label><input type="checkbox" [checked]="confirmed()" (change)="confirmed.set(!confirmed())">
        Torque collar inspected</label>
      <p role="status">{{ confirmed() ? 'Inspection complete' : 'Inspection pending' }}</p>
    </fieldset>`,
})
export class Checklist {
  readonly confirmed = signal(false);
}

// The coach turns lesson events into [SIM] prompts for the instructor, queued by priority:
// directions 3 > lesson 2 > faults 1 > hints 0. Directions interrupt; others wait until the
// instructor is idle and at least 2.5 s have passed since the last prompt.

export type PromptKind = 'direction' | 'lesson' | 'fault' | 'hint';
export const PRIORITY: Record<PromptKind, number> = { direction: 3, lesson: 2, fault: 1, hint: 0 };

export interface Prompt {
  kind: PromptKind;
  text: string;
  at: number;
}

export class Coach {
  queue: Prompt[] = [];
  lastSent = -Infinity;
  gap = 2.5;

  push(kind: PromptKind, text: string, at: number) {
    const t = text.startsWith('[SIM]') ? text : `[SIM] ${text}`;
    // A newer direction supersedes older queued directions.
    if (kind === 'direction') this.queue = this.queue.filter((p) => p.kind !== 'direction');
    this.queue.push({ kind, text: t, at });
    this.queue.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || a.at - b.at);
    // Drop stale low-priority prompts.
    this.queue = this.queue.filter((p) => p.kind === 'direction' || p.kind === 'lesson' || at - p.at < 20).slice(0, 8);
  }

  /** Next prompt to send now, given whether the instructor is idle. Returns the prompt and whether it interrupts. */
  next(now: number, idle: boolean): { prompt: Prompt; interrupt: boolean } | null {
    const top = this.queue[0];
    if (!top) return null;
    if (top.kind === 'direction') {
      this.queue.shift();
      this.lastSent = now;
      return { prompt: top, interrupt: !idle };
    }
    if (!idle || now - this.lastSent < this.gap) return null;
    this.queue.shift();
    this.lastSent = now;
    return { prompt: top, interrupt: false };
  }
}

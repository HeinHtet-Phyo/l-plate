// Browser speech: Sam's voice (en-GB speechSynthesis) and push-to-talk (SpeechRecognition).

export class Voice {
  enabled: boolean;
  speaking = false;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(enabled: boolean) {
    this.enabled = enabled && typeof speechSynthesis !== 'undefined';
    if (!this.enabled) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice =
        vs.find((v) => v.lang === 'en-GB' && /male|daniel|george|ryan|arthur/i.test(v.name)) ??
        vs.find((v) => v.lang === 'en-GB') ??
        vs.find((v) => v.lang.startsWith('en')) ??
        null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  get idle(): boolean {
    return !this.speaking && !(typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking);
  }

  say(text: string, interrupt = false): Promise<void> {
    if (!this.enabled || !text) return Promise.resolve();
    if (interrupt) speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.03;
      this.speaking = true;
      const done = () => {
        this.speaking = false;
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      // Safety net: some browsers never fire onend.
      setTimeout(done, 1500 + text.length * 90);
    });
  }

  cancel() {
    if (this.enabled) speechSynthesis.cancel();
    this.speaking = false;
  }
}

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

export function speechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export class PushToTalk {
  private rec: Rec | null = null;
  private text = '';
  listening = false;

  start() {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor || this.listening) return false;
    const rec: Rec = new Ctor();
    rec.lang = 'en-GB';
    rec.interimResults = true;
    rec.continuous = true;
    this.text = '';
    rec.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      this.text = t;
    };
    rec.onerror = () => {};
    this.rec = rec;
    this.listening = true;
    try {
      rec.start();
    } catch {
      this.listening = false;
      return false;
    }
    return true;
  }

  /** Stop and resolve with the transcript. */
  stop(): Promise<string> {
    const rec = this.rec;
    if (!rec || !this.listening) return Promise.resolve('');
    this.listening = false;
    return new Promise((resolve) => {
      const finish = () => resolve(this.text.trim());
      rec.onend = finish;
      setTimeout(finish, 1500);
      try {
        rec.stop();
      } catch {
        finish();
      }
    });
  }
}

// The Report screen (owner, 2026-10-18): a bug or a suggestion, written here and opened on GitHub as a new issue with
// the game's state attached (report.ts). The state is read once, when the screen opens, so it is the moment of the
// problem. Nothing leaves the game by itself: GitHub opens in a new tab with the issue filled in, and the pilot
// submits it there (or copies the report and pastes it anywhere).

import { detailsBlock, newIssue } from '../report';
import type { PageReport, ReportKind, ReportText } from '../report';
import type { EngineReport } from '../engine/protocol';
import { h, clear } from './dom';

export interface ReportHost {
    repo: string;
    /** the page's and the engine's state now */
    gather(): Promise<{ page: PageReport; engine: EngineReport | null }>;
    /** download this visit's saved flight, to attach (offered when gather() found one) */
    downloadFlight(): Promise<void>;
    close(): void;
}

const LABELS: Record<ReportKind, { what: string; steps: string; expected: string | null; whatHint: string; stepsHint: string }> = {
    bug: {
        what: 'What happened', steps: 'Steps to make it happen', expected: 'What you expected',
        whatHint: 'e.g. The quad fell through the roof of the car park near the yard.',
        stepsHint: 'e.g. 1. Start at Park. 2. Fly north to the car park. 3. Land on the top deck.'
    },
    suggestion: {
        what: 'Your idea', steps: 'Why it would help', expected: null,
        whatHint: 'e.g. A gate race around the park.', stepsHint: 'e.g. Something to practise lines on.'
    }
};

export class ReportUi {
    readonly el: HTMLElement;
    private body = h('div');
    private host: ReportHost | null = null;
    /** the draft: kept while the page lives, so closing the screen loses nothing */
    private text: ReportText = { kind: 'bug', title: '', what: '', steps: '', expected: '' };
    private withDetails = true;
    private state: { page: PageReport; engine: EngineReport | null } | null = null;
    private msg = '';

    constructor() {
        this.el = h('div', { class: 'overlay hidden' }, h('div', { class: 'panel wide' }, this.body));
    }

    get open(): boolean {
        return !this.el.classList.contains('hidden');
    }

    async show(host: ReportHost): Promise<void> {
        this.host = host;
        this.msg = '';
        this.state = null;
        this.el.classList.remove('hidden');
        this.build();
        this.state = await host.gather();
        if (this.open) this.build();
    }

    hide(): void {
        this.el.classList.add('hidden');
    }

    private field(label: string, key: 'what' | 'steps' | 'expected', hint: string): HTMLElement {
        return h('label', { class: 'report-field' }, h('span', {}, label),
            // a textarea's text is its content, not a value attribute
            h('textarea', { rows: 3, placeholder: hint, oninput: (e: Event) => { this.text[key] = (e.target as HTMLTextAreaElement).value; } }, this.text[key]));
    }

    private issue(): ReturnType<typeof newIssue> {
        const s = this.withDetails ? this.state : null;
        return newIssue(this.host!.repo, this.text, s?.page ?? null, s?.engine ?? null);
    }

    private build(): void {
        const host = this.host!;
        const t = this.text, L = LABELS[t.kind];
        const kinds: [ReportKind, string][] = [['bug', 'Bug or problem'], ['suggestion', 'Suggestion']];
        const details = this.state ? detailsBlock(this.state.page, this.state.engine) : '';
        clear(this.body,
            h('h1', {}, 'Report a problem or suggest something'),
            h('p', { class: 'note' }, 'This opens a new issue on the game\'s GitHub page with your text and the game\'s state filled in. ' +
                'Check it there and press Create (a free GitHub account is needed). Nothing is sent from the game itself.'),
            h('div', { class: 'seg' }, ...kinds.map(([k, label]) => h('button', { class: t.kind === k ? 'on' : '', onclick: () => { t.kind = k; this.build(); } }, label))),
            h('label', { class: 'report-field' }, h('span', {}, 'Title'),
                h('input', { type: 'text', maxlength: 120, placeholder: t.kind === 'bug' ? 'A short line: what went wrong' : 'A short line: the idea', value: t.title,
                    oninput: (e: Event) => { t.title = (e.target as HTMLInputElement).value; } })),
            this.field(L.what, 'what', L.whatHint),
            this.field(L.steps, 'steps', L.stepsHint),
            L.expected ? this.field(L.expected, 'expected', 'e.g. It should land on the deck.') : null,
            h('label', { class: 'row' },
                h('input', { type: 'checkbox', checked: this.withDetails, onchange: (e: Event) => { this.withDetails = (e.target as HTMLInputElement).checked; this.build(); } }),
                h('span', {}, 'Include the game\'s state (build, browser, GPU, radio, settings, where the quad was): it helps find and replay the problem.')),
            this.withDetails
                ? h('details', { class: 'report-details' }, h('summary', {}, this.state ? 'What will be included' : 'Reading the game\'s state…'), h('pre', {}, details))
                : null,
            this.state?.page.savedFlight != null
                ? h('p', { class: 'note' }, 'To let us replay exactly what you flew, download this visit\'s flight and drag the file into the issue on GitHub.')
                : null,
            this.msg ? h('p', { class: 'hint' }, this.msg) : null,
            h('div', { class: 'row' },
                h('button', {
                    class: 'primary', disabled: this.withDetails && !this.state,
                    onclick: () => {
                        const issue = this.issue();
                        window.open(issue.url, '_blank', 'noopener');
                        if (issue.cut) {
                            void navigator.clipboard?.writeText(issue.body).catch(() => undefined);
                            this.msg = `The report was too long for one link, so ${issue.cut} were left out of it. The full report is copied: paste it into the issue too.`;
                        } else this.msg = 'GitHub opened in a new tab. If it did not, allow pop-ups for this page or use Copy report.';
                        this.build();
                    }
                }, 'Open on GitHub'),
                h('button', {
                    disabled: this.withDetails && !this.state,
                    onclick: async () => {
                        try {
                            await navigator.clipboard.writeText(this.issue().body);
                            this.msg = 'Copied. Paste it into a new issue on GitHub, or wherever you want to send it.';
                        } catch {
                            this.msg = 'This browser did not allow copying.';
                        }
                        this.build();
                    }
                }, 'Copy report'),
                this.state?.page.savedFlight != null ? h('button', { onclick: () => void host.downloadFlight() }, 'Download this flight') : null,
                h('button', { onclick: () => host.close() }, 'Close')));
    }
}

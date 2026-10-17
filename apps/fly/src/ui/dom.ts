// A small element builder: h('div', { class: 'x', onclick: f }, child, 'text').

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
        else if (k === 'class') el.className = String(v);
        else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
}

export function clear(el: Element, ...children: Child[]): void {
    el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

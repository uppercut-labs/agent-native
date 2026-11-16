/** Optional dependency-free preview adapter. Production React uses the same component renderer. */
import { createReactRenderer, mediaElementId } from './ui-react.js';
import type { ElementFactory, RendererOptions } from './ui-react.js';
import { UiStore } from './ui/store.js';
import { uiStyles } from './ui-styles.js';
type VNode = {
    readonly tag: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly VChild[];
};
type VChild = VNode | string;
type Mounted = {
    vnode: VChild;
    node: Node;
    children: Mounted[];
    listeners: Map<string, EventListener>;
};
const makeElement: ElementFactory<VNode> = (tag: string, props: Readonly<Record<string, unknown>> | null, ...children: readonly (VNode | string | number | null | false)[]): VNode => ({ tag, props: props ?? {}, children: children.filter((v): v is VNode | string | number => v !== null && v !== false).map((v: VNode | string | number): VChild => typeof v === 'number' ? String(v) : v) });
function key(vnode: VChild, index: number): string { return typeof vnode === 'string' ? `text:${index}` : `${vnode.tag}:${String(vnode.props.key ?? index)}`; }
function property(element: HTMLElement, name: string, value: unknown, mounted: Mounted): void {
    if (name === 'key' || name === 'children' || name === 'value' && element.tagName !== 'OPTION')
        return;
    if (name.startsWith('on') && name.length > 2) {
        const event: string = name.slice(2).toLowerCase();
        const existing: EventListener | undefined = mounted.listeners.get(event);
        if (existing !== undefined)
            element.removeEventListener(event, existing);
        if (typeof value === 'function') {
            const listener: EventListener = value as EventListener;
            element.addEventListener(event, listener);
            mounted.listeners.set(event, listener);
        }
        else
            mounted.listeners.delete(event);
        return;
    }
    if (name === 'style') {
        element.removeAttribute('style');
        if (value !== null && typeof value === 'object')
            for (const [k, v] of Object.entries(value))
                element.style.setProperty(k.replace(/[A-Z]/g, (m: string): string => `-${m.toLowerCase()}`), String(v));
        return;
    }
    const attribute: string = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;
    if (name === 'checked' && element instanceof HTMLInputElement)
        element.checked = value === true;
    if (value === undefined || value === null || value === false && !name.startsWith('aria-'))
        element.removeAttribute(attribute);
    else
        element.setAttribute(attribute, value === true && !name.startsWith('aria-') ? '' : String(value));
}
function reconcile(parent: Node, previous: Mounted | undefined, vnode: VChild): Mounted {
    if (typeof vnode === 'string') {
        if (previous !== undefined && typeof previous.vnode === 'string') {
            if (previous.node.textContent !== vnode)
                previous.node.textContent = vnode;
            previous.vnode = vnode;
            return previous;
        }
        const node: Text = parent.ownerDocument?.createTextNode(vnode) ?? document.createTextNode(vnode);
        if (previous !== undefined)
            parent.replaceChild(node, previous.node);
        else
            parent.appendChild(node);
        return { vnode, node, children: [], listeners: new Map() };
    }
    let current: Mounted;
    if (previous === undefined || typeof previous.vnode === 'string' || previous.vnode.tag !== vnode.tag) {
        const node: HTMLElement = (parent.ownerDocument ?? document).createElement(vnode.tag);
        if (previous !== undefined)
            parent.replaceChild(node, previous.node);
        else
            parent.appendChild(node);
        current = { vnode: { tag: vnode.tag, props: {}, children: [] }, node, children: [], listeners: new Map() };
    }
    else
        current = previous;
    const element: HTMLElement = current.node as HTMLElement;
    const old: VNode = current.vnode as VNode;
    for (const name of Object.keys(old.props))
        if (!(name in vnode.props))
            property(element, name, undefined, current);
    for (const [name, value] of Object.entries(vnode.props))
        if (old.props[name] !== value)
            property(element, name, value, current);
    let previousChildren: Map<string, Mounted> = new Map(current.children.map((child: Mounted, index: number): [
        string,
        Mounted
    ] => [key(child.vnode, index), child]));
    let nextChildren: Mounted[] = [];
    vnode.children.forEach((child: VChild, index: number): void => {
        const childKey: string = key(child, index);
        const prior: Mounted | undefined = previousChildren.get(childKey);
        const mounted: Mounted = reconcile(element, prior, child);
        const at: ChildNode | undefined = element.childNodes[index];
        if (at !== mounted.node)
            element.insertBefore(mounted.node, at ?? null);
        nextChildren.push(mounted);
        previousChildren.delete(childKey);
    });
    for (const unused of previousChildren.values())
        if (unused.node.parentNode === element)
            element.removeChild(unused.node);
    if (vnode.props.value !== undefined && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
        const value: string = String(vnode.props.value);
        if (element.value !== value)
            element.value = value;
    }
    current.vnode = vnode;
    current.children = nextChildren;
    return current;
}
export type DomMountOptions = Omit<RendererOptions<VNode>, 'onViewChange' | 'seekMedia'> & {
    readonly injectStyles?: boolean;
};
export function mountDomSurface(container: HTMLElement, store: UiStore, surfaceId: string, options: DomMountOptions = {}): () => void {
    let current: Mounted | undefined;
    let disposed: boolean = false;
    let style: HTMLStyleElement | undefined;
    if (options.injectStyles !== false) {
        style = document.createElement('style');
        style.textContent = uiStyles;
        container.appendChild(style);
    }
    const renderer = createReactRenderer(makeElement, { ...options,
        onViewChange: (): void => { update(); },
        seekMedia(id: string, componentId: string, seconds: number): void {
            const element: HTMLElement | null = document.getElementById(mediaElementId(id, componentId));
            if (element instanceof HTMLMediaElement && container.contains(element) && Number.isFinite(element.duration))
                element.currentTime = Math.min(element.duration, Math.max(0, seconds));
        },
    });
    function update(): void {
        if (!disposed)
            current = reconcile(container, current, renderer.render(store, surfaceId));
    }
    const unsubscribe: () => void = store.subscribe(update);
    update();
    return (): void => {
        disposed = true;
        unsubscribe();
        renderer.dispose();
        if (current?.node.parentNode === container)
            container.removeChild(current.node);
        style?.remove();
    };
}

type ResourceKind = "buffers" | "programs" | "textures" | "vertexArrays";
type ResourceLedger = {
  created: number;
  deleted: number;
  releasedOnContextLoss: number;
  live: Map<object, WebGL2RenderingContext>;
};

const kinds: ResourceKind[] = ["buffers", "programs", "textures", "vertexArrays"];
const resources = Object.fromEntries(kinds.map((kind) => [kind, {
  created: 0, deleted: 0, releasedOnContextLoss: 0, live: new Map(),
}])) as Record<ResourceKind, ResourceLedger>;
const activeContexts = new Set<WebGL2RenderingContext>();
const knownContexts = new WeakSet<WebGL2RenderingContext>();
const listeners: {
  target: WeakRef<HTMLElement>;
  type: string;
  callback: WeakRef<EventListenerOrEventListenerObject>;
  capture: boolean;
}[] = [];
let createdContexts = 0;
let lostContexts = 0;
let drawCalls = 0;

function patchResource(kind: ResourceKind, createName: string, deleteName: string) {
  const prototype = WebGL2RenderingContext.prototype;
  const create = Reflect.get(prototype, createName) as (...args: unknown[]) => object | null;
  const remove = Reflect.get(prototype, deleteName) as (...args: unknown[]) => void;
  const ledger = resources[kind];

  Object.defineProperty(prototype, createName, {
    configurable: true,
    value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
      const resource = Reflect.apply(create, this, args) as object | null;
      if (resource) {
        ledger.created++;
        ledger.live.set(resource, this);
      }
      return resource;
    },
  });
  Object.defineProperty(prototype, deleteName, {
    configurable: true,
    value: function (this: WebGL2RenderingContext, resource: object | null) {
      Reflect.apply(remove, this, [resource]);
      if (resource && ledger.live.delete(resource)) ledger.deleted++;
    },
  });
}

function captureFlag(options?: boolean | EventListenerOptions) {
  return typeof options === "boolean" ? options : options?.capture ?? false;
}

export function installWebGLResourceInspection() {
  const forceUnavailable = new URLSearchParams(window.location.search).get("webgl") === "off";
  const addListener = EventTarget.prototype.addEventListener;
  const removeListener = EventTarget.prototype.removeEventListener;
  Object.defineProperty(EventTarget.prototype, "addEventListener", {
    configurable: true,
    value: function (
      this: EventTarget,
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      Reflect.apply(addListener, this, [type, callback, options]);
      if (!(this instanceof HTMLElement) || callback === null || !/^(pointer|wheel|touch|contextmenu)/.test(type)
        || (!(this instanceof HTMLCanvasElement) && this.closest("[data-renderer-viewer]") === null)) return;
      const capture = captureFlag(options);
      if (!listeners.some((entry) => entry.target.deref() === this && entry.type === type
        && entry.callback.deref() === callback && entry.capture === capture)) {
        listeners.push({ target: new WeakRef(this), type, callback: new WeakRef(callback), capture });
      }
    },
  });
  Object.defineProperty(EventTarget.prototype, "removeEventListener", {
    configurable: true,
    value: function (
      this: EventTarget,
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      Reflect.apply(removeListener, this, [type, callback, options]);
      const index = listeners.findIndex((entry) => entry.target.deref() === this && entry.type === type
        && entry.callback.deref() === callback && entry.capture === captureFlag(options));
      if (index >= 0) listeners.splice(index, 1);
    },
  });

  if (typeof WebGL2RenderingContext === "undefined") return;
  const getContext = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
      if (forceUnavailable && /^(webgl2?|experimental-webgl)$/.test(contextId)) return null;
      const context = Reflect.apply(getContext, this, [contextId, ...args]) as RenderingContext | null;
      if (context instanceof WebGL2RenderingContext && !knownContexts.has(context)) {
        knownContexts.add(context);
        activeContexts.add(context);
        createdContexts++;
        Reflect.apply(addListener, this, ["webglcontextlost", () => {
          if (!activeContexts.delete(context)) return;
          lostContexts++;
          for (const ledger of Object.values(resources)) {
            for (const [resource, owner] of ledger.live) {
              if (owner !== context) continue;
              ledger.live.delete(resource);
              ledger.releasedOnContextLoss++;
            }
          }
        }]);
      }
      return context;
    },
  });

  patchResource("buffers", "createBuffer", "deleteBuffer");
  patchResource("programs", "createProgram", "deleteProgram");
  patchResource("textures", "createTexture", "deleteTexture");
  patchResource("vertexArrays", "createVertexArray", "deleteVertexArray");

  for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    const original = Reflect.get(WebGL2RenderingContext.prototype, name) as (...args: unknown[]) => void;
    Object.defineProperty(WebGL2RenderingContext.prototype, name, {
      configurable: true,
      value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
        drawCalls++;
        return Reflect.apply(original, this, args);
      },
    });
  }
}

export function inspectWebGLResources() {
  for (let index = listeners.length - 1; index >= 0; index--) {
    if (listeners[index].target.deref() === undefined || listeners[index].callback.deref() === undefined) listeners.splice(index, 1);
  }
  const targets = new Set(listeners.flatMap((entry) => {
    const target = entry.target.deref();
    return target ? [target] : [];
  }));
  return {
    contexts: { created: createdContexts, lost: lostContexts, active: activeContexts.size },
    resources: Object.fromEntries(kinds.map((kind) => [kind, {
      created: resources[kind].created,
      deleted: resources[kind].deleted,
      releasedOnContextLoss: resources[kind].releasedOnContextLoss,
      live: resources[kind].live.size,
    }])),
    viewerInteractionListeners: listeners.length,
    viewerElementsWithInteractionListeners: targets.size,
    detachedViewerInteractionListeners: listeners.filter((entry) => !entry.target.deref()?.isConnected).length,
    drawCalls,
    connectedCanvases: document.querySelectorAll("canvas").length,
  };
}

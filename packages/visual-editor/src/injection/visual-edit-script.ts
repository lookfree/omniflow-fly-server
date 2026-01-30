/**
 * Visual Edit Controller
 * Injected into preview pages to enable visual editing capabilities
 */

interface ElementInfo {
  jsxId: string;
  jsxFile?: string;
  jsxLine?: number;
  jsxCol?: number;
  tagName: string;
  className: string;
  textContent: string;
  computedStyles: Record<string, string>;
  boundingRect: DOMRect;
  attributes: Record<string, string>;
  path: string[];
  elementIndex: number;
  elementCount: number;
}

interface ResizePayload {
  jsxId: string | null;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

// Changes format from sidebar
interface ElementChanges {
  textContent?: string;
  className?: string;
  styles?: Record<string, string>;
  attributes?: Record<string, string>;
}

interface UpdatePayload {
  jsxId: string;
  elementIndex?: number;
  changes: ElementChanges;
}

type MessageType =
  | 'VISUAL_EDIT_READY'
  | 'ELEMENT_SELECTED'
  | 'ELEMENT_DESELECTED'
  | 'ELEMENT_UPDATED'
  | 'ELEMENT_RESIZING'
  | 'ELEMENT_RESIZED'
  | 'EDIT_MODE_ENABLED'
  | 'EDIT_MODE_DISABLED'
  | 'FULL_HTML'
  | 'ELEMENT_INFO_REFRESHED';

type HandleDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export class VisualEditController {
  private selectedElement: HTMLElement | null = null;
  private hoveredElement: HTMLElement | null = null;
  private highlightOverlay: HTMLDivElement | null = null;
  private hoverOverlay: HTMLDivElement | null = null;
  private resizeHandles: Map<string, HTMLDivElement> = new Map();
  private isEditMode = false;
  private isTextEditing = false;
  private originalTextBeforeEdit = '';
  private isResizing = false;
  private resizeHandle: string | null = null;
  private dragStartPos = { x: 0, y: 0 };
  private originalRect: DOMRect | null = null;

  constructor() {
    this.init();
  }

  private init(): void {
    this.createOverlays();
    this.createResizeHandles();
    this.setupEventListeners();
    this.setupMessageHandler();
    this.setupResizeListeners();
    console.log('[visual-edit-script] Initialized, sending VISUAL_EDIT_READY');
    this.postMessage('VISUAL_EDIT_READY', null);
  }

  // ========== Overlay Management ==========
  private createOverlays(): void {
    this.highlightOverlay = document.createElement('div');
    this.highlightOverlay.id = '__visual_edit_highlight__';
    this.highlightOverlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.1);
      z-index: 999999;
      display: none;
      transition: all 0.1s ease-out;
    `;

    this.hoverOverlay = document.createElement('div');
    this.hoverOverlay.id = '__visual_edit_hover__';
    this.hoverOverlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      border: 1px dashed #9ca3af;
      background: rgba(156, 163, 175, 0.05);
      z-index: 999998;
      display: none;
      transition: all 0.05s ease-out;
    `;

    document.body.appendChild(this.highlightOverlay);
    document.body.appendChild(this.hoverOverlay);
  }

  private createResizeHandles(): void {
    const handles: HandleDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    const handleContainer = document.createElement('div');
    handleContainer.id = '__visual_edit_handles__';
    handleContainer.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      display: none;
    `;

    handles.forEach((handle) => {
      const el = document.createElement('div');
      el.dataset.handle = handle;
      el.style.cssText = `
        position: absolute;
        width: 8px;
        height: 8px;
        background: #3b82f6;
        border: 1px solid white;
        border-radius: 2px;
        pointer-events: auto;
        cursor: ${this.getCursorForHandle(handle)};
      `;
      this.positionHandle(el, handle);
      handleContainer.appendChild(el);
      this.resizeHandles.set(handle, el);
    });

    document.body.appendChild(handleContainer);
  }

  private getCursorForHandle(handle: string): string {
    const cursors: Record<string, string> = {
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      nw: 'nwse-resize',
      se: 'nwse-resize',
    };
    return cursors[handle];
  }

  private positionHandle(el: HTMLDivElement, handle: string): void {
    switch (handle) {
      case 'n':
        el.style.top = '-4px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        break;
      case 's':
        el.style.bottom = '-4px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        break;
      case 'e':
        el.style.right = '-4px';
        el.style.top = '50%';
        el.style.transform = 'translateY(-50%)';
        break;
      case 'w':
        el.style.left = '-4px';
        el.style.top = '50%';
        el.style.transform = 'translateY(-50%)';
        break;
      case 'ne':
        el.style.top = '-4px';
        el.style.right = '-4px';
        break;
      case 'nw':
        el.style.top = '-4px';
        el.style.left = '-4px';
        break;
      case 'se':
        el.style.bottom = '-4px';
        el.style.right = '-4px';
        break;
      case 'sw':
        el.style.bottom = '-4px';
        el.style.left = '-4px';
        break;
    }
  }

  private updateResizeHandles(): void {
    const container = document.getElementById('__visual_edit_handles__');
    if (!container) return;

    if (!this.selectedElement || !this.isEditMode) {
      container.style.display = 'none';
      return;
    }

    const rect = this.selectedElement.getBoundingClientRect();
    container.style.display = 'block';
    container.style.top = `${rect.top}px`;
    container.style.left = `${rect.left}px`;
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
  }

  private setupResizeListeners(): void {
    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.handle && this.selectedElement) {
        e.preventDefault();
        e.stopPropagation();
        this.startResize(target.dataset.handle, e);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isResizing && this.selectedElement && this.resizeHandle) {
        this.handleResize(e);
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.isResizing) {
        this.endResize();
      }
    });
  }

  private startResize(handle: string, e: MouseEvent): void {
    this.isResizing = true;
    this.resizeHandle = handle;
    this.dragStartPos = { x: e.clientX, y: e.clientY };
    this.originalRect = this.selectedElement!.getBoundingClientRect();
    document.body.style.cursor = this.getCursorForHandle(handle);
    document.body.style.userSelect = 'none';
  }

  private handleResize(e: MouseEvent): void {
    if (!this.selectedElement || !this.originalRect || !this.resizeHandle) return;

    const deltaX = e.clientX - this.dragStartPos.x;
    const deltaY = e.clientY - this.dragStartPos.y;

    let newWidth = this.originalRect.width;
    let newHeight = this.originalRect.height;

    switch (this.resizeHandle) {
      case 'e':
      case 'ne':
      case 'se':
        newWidth = this.originalRect.width + deltaX;
        break;
      case 'w':
      case 'nw':
      case 'sw':
        newWidth = this.originalRect.width - deltaX;
        break;
    }

    switch (this.resizeHandle) {
      case 's':
      case 'se':
      case 'sw':
        newHeight = this.originalRect.height + deltaY;
        break;
      case 'n':
      case 'ne':
      case 'nw':
        newHeight = this.originalRect.height - deltaY;
        break;
    }

    newWidth = Math.max(20, newWidth);
    newHeight = Math.max(20, newHeight);

    this.selectedElement.style.width = `${newWidth}px`;
    this.selectedElement.style.height = `${newHeight}px`;

    this.updateHighlight(this.selectedElement, this.highlightOverlay!);
    this.updateResizeHandles();

    this.postMessage('ELEMENT_RESIZING', {
      jsxId: this.selectedElement.getAttribute('data-jsx-id'),
      width: Math.round(newWidth),
      height: Math.round(newHeight),
      originalWidth: Math.round(this.originalRect.width),
      originalHeight: Math.round(this.originalRect.height),
    } as ResizePayload);
  }

  private endResize(): void {
    if (!this.selectedElement || !this.originalRect) {
      this.isResizing = false;
      this.resizeHandle = null;
      return;
    }

    const currentRect = this.selectedElement.getBoundingClientRect();
    this.postMessage('ELEMENT_RESIZED', {
      jsxId: this.selectedElement.getAttribute('data-jsx-id'),
      width: Math.round(currentRect.width),
      height: Math.round(currentRect.height),
      originalWidth: Math.round(this.originalRect.width),
      originalHeight: Math.round(this.originalRect.height),
    } as ResizePayload);

    this.isResizing = false;
    this.resizeHandle = null;
    this.originalRect = null;
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = '';
  }

  private updateHighlight(element: HTMLElement | null, overlay: HTMLDivElement): void {
    if (!element) {
      overlay.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  // ========== Event Listeners ==========
  private setupEventListeners(): void {
    document.addEventListener('mousemove', (e) => {
      if (!this.isEditMode) return;
      const target = this.findEditableElement(e.target as HTMLElement);
      if (target && target !== this.selectedElement) {
        this.hoveredElement = target;
        this.updateHighlight(target, this.hoverOverlay!);
      } else {
        this.hoveredElement = null;
        this.updateHighlight(null, this.hoverOverlay!);
      }
    });

    document.addEventListener(
      'click',
      (e) => {
        console.log('[visual-edit-script] click event', {
          isEditMode: this.isEditMode,
          isTextEditing: this.isTextEditing,
          target: (e.target as HTMLElement).tagName,
          targetId: (e.target as HTMLElement).id,
        });

        if (!this.isEditMode) return;

        // If currently text editing, don't prevent default (allow cursor movement)
        if (this.isTextEditing) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const target = this.findEditableElement(e.target as HTMLElement);
        if (target) {
          this.selectElement(target);
        }
      },
      true
    );

    // Double-click to enter inline text edit mode
    document.addEventListener(
      'dblclick',
      (e) => {
        if (!this.isEditMode || !this.selectedElement) return;
        e.preventDefault();
        e.stopPropagation();
        this.enterTextEditMode();
      },
      true
    );

    document.addEventListener('keydown', (e) => {
      if (!this.isEditMode) return;
      if (e.key === 'Escape') {
        if (this.isTextEditing) {
          this.exitTextEditMode(false); // Don't commit changes on Escape
        }
        this.deselectElement();
      }
    });

    window.addEventListener(
      'scroll',
      () => {
        if (this.selectedElement) {
          this.updateHighlight(this.selectedElement, this.highlightOverlay!);
          this.updateResizeHandles();
        }
      },
      true
    );

    window.addEventListener('resize', () => {
      if (this.selectedElement) {
        this.updateHighlight(this.selectedElement, this.highlightOverlay!);
        this.updateResizeHandles();
      }
    });
  }

  // ========== Message Handler ==========
  private setupMessageHandler(): void {
    window.addEventListener('message', (e) => {
      const data = e.data || {};
      const { type } = data;
      if (type) {
        console.log('[visual-edit-script] Received message:', type, data);
      }
      switch (type) {
        case 'ENABLE_EDIT_MODE':
          console.log('[visual-edit-script] Enabling edit mode');
          this.enableEditMode();
          break;
        case 'DISABLE_EDIT_MODE':
          this.disableEditMode();
          break;
        case 'UPDATE_ELEMENT':
          // Support both formats: { type, jsxId, changes } and { type, payload: { jsxId, changes } }
          if (data.jsxId && data.changes) {
            this.handleElementUpdate({ jsxId: data.jsxId, changes: data.changes });
          } else if (data.payload) {
            this.handleElementUpdate(data.payload as UpdatePayload);
          }
          break;
        case 'SELECT_BY_JSX_ID':
          this.selectByJsxId(data.jsxId || data.payload?.jsxId, data.elementIndex || data.payload?.elementIndex);
          break;
        case 'GET_FULL_HTML':
          this.sendFullHtml();
          break;
        case 'HIGHLIGHT_ELEMENT':
          this.highlightByJsxId(data.jsxId || data.payload?.jsxId);
          break;
        case 'REFRESH_ELEMENT_INFO':
          this.refreshSelectedElementInfo();
          break;
      }
    });
  }

  // ========== Element Selection ==========
  private findEditableElement(element: HTMLElement | null): HTMLElement | null {
    let current = element;
    while (current && current !== document.body) {
      if (current.hasAttribute('data-jsx-id')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private selectElement(element: HTMLElement): void {
    this.selectedElement = element;
    this.updateHighlight(element, this.highlightOverlay!);
    this.updateResizeHandles();
    const info = this.extractElementInfo(element);
    this.postMessage('ELEMENT_SELECTED', info);
  }

  private selectByJsxId(jsxId: string, elementIndex?: number): void {
    let element: HTMLElement | null = null;
    if (typeof elementIndex === 'number') {
      const allElements = document.querySelectorAll(`[data-jsx-id="${jsxId}"]`);
      element = (allElements[elementIndex] as HTMLElement) || null;
    } else {
      element = document.querySelector(`[data-jsx-id="${jsxId}"]`);
    }

    if (element) {
      this.selectElement(element);
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private deselectElement(): void {
    this.selectedElement = null;
    this.updateHighlight(null, this.highlightOverlay!);
    this.updateResizeHandles();
    this.postMessage('ELEMENT_DESELECTED', null);
  }

  private highlightByJsxId(jsxId: string): void {
    const element = document.querySelector(`[data-jsx-id="${jsxId}"]`) as HTMLElement;
    if (element) {
      this.updateHighlight(element, this.hoverOverlay!);
      setTimeout(() => {
        if (this.hoveredElement !== element) {
          this.updateHighlight(null, this.hoverOverlay!);
        }
      }, 1000);
    }
  }

  private refreshSelectedElementInfo(): void {
    if (!this.selectedElement) {
      this.postMessage('ELEMENT_INFO_REFRESHED', null);
      return;
    }
    const info = this.extractElementInfo(this.selectedElement);
    this.postMessage('ELEMENT_INFO_REFRESHED', info);
  }

  // ========== Information Extraction ==========
  private extractElementInfo(element: HTMLElement): ElementInfo {
    const computedStyles = window.getComputedStyle(element);
    const relevantStyles: Record<string, string> = {};

    const jsxFile = element.getAttribute('data-jsx-file') || undefined;
    const jsxLine = element.getAttribute('data-jsx-line');
    const jsxCol = element.getAttribute('data-jsx-col');

    const styleProps = [
      'color',
      'backgroundColor',
      'fontSize',
      'fontWeight',
      'fontFamily',
      'lineHeight',
      'textAlign',
      'padding',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'margin',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'width',
      'height',
      'maxWidth',
      'minWidth',
      'display',
      'flexDirection',
      'justifyContent',
      'alignItems',
      'gap',
      'borderRadius',
      'borderWidth',
      'borderColor',
      'borderStyle',
      'boxShadow',
      'opacity',
      'position',
      'top',
      'right',
      'bottom',
      'left',
    ];

    for (const prop of styleProps) {
      relevantStyles[prop] = computedStyles.getPropertyValue(
        prop.replace(/([A-Z])/g, '-$1').toLowerCase()
      );
    }

    const attributes: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
      if (!attr.name.startsWith('data-jsx-')) {
        attributes[attr.name] = attr.value;
      }
    }

    const path = this.getElementPath(element);
    const jsxId = element.getAttribute('data-jsx-id') || '';
    const { elementIndex, elementCount } = this.getElementIndexAmongSiblings(element, jsxId);

    return {
      jsxId,
      jsxFile,
      jsxLine: jsxLine ? Number(jsxLine) : undefined,
      jsxCol: jsxCol ? Number(jsxCol) : undefined,
      tagName: element.tagName.toLowerCase(),
      className: element.className,
      textContent: this.getDirectTextContent(element),
      computedStyles: relevantStyles,
      boundingRect: element.getBoundingClientRect(),
      attributes,
      path,
      elementIndex,
      elementCount,
    };
  }

  private getElementIndexAmongSiblings(
    element: HTMLElement,
    jsxId: string
  ): { elementIndex: number; elementCount: number } {
    if (!jsxId) return { elementIndex: 0, elementCount: 1 };

    const allElements = document.querySelectorAll(`[data-jsx-id="${jsxId}"]`);
    const elementCount = allElements.length;

    if (elementCount <= 1) {
      return { elementIndex: 0, elementCount: 1 };
    }

    let elementIndex = 0;
    for (let i = 0; i < allElements.length; i++) {
      if (allElements[i] === element) {
        elementIndex = i;
        break;
      }
    }

    return { elementIndex, elementCount };
  }

  private getDirectTextContent(element: HTMLElement): string {
    let text = '';
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  private getElementPath(element: HTMLElement): string[] {
    const path: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      const jsxId = current.getAttribute('data-jsx-id');
      if (jsxId) {
        path.unshift(jsxId);
      }
      current = current.parentElement;
    }
    return path;
  }

  // ========== Element Update ==========
  private handleElementUpdate(payload: UpdatePayload): void {
    let element: HTMLElement | null = null;

    if (this.selectedElement && this.selectedElement.getAttribute('data-jsx-id') === payload.jsxId) {
      element = this.selectedElement;
    } else if (typeof payload.elementIndex === 'number') {
      const allElements = document.querySelectorAll(`[data-jsx-id="${payload.jsxId}"]`);
      element = (allElements[payload.elementIndex] as HTMLElement) || null;
    } else {
      element = document.querySelector(`[data-jsx-id="${payload.jsxId}"]`);
    }

    if (!element) return;

    const changes = payload.changes;

    // Apply text content change
    if (changes.textContent !== undefined) {
      this.updateElementText(element, changes.textContent);
    }

    // Apply className change
    if (changes.className !== undefined) {
      this.updateElementClassName(element, changes.className);
    }

    // Apply style changes
    if (changes.styles) {
      this.updateElementStyle(element, changes.styles);
    }

    if (element === this.selectedElement) {
      this.updateHighlight(element, this.highlightOverlay!);
    }
  }

  private updateElementText(element: HTMLElement, text: string): void {
    const textNodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE
    );
    if (textNodes.length > 0) {
      textNodes[0].textContent = text;
    } else {
      element.prepend(document.createTextNode(text));
    }
  }

  private updateElementClassName(element: HTMLElement, className: string): void {
    const jsxClasses = Array.from(element.classList).filter((cls) => cls.startsWith('__jsx_'));
    element.className = [...jsxClasses, ...className.split(' ')].join(' ');

    if (element === this.selectedElement) {
      const info = this.extractElementInfo(element);
      this.postMessage('ELEMENT_UPDATED', info);
    }
  }

  private updateElementStyle(element: HTMLElement, styles: Record<string, string>): void {
    for (const [prop, value] of Object.entries(styles)) {
      element.style.setProperty(prop.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
    }

    if (element === this.selectedElement) {
      const info = this.extractElementInfo(element);
      this.postMessage('ELEMENT_UPDATED', info);
    }
  }

  private updateElementAttribute(element: HTMLElement, attr: { name: string; value: string | null }): void {
    if (attr.value === null) {
      element.removeAttribute(attr.name);
    } else {
      element.setAttribute(attr.name, attr.value);
    }
  }

  // ========== Inline Text Editing (contenteditable) ==========
  private enterTextEditMode(): void {
    if (!this.selectedElement) return;

    this.originalTextBeforeEdit = this.getDirectTextContent(this.selectedElement);
    this.isTextEditing = true;

    // Make element editable
    this.selectedElement.contentEditable = 'true';
    this.selectedElement.style.outline = '2px solid #8b5cf6';
    this.selectedElement.style.cursor = 'text';
    this.selectedElement.focus();

    // Select all text
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(this.selectedElement);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // Listen for blur to commit changes
    this.selectedElement.addEventListener('blur', this.handleTextEditBlur);
    this.selectedElement.addEventListener('keydown', this.handleTextEditKeydown);

    console.log('[visual-edit-script] Entered text edit mode');
  }

  private handleTextEditBlur = (): void => {
    // Small delay to allow for potential re-focus
    setTimeout(() => {
      if (this.isTextEditing) {
        this.exitTextEditMode(true);
      }
    }, 100);
  };

  private handleTextEditKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.exitTextEditMode(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.exitTextEditMode(false);
    }
  };

  private exitTextEditMode(commit: boolean): void {
    if (!this.selectedElement || !this.isTextEditing) return;

    // Remove event listeners
    this.selectedElement.removeEventListener('blur', this.handleTextEditBlur);
    this.selectedElement.removeEventListener('keydown', this.handleTextEditKeydown);

    // Disable editing
    this.selectedElement.contentEditable = 'false';
    this.selectedElement.style.outline = '';
    this.selectedElement.style.cursor = '';

    const newText = this.getDirectTextContent(this.selectedElement);

    if (commit && newText !== this.originalTextBeforeEdit) {
      console.log('[visual-edit-script] Text changed, sending update');
      // Send update to parent
      this.postMessage('ELEMENT_UPDATED', this.extractElementInfo(this.selectedElement));
    } else if (!commit) {
      // Revert to original text
      this.updateElementText(this.selectedElement, this.originalTextBeforeEdit);
    }

    this.isTextEditing = false;
    console.log('[visual-edit-script] Exited text edit mode');
  }

  // ========== Mode Control ==========
  private enableEditMode(): void {
    this.isEditMode = true;
    document.body.style.cursor = 'crosshair';
    this.postMessage('EDIT_MODE_ENABLED', null);
  }

  private disableEditMode(): void {
    this.isEditMode = false;
    document.body.style.cursor = '';
    this.deselectElement();
    this.postMessage('EDIT_MODE_DISABLED', null);
  }

  // ========== HTML Export ==========
  private sendFullHtml(): void {
    const clone = document.body.cloneNode(true) as HTMLElement;
    const editorElements = clone.querySelectorAll('[id^="__visual_edit_"]');
    editorElements.forEach((el) => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach((el) => {
      el.removeAttribute('contenteditable');
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
${document.head.innerHTML}
</head>
<body>
${clone.innerHTML}
</body>
</html>`;

    this.postMessage('FULL_HTML', { html });
  }

  // ========== Communication ==========
  private postMessage(type: MessageType, payload: unknown): void {
    console.log(`[visual-edit-script] postMessage: type=${type}`, payload);
    try {
      window.parent.postMessage({ type, payload }, '*');
      console.log(`[visual-edit-script] postMessage sent successfully`);
    } catch (error) {
      console.error(`[visual-edit-script] postMessage error:`, error);
    }
  }
}

// Initialize controller when DOM is ready
if (typeof window !== 'undefined') {
  const initController = () => {
    new VisualEditController();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initController);
  } else {
    initController();
  }
}

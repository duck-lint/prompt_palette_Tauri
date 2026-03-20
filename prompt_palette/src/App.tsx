import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Component,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "./App.css";
import {
  PROMPT_TEMPLATES,
  type PromptTemplate,
  renderPromptTemplate,
} from "./promptCatalog";

const PALETTE_SHOW_EVENT = "palette://show";
const HOTKEY_ERROR_EVENT = "palette://hotkey-error";
const TAURI_RUNTIME_AVAILABLE =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type RenderState = {
  rendered: string;
  validationError: string;
};

type BoundaryProps = {
  children: ReactNode;
};

type BoundaryState = {
  error: string | null;
};

class PaletteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: messageFrom(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Prompt Palette crashed", error, info);
  }

  private reset = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  override render() {
    if (this.state.error) {
      return (
        <main className="shell">
          <section className="frame crash-frame">
            <p className="eyebrow">Runtime Error</p>
            <h1>Palette crashed</h1>
            <div className="message message-error">{this.state.error}</div>
            <div className="actions">
              <button type="button" className="primary" onClick={this.reset}>
                Reload Palette
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unexpected error.";
}

function createValueMap(template: PromptTemplate): Record<string, string> {
  return Object.fromEntries(
    template.placeholders.map((placeholder) => [placeholder, ""]),
  );
}

function fieldCountLabel(count: number): string {
  return `${count} ${count === 1 ? "field" : "fields"}`;
}

function buildRenderState(
  template: PromptTemplate | null,
  values: Record<string, string>,
): RenderState {
  if (!template) {
    return { rendered: "", validationError: "" };
  }

  const rendered = renderPromptTemplate(template.content, values);

  try {
    JSON.parse(rendered);
    return { rendered, validationError: "" };
  } catch (cause) {
    return {
      rendered,
      validationError: `JSON validation failed: ${messageFrom(cause)}.`,
    };
  }
}

function AppContent() {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTemplate, setActiveTemplate] = useState<PromptTemplate | null>(
    null,
  );
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  const filtered = PROMPT_TEMPLATES.filter((template) =>
    template.name.toLowerCase().includes(deferredQuery.trim().toLowerCase()),
  );
  const filling = activeTemplate !== null;
  const selectedTemplate = activeTemplate ?? filtered[selectedIndex] ?? null;
  const currentPlaceholder =
    activeTemplate?.placeholders[placeholderIndex] ?? null;
  const currentValue = currentPlaceholder ? values[currentPlaceholder] ?? "" : "";
  const previewTemplate = activeTemplate ?? selectedTemplate;
  const previewValues = activeTemplate
    ? values
    : selectedTemplate
      ? createValueMap(selectedTemplate)
      : values;
  const previewState = buildRenderState(previewTemplate, previewValues);
  const finalStep =
    activeTemplate !== null &&
    placeholderIndex === activeTemplate.placeholders.length - 1;

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function reset(nextError = "") {
    setQuery("");
    setSelectedIndex(0);
    setActiveTemplate(null);
    setPlaceholderIndex(0);
    setValues({});
    setBusy(false);
    setNotice("");
    setError(nextError);
  }

  function focusActiveField() {
    requestAnimationFrame(() => {
      if (activeTemplate) {
        const textarea = valueRef.current;
        if (textarea) {
          textarea.focus();
          const end = textarea.value.length;
          textarea.setSelectionRange(end, end);
        }
      } else {
        const input = searchRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      }
    });
  }

  useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];

    async function bindEvents() {
      if (!TAURI_RUNTIME_AVAILABLE) {
        focusActiveField();
        return;
      }

      const unlistenShow = await listen(PALETTE_SHOW_EVENT, () => {
        reset();
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      });

      if (disposed) {
        unlistenShow();
        return;
      }

      cleanup.push(unlistenShow);

      const unlistenError = await listen<string>(HOTKEY_ERROR_EVENT, (event) => {
        reset(event.payload);
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      });

      if (disposed) {
        unlistenError();
        return;
      }

      cleanup.push(unlistenError);
      focusActiveField();
    }

    void bindEvents();

    return () => {
      disposed = true;
      cleanup.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!filling) setSelectedIndex(0);
  }, [deferredQuery, filling]);

  useEffect(() => {
    if (filling) return;
    if (filtered.length === 0) return;
    if (selectedIndex >= filtered.length) setSelectedIndex(filtered.length - 1);
  }, [filtered.length, filling, selectedIndex]);

  useEffect(() => {
    focusActiveField();
  }, [filling, placeholderIndex]);

  function startTemplate(template: PromptTemplate) {
    clearMessages();

    if (template.placeholders.length === 0) {
      void submitTemplate(template, {});
      return;
    }

    setActiveTemplate(template);
    setPlaceholderIndex(0);
    setValues(createValueMap(template));
  }

  function cancelFill() {
    setActiveTemplate(null);
    setPlaceholderIndex(0);
    setValues({});
    clearMessages();
  }

  async function hidePalette() {
    clearMessages();

    if (!TAURI_RUNTIME_AVAILABLE) {
      reset();
      return;
    }

    try {
      await invoke("hide_palette");
    } catch (cause) {
      setError(messageFrom(cause));
    }
  }

  async function copyRenderedOutput(
    template: PromptTemplate,
    nextValues: Record<string, string>,
  ) {
    const renderState = buildRenderState(template, nextValues);
    if (renderState.validationError) {
      setError(renderState.validationError);
      setNotice("");
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      if (TAURI_RUNTIME_AVAILABLE) {
        await invoke("copy_rendered_prompt", { rendered: renderState.rendered });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(renderState.rendered);
      } else {
        throw new Error("Clipboard access is unavailable in this browser preview.");
      }

      setNotice("Rendered JSON copied to the clipboard.");
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitTemplate(
    template: PromptTemplate,
    nextValues: Record<string, string>,
  ) {
    const renderState = buildRenderState(template, nextValues);
    if (renderState.validationError) {
      setError(renderState.validationError);
      setNotice("");
      return;
    }

    if (!TAURI_RUNTIME_AVAILABLE) {
      await copyRenderedOutput(template, nextValues);
      return;
    }

    setBusy(true);
    clearMessages();

    try {
      await invoke("paste_rendered_prompt", { rendered: renderState.rendered });
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setBusy(false);
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (busy) return;

    if (event.key === "Escape") {
      event.preventDefault();
      void hidePalette();
      return;
    }

    if (filtered.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, filtered.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const template = filtered[selectedIndex];
      if (template) startTemplate(template);
    }
  }

  function onFillKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (busy) return;

    if (event.nativeEvent.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancelFill();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void advanceFill();
    }
  }

  async function advanceFill() {
    if (!activeTemplate) return;

    const lastIndex = activeTemplate.placeholders.length - 1;
    if (placeholderIndex < lastIndex) {
      setPlaceholderIndex((current) => current + 1);
      return;
    }

    await submitTemplate(activeTemplate, values);
  }

  return (
    <main className="shell">
      <section className="frame">
        <header className="topbar">
          <div className="title-group">
            <p className="eyebrow">Prompt Palette</p>
            <h1>Search prompt templates, then fill fields.</h1>
          </div>

        </header>

        {error ? <div className="message message-error">{error}</div> : null}
        {notice ? <div className="message message-notice">{notice}</div> : null}

        {/* Search stays first so the palette feels like a command bar, not a dashboard. */}
        <section className="search-block">
          <label className="search-wrap" htmlFor="palette-search">
            <span className="search-label">Search prompt filename</span>
            <input
              ref={searchRef}
              id="palette-search"
              className="search"
              autoFocus={!filling}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="reg_quick_default, team_advisor, handoff..."
              disabled={filling || busy}
              spellCheck={false}
            />
          </label>

          <div className="search-meta">
            <span className="meta-copy">
              {filtered.length === PROMPT_TEMPLATES.length
                ? `Showing all ${PROMPT_TEMPLATES.length} prompts`
                : `${filtered.length} matches`}
            </span>
            <span className="meta-copy">
              {TAURI_RUNTIME_AVAILABLE
                ? "Enter opens the selected prompt. Esc hides the palette."
                : "Browser preview can render and copy JSON, but not paste into another app."}
            </span>
          </div>
        </section>

        <section className={`results-panel ${filling ? "muted" : ""}`}>
          {filtered.length === 0 ? (
            <div className="empty">
              No prompt names matched <code>{deferredQuery || "the filter"}</code>.
            </div>
          ) : (
            filtered.map((template, index) => (
              <button
                key={template.id}
                type="button"
                role="option"
                aria-selected={!filling && index === selectedIndex}
                className={[
                  "result",
                  !filling && index === selectedIndex ? "selected" : "",
                  activeTemplate?.id === template.id ? "active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => !filling && setSelectedIndex(index)}
                onDoubleClick={() => !filling && startTemplate(template)}
                onMouseEnter={() => !filling && setSelectedIndex(index)}
                disabled={filling || busy}
              >
                <span className="result-copy">
                  <strong>{template.name}</strong>
                  <span>{fieldCountLabel(template.placeholders.length)}</span>
                </span>
                <span className="result-meta">
                  {!filling && index === selectedIndex ? "Enter" : "Open"}
                </span>
              </button>
            ))
          )}
        </section>

        {/* This lower section is the only mode swap: preview when browsing, field entry when filling. */}
        <section className="detail-panel">
          {!selectedTemplate ? (
            <div className="empty">
              Search for a prompt above, then press <kbd>Enter</kbd> to open it.
            </div>
          ) : !filling ? (
            <>
              <div className="detail-head">
                <div>
                  <p className="label">Selected Prompt</p>
                  <h2>{selectedTemplate.name}</h2>
                </div>
                <span className="badge">
                  {selectedTemplate.placeholders.length === 0
                    ? "Ready now"
                    : fieldCountLabel(selectedTemplate.placeholders.length)}
                </span>
              </div>

              <div className="preview-shell">
                <div className="preview-head">
                  <span className="label">Template</span>
                  <span className="meta-copy">Raw JSON source</span>
                </div>
                <pre className="preview">{selectedTemplate.content}</pre>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => startTemplate(selectedTemplate)}
                  disabled={busy}
                >
                  {selectedTemplate.placeholders.length === 0
                    ? TAURI_RUNTIME_AVAILABLE
                      ? "Insert Prompt"
                      : "Copy JSON"
                    : "Use Template"}
                </button>
                {selectedTemplate.placeholders.length === 0 ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void copyRenderedOutput(selectedTemplate, {})}
                    disabled={busy}
                  >
                    Copy JSON
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void hidePalette()}
                  disabled={busy}
                >
                  Hide Palette
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="detail-head">
                <div>
                  <p className="label">Fill Fields</p>
                  <h2>{activeTemplate.name}</h2>
                </div>
                <span className="badge">
                  {placeholderIndex + 1} / {activeTemplate.placeholders.length}
                </span>
              </div>

              <div className="bar">
                <div
                  className="bar-fill"
                  style={{
                    width: `${
                      ((placeholderIndex + 1) / activeTemplate.placeholders.length) *
                      100
                    }%`,
                  }}
                />
              </div>

              <div className="chips">
                {activeTemplate.placeholders.map((placeholder, index) => (
                  <span
                    key={placeholder}
                    className={[
                      "chip",
                      index === placeholderIndex ? "chip-current" : "",
                      index < placeholderIndex ? "chip-done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {placeholder}
                  </span>
                ))}
              </div>

              <div className="field-head">
                <label className="field" htmlFor="field-value">
                  {currentPlaceholder}
                </label>
                <span className="field-meta">
                  {currentValue.length} chars, <kbd>Enter</kbd> next, <kbd>Shift</kbd> +{" "}
                  <kbd>Enter</kbd> newline
                </span>
              </div>

              <textarea
                ref={valueRef}
                id="field-value"
                className="textarea"
                autoFocus={filling}
                value={currentValue}
                onChange={(event) => {
                  if (!currentPlaceholder) return;

                  const nextValue = event.currentTarget.value;
                  setValues((current) => ({
                    ...current,
                    [currentPlaceholder]: nextValue,
                  }));
                }}
                onKeyDown={onFillKeyDown}
                placeholder="String content to inject into the JSON template"
                disabled={busy}
                spellCheck={false}
              />

              <div className="preview-shell">
                <div className="preview-head">
                  <span className="label">Live Render</span>
                  <span
                    className={[
                      "validation-pill",
                      previewState.validationError ? "invalid" : "valid",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {previewState.validationError ? "Needs Fix" : "JSON Valid"}
                  </span>
                </div>
                <pre className="preview">{previewState.rendered}</pre>
                {previewState.validationError ? (
                  <p className="inline-note inline-note-error">
                    {previewState.validationError}
                  </p>
                ) : (
                  <p className="inline-note">
                    This is the exact JSON that will be copied or pasted.
                  </p>
                )}
              </div>

              <div className="actions">
                {placeholderIndex > 0 ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setPlaceholderIndex((current) => Math.max(current - 1, 0))
                    }
                    disabled={busy}
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void copyRenderedOutput(activeTemplate, values)}
                  disabled={busy || Boolean(previewState.validationError)}
                >
                  Copy JSON
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={cancelFill}
                  disabled={busy}
                >
                  Back To Palette
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void advanceFill()}
                  disabled={busy}
                >
                  {busy
                    ? "Working..."
                    : finalStep
                      ? TAURI_RUNTIME_AVAILABLE
                        ? "Insert Prompt"
                        : "Copy JSON"
                      : "Next Field"}
                </button>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <PaletteErrorBoundary>
      <AppContent />
    </PaletteErrorBoundary>
  );
}

const promptModules = import.meta.glob("./prompts/*.json", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

function extractPlaceholders(content: string): string[] {
  const seen = new Set<string>();

  for (const match of content.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
    }
  }

  return Array.from(seen);
}

function escapeJsonStringContent(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/g, "\n")).slice(1, -1);
}

export type PromptTemplate = {
  id: string;
  name: string;
  content: string;
  placeholders: string[];
};

export const PROMPT_TEMPLATES: PromptTemplate[] = Object.entries(promptModules)
  .map(([path, content]) => {
    const parts = path.split("/");
    const fileName = parts[parts.length - 1] ?? path;
    const name = fileName.replace(/\.json$/i, "");

    return {
      id: name,
      name,
      content: content.trim(),
      placeholders: extractPlaceholders(content),
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

export function renderPromptTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? escapeJsonStringContent(values[key] ?? "")
      : match,
  );
}

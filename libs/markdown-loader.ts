import { readFileSync } from "node:fs";

/**
 * Load a Markdown file as UTF-8 text.
 * Relative paths are resolved from the current working directory.
 * Use new URL("./file.md", import.meta.url) for module-relative paths.
 */
export const loadMarkdown = (filePath: string | URL): string => {
    return readFileSync(filePath, "utf8");
};

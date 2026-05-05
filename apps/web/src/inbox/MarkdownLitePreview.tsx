import type { ReactNode } from "react";

import { EmptyState, cn } from "@nuoma/ui";

type MarkdownBlock =
  | { type: "blockquote"; text: string }
  | { type: "heading"; depth: 1 | 2 | 3; text: string }
  | { type: "list"; items: Array<{ checked: boolean | null; text: string }> }
  | { type: "paragraph"; text: string };

const headingPattern = /^(#{1,3})\s+(.+)$/;
const checklistPattern = /^[-*]\s+\[([ xX])]\s+(.+)$/;
const listPattern = /^[-*]\s+(.+)$/;
const orderedListPattern = /^\d+\.\s+(.+)$/;
const blockquotePattern = /^>\s+(.+)$/;
const tokenPatterns = [
  { type: "link", pattern: /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/ },
  { type: "code", pattern: /`([^`]+)`/ },
  { type: "strong", pattern: /\*\*([^*]+)\*\*/ },
  { type: "em", pattern: /(^|[\s([{])\*([^*]+)\*/ },
] as const;

export function MarkdownLitePreview({ value }: { value: string }) {
  const blocks = parseMarkdownLite(value);

  if (blocks.length === 0) {
    return (
      <div data-testid="inbox-contact-notes-preview">
        <EmptyState title="Sem preview" description="As notas salvas aparecem aqui." />
      </div>
    );
  }

  return (
    <div
      data-testid="inbox-contact-notes-preview"
      className="space-y-2 rounded-lg bg-bg-base p-3 text-sm shadow-pressed-sm"
    >
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdownLite(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = headingPattern.exec(trimmed);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      index += 1;
      continue;
    }

    const blockquote = blockquotePattern.exec(trimmed);
    if (blockquote) {
      blocks.push({ type: "blockquote", text: blockquote[1]! });
      index += 1;
      continue;
    }

    if (isListLine(trimmed)) {
      const items: MarkdownBlock & { type: "list" } = { type: "list", items: [] };
      while (index < lines.length) {
        const current = lines[index]?.trim() ?? "";
        const parsed = parseListLine(current);
        if (!parsed) break;
        items.items.push(parsed);
        index += 1;
      }
      blocks.push(items);
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? "";
      if (!current || headingPattern.test(current) || blockquotePattern.test(current)) break;
      if (isListLine(current)) break;
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  if (block.type === "heading") {
    const Tag = block.depth === 1 ? "h3" : block.depth === 2 ? "h4" : "h5";
    return (
      <Tag
        key={`heading-${index}`}
        data-testid="inbox-contact-notes-preview-heading"
        className={cn(
          "font-medium text-fg-primary",
          block.depth === 1 && "text-base",
          block.depth === 2 && "text-sm",
          block.depth === 3 && "text-xs uppercase tracking-widest",
        )}
      >
        {renderInline(block.text, `heading-${index}`)}
      </Tag>
    );
  }

  if (block.type === "blockquote") {
    return (
      <blockquote
        key={`quote-${index}`}
        className="border-l-2 border-brand-cyan/45 pl-3 text-xs text-fg-muted"
      >
        {renderInline(block.text, `quote-${index}`)}
      </blockquote>
    );
  }

  if (block.type === "list") {
    return (
      <ul key={`list-${index}`} className="space-y-1">
        {block.items.map((item, itemIndex) => (
          <li
            key={`list-${index}-${itemIndex}`}
            data-testid="inbox-contact-notes-preview-list-item"
            className="flex min-w-0 items-start gap-2 text-xs text-fg-primary"
          >
            <span
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-cyan",
                item.checked === true &&
                  "h-3.5 w-3.5 rounded border border-brand-cyan bg-brand-cyan",
                item.checked === false &&
                  "h-3.5 w-3.5 rounded border border-contour-line bg-bg-base",
              )}
            />
            <span className={cn("min-w-0", item.checked === true && "text-fg-muted line-through")}>
              {renderInline(item.text, `list-${index}-${itemIndex}`)}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p key={`paragraph-${index}`} className="text-xs leading-relaxed text-fg-primary">
      {renderInline(block.text, `paragraph-${index}`)}
    </p>
  );
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let tokenIndex = 0;

  while (remaining.length > 0) {
    const next = findNextToken(remaining);
    if (!next) {
      nodes.push(remaining);
      break;
    }

    if (next.index > 0) {
      nodes.push(remaining.slice(0, next.index));
    }

    const key = `${keyPrefix}-${tokenIndex}`;
    if (next.type === "link") {
      nodes.push(
        <a
          key={key}
          href={next.match[2]}
          target="_blank"
          rel="noreferrer"
          data-testid="inbox-contact-notes-preview-link"
          className="text-brand-cyan underline decoration-brand-cyan/40 underline-offset-2"
        >
          {next.match[1]}
        </a>,
      );
    } else if (next.type === "code") {
      nodes.push(
        <code
          key={key}
          data-testid="inbox-contact-notes-preview-inline-code"
          className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[0.7rem] text-brand-cyan"
        >
          {next.match[1]}
        </code>,
      );
    } else if (next.type === "strong") {
      nodes.push(
        <strong key={key} className="font-semibold text-fg-primary">
          {next.match[1]}
        </strong>,
      );
    } else {
      if (next.match[1]) {
        nodes.push(next.match[1]);
      }
      nodes.push(
        <em key={key} className="text-fg-primary">
          {next.match[2]}
        </em>,
      );
    }

    remaining = remaining.slice(next.index + next.match[0].length);
    tokenIndex += 1;
  }

  return nodes;
}

function findNextToken(text: string): {
  index: number;
  match: RegExpExecArray;
  type: (typeof tokenPatterns)[number]["type"];
} | null {
  let next: {
    index: number;
    match: RegExpExecArray;
    type: (typeof tokenPatterns)[number]["type"];
  } | null = null;

  for (const token of tokenPatterns) {
    token.pattern.lastIndex = 0;
    const match = token.pattern.exec(text);
    if (!match) continue;
    if (!next || match.index < next.index) {
      next = { index: match.index, match, type: token.type };
    }
  }

  return next;
}

function isListLine(line: string): boolean {
  return checklistPattern.test(line) || listPattern.test(line) || orderedListPattern.test(line);
}

function parseListLine(line: string): { checked: boolean | null; text: string } | null {
  const checklist = checklistPattern.exec(line);
  if (checklist) {
    return { checked: checklist[1]?.toLowerCase() === "x", text: checklist[2]! };
  }
  const unordered = listPattern.exec(line);
  if (unordered) {
    return { checked: null, text: unordered[1]! };
  }
  const ordered = orderedListPattern.exec(line);
  if (ordered) {
    return { checked: null, text: ordered[1]! };
  }
  return null;
}

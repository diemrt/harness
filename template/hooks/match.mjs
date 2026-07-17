const REGEX_META_CHARS = new Set([".", "+", "(", ")", "[", "]", "$", "^", "|", "\\"]);

/**
 * Convert a minimal glob pattern to an anchored RegExp.
 * Supported tokens: globstar+slash, globstar, star, question-mark.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let source = "^";

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    const afterNext = pattern[i + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      i += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    if (REGEX_META_CHARS.has(char)) {
      source += `\\${char}`;
      continue;
    }

    source += char;
  }

  source += "$";
  return new RegExp(source);
}

/**
 * Check whether a path matches at least one glob pattern.
 * @param {string} path
 * @param {string[] | undefined} patterns
 * @returns {boolean}
 */
export function matchesAny(path, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

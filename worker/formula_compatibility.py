"""Deterministic, bounded compatibility rewrites; no model-specific formulas."""
from __future__ import annotations

import re


class FormulaCompatibilityError(ValueError):
    pass


_TOKEN = re.compile(r'"(?:""|[^"])*"|\'(?:\'\'|[^\'])*\'|\$?[A-Za-z]{1,3}\$?[1-9][0-9]*\b|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?|[A-Za-z_\\][A-Za-z0-9_.\\]*|\s+|.', re.S)
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_CELL = re.compile(r"^[A-Za-z]{1,3}[1-9][0-9]*$")
_VOLATILE = {"RAND", "RANDBETWEEN", "RANDARRAY", "NOW", "TODAY", "OFFSET", "INDIRECT", "LAMBDA"}
MAX_FORMULA = 8192


def _name(value: str) -> str:
    return value.casefold().removeprefix("_xlpm.")


def _function(value: str) -> str:
    return value.upper().removeprefix("_XLFN.")


def _next(tokens: list[str], index: int) -> int:
    while index < len(tokens) and tokens[index].isspace():
        index += 1
    return index


def _arguments(tokens: list[str], opening: int) -> tuple[list[list[str]], int]:
    args: list[list[str]] = []
    start, depth, array_depth = opening + 1, 1, 0
    for index in range(start, len(tokens)):
        token = tokens[index]
        if token == "(": depth += 1
        elif token == ")":
            depth -= 1
            if depth == 0:
                args.append(tokens[start:index])
                return args, index
        elif token == "{": array_depth += 1
        elif token == "}": array_depth -= 1
        elif token == "," and depth == 1 and array_depth == 0:
            args.append(tokens[start:index])
            start = index + 1
    raise FormulaCompatibilityError("An Excel LET expression has unbalanced parentheses.")


def inline_let(formula: str) -> tuple[str, int]:
    """Expand deterministic LET bindings with lexical scope and exact token matching.

    Strings, quoted worksheet names, cell addresses and qualified references are
    never substituted. Every inserted expression is parenthesized. Volatile or
    callable bindings are deliberately unsupported because repetition can change
    their meaning. The caller must still compare recalculated outputs to Excel.
    """
    if not isinstance(formula, str) or len(formula) > MAX_FORMULA:
        raise FormulaCompatibilityError("A formula exceeds the supported size.")
    tokens = _TOKEN.findall(formula)
    has_let = any(_function(t) == "LET" and (n := _next(tokens, i + 1)) < len(tokens) and tokens[n] == "(" for i, t in enumerate(tokens))
    if not has_let:
        return formula, 0
    for index, token in enumerate(tokens):
        following = _next(tokens, index + 1)
        if _function(token) in _VOLATILE and following < len(tokens) and tokens[following] == "(":
            raise FormulaCompatibilityError("LET with volatile functions or callable bindings needs compatibility review.")
    count = 0

    def expand(parts: list[str], environment: dict[str, str], depth: int = 0) -> str:
        nonlocal count
        if depth > 40:
            raise FormulaCompatibilityError("LET nesting exceeds the supported limit.")
        output: list[str] = []
        size, index = 0, 0
        while index < len(parts):
            token = parts[index]
            following = _next(parts, index + 1)
            if _function(token) == "LET" and following < len(parts) and parts[following] == "(":
                args, closing = _arguments(parts, following)
                if len(args) < 3 or len(args) % 2 != 1 or len(args) > 253:
                    raise FormulaCompatibilityError("An Excel LET expression has an unsupported argument list.")
                local = dict(environment)
                local_names: set[str] = set()
                for offset in range(0, len(args) - 1, 2):
                    raw_name = "".join(args[offset]).strip()
                    plain_name = re.sub(r'^_xlpm\.', '', raw_name, flags=re.I)
                    key = _name(raw_name)
                    if not _NAME.fullmatch(plain_name) or _CELL.fullmatch(plain_name) or key in local_names:
                        raise FormulaCompatibilityError("An Excel LET binding name requires review.")
                    local[key] = expand(args[offset + 1], local, depth + 1)
                    local_names.add(key)
                replacement = "(" + expand(args[-1], local, depth + 1) + ")"
                count += 1
                index = closing + 1
            elif _name(token) in environment and not token.startswith(("'", '"')):
                previous = index - 1
                while previous >= 0 and parts[previous].isspace(): previous -= 1
                if (following < len(parts) and parts[following] == "("):
                    raise FormulaCompatibilityError("Callable LET bindings require compatibility review.")
                qualified = (following < len(parts) and parts[following] == "!") or (previous >= 0 and parts[previous] == "!")
                replacement = token if qualified else "(" + environment[_name(token)] + ")"
                index += 1
            else:
                replacement = token
                index += 1
            size += len(replacement)
            if size > MAX_FORMULA:
                raise FormulaCompatibilityError("An expanded formula exceeds Excel's formula size limit.")
            output.append(replacement)
        return "".join(output)

    result = expand(tokens, {})
    return result, count


def inline_nested_let(formula: str) -> tuple[str, int]:
    """Keep supported outer LET expressions and expand only nested bindings.

    Outer aliases remain bound once by Calc, which avoids unnecessary formula
    growth and retains their evaluation semantics.
    """
    if len(formula) > MAX_FORMULA:
        raise FormulaCompatibilityError('A formula exceeds the supported size.')
    tokens = _TOKEN.findall(formula)
    count = 0

    def walk(parts: list[str], inside: bool = False, depth: int = 0) -> str:
        nonlocal count
        if depth > 40: raise FormulaCompatibilityError('LET nesting exceeds the supported limit.')
        output, index = [], 0
        while index < len(parts):
            following = _next(parts, index + 1)
            if _function(parts[index]) == 'LET' and following < len(parts) and parts[following] == '(':
                arguments, closing = _arguments(parts, following)
                if inside:
                    text, rewritten = inline_let(''.join(parts[index:closing + 1]))
                    output.append(text)
                    count += rewritten
                else:
                    output.append(''.join(parts[index:following + 1]))
                    output.append(','.join(walk(argument, True, depth + 1) for argument in arguments))
                    output.append(')')
                index = closing + 1
            else:
                output.append(parts[index])
                index += 1
        result = ''.join(output)
        if len(result) > MAX_FORMULA: raise FormulaCompatibilityError('An expanded formula exceeds Excel\'s formula size limit.')
        return result

    return walk(tokens), count

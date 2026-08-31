/**
 * Read a package's DataModel field sets out of its source, as data.
 *
 * The consuming half of this contract already lives in `schema-check.mjs`: a
 * content build subtracts what its builders emit from what a document will
 * actually receive, because Foundry discards an unknown `system` key at
 * construction and says nothing about it (#60). What was missing is the
 * producing half — until now each system carried its own extractor, and the
 * first one to exist hardcoded {@link SCHEMA_ARTIFACT_VERSION}, a constant this
 * package owns. Two producers stamping a third repository's constant by hand is
 * the drift this module exists to remove: the version is imported, not restated.
 *
 * ## Read from the source, not from a running Foundry
 *
 * A DataModel's schema is only introspectable inside Foundry: `defineSchema()`
 * returns `new StringField(...)` and friends, which do not exist in Node. So
 * this reads the AST rather than a regex, because every shape it has to follow
 * is structural rather than textual.
 *
 * TypeScript's parser reads plain JavaScript too, which is what makes one
 * reader serve both shapes in play — `sohl` is TypeScript, `hm3` is JavaScript.
 * That is also why the dependency sits *here*: this package already pins the
 * compiler for `coverage.mjs`, so a JavaScript-only repository does not acquire
 * a TypeScript pin merely to describe its own data models.
 *
 * ## The shapes it follows
 *
 * - **A registry, not a directory walk.** The subtype → DataModel map is the
 *   canonical statement of which subtypes exist. Walking `*Model.js` instead
 *   would publish schemas for classes nothing registers, and would silently
 *   miss one whose filename does not match.
 * - **Inheritance, however it is spelled.** `...Super.defineSchema()`,
 *   `...super.defineSchema()`, `Object.assign(super.defineSchema(), {…})` and a
 *   subclass with no `defineSchema()` at all are four spellings of one idea.
 *   All four are followed, because which one a repository uses is a matter of
 *   house style and says nothing about the schema.
 * - **Delegation.** `defineSchema() { return defineXDataSchema(); }` is followed
 *   to the function that builds the literal.
 * - **`SchemaField` nests.** `charges: new SchemaField({ value, max })` records
 *   `charges`, `charges.value` and `charges.max`, because a builder may write
 *   the whole object or the leaves. Written bare or as `fields.SchemaField`,
 *   since both spellings are in use.
 * - **A sub-schema built by a function.** `skillBase: skillBaseField()` is as
 *   much a declaration as the constructor it wraps, so the call is followed to
 *   it. Reading only the constructor form recorded `skillBase` with no keys
 *   beneath it while the content that fills it writes `skillBase.value` — a
 *   correctly authored field reported as undeclared.
 *
 * ## What it does not claim to know
 *
 * A `SchemaField` whose argument is *computed* —
 * `new SchemaField(Object.fromEntries(ABILITIES.map(…)))` — is recorded as a
 * field with no keys beneath it. Recording the field is what matters: an
 * emitted `abilities.str.base` is not reported as undeclared, because the check
 * treats a declared ancestor as covering what lies under it. But the keys
 * themselves are not enumerated, so a *misspelled* one inside such a container
 * passes unnoticed. That is a deliberate limit rather than an oversight —
 * guessing at keys this cannot see would let the check report confidently on a
 * shape it invented, which is the failure mode the whole comparison exists to
 * remove.
 *
 * Fields reached by inheritance are recorded apart from the subtype's own,
 * because the two answer different questions: a builder must not emit a field
 * nothing declares *anywhere*, but it is not expected to fill the system's own
 * inherited machinery.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { SCHEMA_ARTIFACT_VERSION } from "./schema-check.mjs";

/**
 * Which files a specifier may resolve to, in order.
 *
 * `.ts` leads because a TypeScript repository also ships compiled `.js`
 * alongside its sources in some layouts, and the source is the thing being
 * described.
 */
const EXTENSIONS = [".ts", ".js", ".mjs"];

/**
 * Parse one file into an AST, memoised per run.
 *
 * The memo matters more than it looks: a registry file is re-read once per
 * subtype otherwise, and an inheritance chain re-reads its base class once per
 * leaf. Both are quadratic on a file that never changes mid-run.
 *
 * @param {string} file - Absolute path.
 * @param {Map<string, ts.SourceFile>} cache - The per-run memo.
 * @returns {ts.SourceFile} The parsed file.
 */
function parse(file, cache) {
    const hit = cache.get(file);
    if (hit) return hit;
    const src = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
    );
    cache.set(file, src);
    return src;
}

/** A property name, whether written bare, quoted or computed-as-literal. */
function propName(name) {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name)) return name.text;
    return name.getText();
}

/**
 * The `subtype: ClassName` entries of a registry object literal.
 *
 * @param {ts.SourceFile} src - The parsed file holding the registry.
 * @param {string} name - The registry binding, e.g. `itemModels`.
 * @returns {Map<string, string>} Subtype to DataModel class name.
 */
export function registryOf(src, name) {
    const out = new Map();
    const visit = (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name &&
            node.initializer
        ) {
            // `{…} satisfies ItemDMMap` and `{…} as const` both wrap the
            // literal without changing it.
            let init = node.initializer;
            if (ts.isSatisfiesExpression?.(init) || ts.isAsExpression(init)) {
                init = init.expression;
            }
            if (ts.isObjectLiteralExpression(init)) {
                for (const p of init.properties) {
                    if (
                        ts.isPropertyAssignment(p) &&
                        ts.isIdentifier(p.initializer)
                    ) {
                        out.set(propName(p.name), p.initializer.text);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(src);
    return out;
}

/**
 * The `tsconfig.json` path aliases, read rather than restated.
 *
 * A TypeScript repository may import every DataModel through `@src/…`, so a
 * resolver that understood only relative specifiers would find none of them.
 * Reading the mapping means adding an alias there does not silently make a
 * subtype unreadable here.
 *
 * Absent for a JavaScript repository, which is not an error — it simply has no
 * aliases to resolve.
 *
 * @param {string} rootDir - The repository root.
 * @returns {[string, string][]} Prefix to directory, longest prefix first.
 */
export function pathAliases(rootDir) {
    const file = path.join(rootDir, "tsconfig.json");
    if (!fs.existsSync(file)) return [];
    // Parsed as plain JSON, deliberately. `tsconfig.json` *permits* comments,
    // and a regex stripping `/* … */` eats from the slash-star inside a path
    // string like `"@types/*"` to the next one, corrupting the file it was
    // meant to clean. If comments ever appear, reach for a JSONC parser.
    let json;
    try {
        json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return [];
    }
    const paths = json.compilerOptions?.paths ?? {};
    return Object.entries(paths)
        .filter(([, target]) => Array.isArray(target) && target.length)
        .map(([alias, [target]]) => [
            alias.replace(/\*$/, ""),
            path.resolve(rootDir, String(target).replace(/\*$/, "")),
        ])
        .sort((a, b) => b[0].length - a[0].length);
}

/** Resolve an import specifier — relative or aliased — to a file on disk. */
function resolveSpecifier(fromDir, spec, aliases) {
    let base = null;
    if (spec.startsWith(".")) {
        base = path.resolve(fromDir, spec.replace(/\.(m?js|ts)$/, ""));
    } else {
        for (const [prefix, dir] of aliases) {
            if (!spec.startsWith(prefix)) continue;
            base = path.join(dir, spec.slice(prefix.length));
            break;
        }
    }
    if (!base) return null;
    for (const ext of EXTENSIONS) {
        for (const candidate of [
            `${base}${ext}`,
            path.join(base, `index${ext}`),
        ]) {
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Where an imported name comes from, resolved to a file on disk.
 *
 * @param {ts.SourceFile} src - The importing file.
 * @param {string} name - The imported binding.
 * @param {[string, string][]} aliases - From {@link pathAliases}.
 * @returns {string|null} An absolute path, or `null` when not imported.
 */
function importSourceOf(src, name, aliases) {
    let found = null;
    ts.forEachChild(src, (node) => {
        if (found || !ts.isImportDeclaration(node)) return;
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) return;
        if (!bindings.elements.some((e) => e.name.text === name)) return;
        const spec = node.moduleSpecifier;
        if (!ts.isStringLiteral(spec)) return;
        found = resolveSpecifier(
            path.dirname(src.fileName),
            spec.text,
            aliases,
        );
    });
    return found;
}

/** The class declaration for `className`, if this file declares it. */
function classDeclIn(src, className) {
    let found = null;
    const visit = (node) => {
        if (found) return;
        if (ts.isClassDeclaration(node) && node.name?.text === className) {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(src);
    return found;
}

/**
 * Find a class, in the file that names it or in the file that file imports it
 * from.
 *
 * Both orders occur: a registry may sit in the same file as the classes it
 * maps, or in a configuration module that imports every one of them. Looking
 * locally first means neither layout needs to be declared.
 *
 * @returns {{file: string, src: ts.SourceFile, decl: ts.ClassDeclaration}|null}
 */
function locateClass(fromFile, className, aliases, cache) {
    const src = parse(fromFile, cache);
    const decl = classDeclIn(src, className);
    if (decl) return { file: fromFile, src, decl };

    const imported = importSourceOf(src, className, aliases);
    if (!imported) return null;
    const importedSrc = parse(imported, cache);
    const importedDecl = classDeclIn(importedSrc, className);
    return importedDecl ?
            { file: imported, src: importedSrc, decl: importedDecl }
        :   null;
}

/**
 * The name of the class this one extends, when that is a plain identifier.
 *
 * `extends foundry.abstract.TypeDataModel` deliberately yields `null`: the
 * Foundry base is where the walk stops, and it is spelled as a property access
 * rather than an identifier in every repository here, so the shape that ends
 * the chain is also the shape this cannot follow.
 */
function superClassOf(decl) {
    for (const clause of decl.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        const [type] = clause.types;
        if (type && ts.isIdentifier(type.expression))
            return type.expression.text;
    }
    return null;
}

/** The expression a function body returns, if it returns one directly. */
function returnExpression(body) {
    let found = null;
    const visit = (node) => {
        if (found) return;
        if (ts.isReturnStatement(node) && node.expression) {
            found = node.expression;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
}

/** The object literal a function body returns, if it returns one directly. */
function returnedLiteral(body) {
    if (ts.isObjectLiteralExpression(body)) return body;
    const expr = returnExpression(body);
    return expr && ts.isObjectLiteralExpression(expr) ? expr : null;
}

/**
 * The object literal a named local function or arrow returns.
 *
 * @param {ts.SourceFile} src - The file being read.
 * @param {string} fnName - The function to resolve.
 * @returns {ts.ObjectLiteralExpression|null} The literal it returns.
 */
function literalReturnedBy(src, fnName) {
    let literal = null;
    const visit = (node) => {
        if (literal) return;
        const isTarget =
            (ts.isFunctionDeclaration(node) && node.name?.text === fnName) ||
            (ts.isVariableDeclaration(node) &&
                ts.isIdentifier(node.name) &&
                node.name.text === fnName);
        if (isTarget) {
            const body =
                ts.isFunctionDeclaration(node) ? node.body
                : node.initializer && ts.isArrowFunction(node.initializer) ?
                    node.initializer.body
                :   null;
            if (body) literal = returnedLiteral(body);
        }
        ts.forEachChild(node, visit);
    };
    visit(src);
    return literal;
}

/** `X.defineSchema()` or `super.defineSchema()`, as an inheritance edge. */
function schemaCallEdge(expr) {
    if (!ts.isCallExpression(expr)) return null;
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) {
        // `...defineSohlItemDataSchema()` — a local builder function.
        return { kind: "local", name: callee.text };
    }
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (callee.name.text !== "defineSchema") return null;
    if (callee.expression.kind === ts.SyntaxKind.SuperKeyword) {
        return { kind: "super", name: null };
    }
    if (ts.isIdentifier(callee.expression)) {
        return { kind: "class", name: callee.expression.text };
    }
    return null;
}

/** `Object.assign(…)`. */
function isObjectAssign(expr) {
    return (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression) &&
        expr.expression.expression.text === "Object" &&
        expr.expression.name.text === "assign"
    );
}

/**
 * What a class's `defineSchema()` contributes: its own literals, and the edges
 * it inherits along.
 *
 * A subclass with no `defineSchema()` at all contributes nothing of its own and
 * inherits everything — `class MiscGearModel extends GearModel {}` is a real
 * and meaningful declaration, not a gap in the data.
 *
 * @returns {{literals: ts.ObjectLiteralExpression[], edges: object[]}|null}
 *   `null` when the class declares a `defineSchema()` this cannot follow.
 */
function schemaContributions(src, decl) {
    const method = decl.members.find(
        (m) =>
            ts.isMethodDeclaration(m) &&
            propName(m.name) === "defineSchema" &&
            m.body,
    );
    // No `defineSchema()` — the whole schema is the parent's.
    if (!method)
        return { literals: [], edges: [{ kind: "super", name: null }] };

    const direct = returnedLiteral(method.body);
    if (direct) return { literals: [direct], edges: [] };

    const ret = returnExpression(method.body);
    if (!ret) return null;

    // `return Object.assign(super.defineSchema(), { … })`. Every object
    // literal argument contributes fields — including the `{}` some styles
    // pass as the target — and every `defineSchema()` call is an edge.
    if (isObjectAssign(ret)) {
        const literals = [];
        const edges = [];
        for (const arg of ret.arguments) {
            if (ts.isObjectLiteralExpression(arg)) literals.push(arg);
            const edge = schemaCallEdge(arg);
            if (edge) edges.push(edge);
        }
        return { literals, edges };
    }

    // `return defineXDataSchema();` — follow the identifier once.
    const edge = schemaCallEdge(ret);
    if (edge?.kind === "local") {
        const lit = literalReturnedBy(src, edge.name);
        if (lit) return { literals: [lit], edges: [] };
    }
    return null;
}

/** Whether an expression is a `SchemaField` construction, however spelled. */
function isSchemaField(expr) {
    if (!ts.isNewExpression(expr)) return false;
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) return callee.text === "SchemaField";
    // `new fields.SchemaField({ … })`
    if (ts.isPropertyAccessExpression(callee)) {
        return callee.name.text === "SchemaField";
    }
    return false;
}

/**
 * The expression a named local function or arrow returns.
 *
 * The literal-only variant above answers "what schema does this build"; this
 * one answers "what is this call, really", which a factory returning a field
 * rather than a schema needs.
 */
function returnedExpressionOf(src, fnName) {
    let found = null;
    const visit = (node) => {
        if (found) return;
        const isTarget =
            (ts.isFunctionDeclaration(node) && node.name?.text === fnName) ||
            (ts.isVariableDeclaration(node) &&
                ts.isIdentifier(node.name) &&
                node.name.text === fnName);
        if (isTarget) {
            const body =
                ts.isFunctionDeclaration(node) ? node.body
                : node.initializer && ts.isArrowFunction(node.initializer) ?
                    node.initializer.body
                :   null;
            if (body) {
                found =
                    ts.isObjectLiteralExpression(body) ? body : (
                        returnExpression(body)
                    );
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(src);
    return found;
}

/**
 * The `SchemaField` an expression amounts to, following a local factory.
 *
 * A repeated sub-schema is often extracted into a function —
 * `skillBase: skillBaseField()` — and the call is as much a `SchemaField`
 * declaration as the constructor it wraps. Reading only the constructor form
 * recorded `skillBase` with no keys beneath it, while the content that fills it
 * writes `skillBase.value`; the check would then have called a correctly
 * authored field undeclared, on every note that carries one.
 *
 * Recursion is guarded by name: a factory that returns a call to itself would
 * otherwise not terminate.
 *
 * @param {ts.Expression} expr - The property's initializer.
 * @param {ts.SourceFile} src - The file it lives in.
 * @param {Set<string>} [seen] - Factory names already followed.
 * @returns {ts.NewExpression|null} The construction, or `null`.
 */
function schemaFieldOf(expr, src, seen = new Set()) {
    if (isSchemaField(expr)) return expr;
    if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) {
        return null;
    }
    const name = expr.expression.text;
    if (seen.has(name)) return null;
    seen.add(name);
    const returned = returnedExpressionOf(src, name);
    return returned ? schemaFieldOf(returned, src, seen) : null;
}

/**
 * The keys of a `new SchemaField({ … })`, recursively dotted.
 *
 * A `SchemaField` whose argument is *computed* rather than written out —
 * `new SchemaField(Object.fromEntries(ABILITIES.map(…)))` — yields no keys.
 * The field itself is still recorded, so nothing beneath it is reported as
 * undeclared; it is simply not described in detail. See the module docstring.
 */
function nestedKeysOf(expr, src) {
    const field = schemaFieldOf(expr, src);
    if (!field) return [];
    const arg = field.arguments?.[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return [];
    const out = [];
    for (const p of arg.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = propName(p.name);
        out.push(key);
        for (const child of nestedKeysOf(p.initializer, src)) {
            out.push(`${key}.${child}`);
        }
    }
    return out;
}

/**
 * Every field path an object literal declares, and what it spreads.
 *
 * @returns {{own: string[], edges: object[]}}
 */
function readLiteral(src, literal) {
    const own = [];
    const edges = [];
    for (const p of literal.properties) {
        if (ts.isSpreadAssignment(p)) {
            const edge = schemaCallEdge(p.expression);
            if (edge) edges.push(edge);
            continue;
        }
        if (!ts.isPropertyAssignment(p)) continue;
        const key = propName(p.name);
        own.push(key);
        for (const child of nestedKeysOf(p.initializer, src)) {
            own.push(`${key}.${child}`);
        }
    }
    return { own, edges };
}

/**
 * Resolve one subtype's schema into own and inherited field paths.
 *
 * @param {object} opts - Resolution inputs.
 * @param {string} opts.file - The file naming the class (registry or importer).
 * @param {string} opts.className - The DataModel class.
 * @param {[string, string][]} opts.aliases - From {@link pathAliases}.
 * @param {Map<string, ts.SourceFile>} opts.cache - The per-run parse memo.
 * @param {string} opts.rootDir - For readable error paths.
 * @returns {{own: string[], inherited: string[]}}
 */
export function fieldsForClass({ file, className, aliases, cache, rootDir }) {
    const own = [];
    const inherited = [];
    const seen = new Set();

    /**
     * Walk one class, attributing the fields it declares itself to `into` and
     * everything above it to `inherited`.
     */
    const walkClass = (fromFile, name, into) => {
        const key = `class:${fromFile}:${name}`;
        if (seen.has(key)) return;
        seen.add(key);

        const located = locateClass(fromFile, name, aliases, cache);
        if (!located) return;
        const contributions = schemaContributions(located.src, located.decl);
        if (!contributions) return;
        const superName = superClassOf(located.decl);

        for (const literal of contributions.literals) {
            walkLiteral(located, literal, into, superName);
        }
        for (const edge of contributions.edges) {
            followEdge(located, edge, superName);
        }
    };

    /** Walk a schema literal, following the spreads inside it. */
    const walkLiteral = (located, literal, into, superName) => {
        const { own: fields, edges } = readLiteral(located.src, literal);
        into.push(...fields);
        for (const edge of edges) followEdge(located, edge, superName);
    };

    /** Follow one inheritance edge; everything it reaches is inherited. */
    const followEdge = (located, edge, superName) => {
        if (edge.kind === "local") {
            const key = `local:${located.file}:${edge.name}`;
            if (seen.has(key)) return;
            seen.add(key);
            // A local spread inside a subtype's own definition is still the
            // parent's contribution — a shared `defineXDataSchema()` is where
            // the common fields come from — so it lands in `inherited`
            // whichever file it is written in.
            const lit = literalReturnedBy(located.src, edge.name);
            if (lit) walkLiteral(located, lit, inherited, superName);
            return;
        }
        const name = edge.kind === "super" ? superName : edge.name;
        if (name) walkClass(located.file, name, inherited);
    };

    const located = locateClass(file, className, aliases, cache);
    if (!located) {
        throw new Error(
            `${className} is registered in ` +
                `${path.relative(rootDir, file)} but its declaration cannot be ` +
                `found there or in anything it imports, so its schema cannot ` +
                `be read.`,
        );
    }
    if (!schemaContributions(located.src, located.decl)) {
        throw new Error(
            `${className} (${path.relative(rootDir, located.file)}) declares a ` +
                `defineSchema() this reader cannot follow.`,
        );
    }

    walkClass(file, className, own);

    const ownSet = new Set(own);
    return {
        own: [...ownSet].sort(),
        inherited: [...new Set(inherited)].filter((f) => !ownSet.has(f)).sort(),
    };
}

/**
 * Build the whole artifact from a package's source.
 *
 * @param {object} opts - Inputs.
 * @param {string} opts.rootDir - The repository root.
 * @param {object[]} opts.registries - `{documentType, from, registry}` entries.
 * @param {string} opts.packageId - The Foundry package id.
 * @param {string} opts.version - The package version.
 * @returns {object} The artifact `schema-check.mjs` reads.
 */
export function buildSchemaArtifact({
    rootDir,
    registries,
    packageId,
    version,
}) {
    const aliases = pathAliases(rootDir);
    const cache = new Map();
    const documents = {};

    for (const { documentType, from, registry } of registries) {
        const file = path.resolve(rootDir, from);
        if (!fs.existsSync(file)) {
            throw new Error(
                `packageBuild.schema.${documentType}.from names ${from}, ` +
                    `which does not exist.`,
            );
        }
        const map = registryOf(parse(file, cache), registry);
        if (!map.size) {
            throw new Error(
                `\`${registry}\` was not found in ${from}, or maps nothing. ` +
                    `The registry is what says which subtypes exist, so an ` +
                    `empty read would publish a schema that silently covers ` +
                    `nothing.`,
            );
        }
        documents[documentType] = {};
        for (const [subtype, className] of [...map].sort()) {
            documents[documentType][subtype] = fieldsForClass({
                file,
                className,
                aliases,
                cache,
                rootDir,
            });
        }
    }

    return {
        version: SCHEMA_ARTIFACT_VERSION,
        system: packageId,
        systemVersion: version,
        documents,
    };
}

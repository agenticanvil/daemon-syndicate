import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSync, Visitor } from "oxc-parser";

const SOURCE_ROOT = process.argv[2] ?? "src";
const SNAPSHOT_METHOD_NAMES = new Set(["snapshot", "projectileSnapshot"]);

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

const violations = [];

for (const filename of await collectTypeScriptFiles(SOURCE_ROOT)) {
  const source = await readFile(filename, "utf8");
  const result = parseSync(filename, source, { range: true });

  for (const error of result.errors) {
    violations.push(`${filename}: ${error.message}`);
  }

  new Visitor({
    MethodDefinition(node) {
      const methodName = node.key.type === "Identifier" ? node.key.name : undefined;
      if (!SNAPSHOT_METHOD_NAMES.has(methodName)) return;

      const line = lineNumberAt(source, node.key.start);
      const returnType = node.value.returnType?.typeAnnotation;
      if (!returnType) {
        violations.push(`${filename}:${line}: ${methodName}() must declare an explicit snapshot return type.`);
      } else if (returnType.type === "TSObjectKeyword") {
        violations.push(`${filename}:${line}: ${methodName}() must return a named snapshot type instead of object.`);
      }
    },
  }).visit(result.program);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
}

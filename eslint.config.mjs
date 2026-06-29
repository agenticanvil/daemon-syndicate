import tseslint from "typescript-eslint";

const SNAPSHOT_METHOD_SELECTOR =
  "MethodDefinition[key.name=/^(snapshot|projectileSnapshot)$/] > FunctionExpression";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `${SNAPSHOT_METHOD_SELECTOR}:not([returnType])`,
          message: "Snapshot methods must declare an explicit snapshot return type.",
        },
        {
          selector: `${SNAPSHOT_METHOD_SELECTOR} > TSTypeAnnotation > TSObjectKeyword`,
          message: "Snapshot methods must return a named snapshot type instead of generic object.",
        },
      ],
    },
  },
];

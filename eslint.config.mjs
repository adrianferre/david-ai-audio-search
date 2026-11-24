import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Icon-only buttons must say what they do: use <IconButton label="…">,
      // which adds the tooltip and the accessible name.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='size'][value.value=/^icon/]",
          message:
            'Icon-only buttons need a tooltip. Use <IconButton label="…"> from "@/components/ui/icon-button" instead of <Button size="icon…">.',
        },
        {
          selector:
            "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal[value=/^icon/]",
          message:
            'Icon-only buttons need a tooltip. Use <IconButton label="…"> from "@/components/ui/icon-button" instead of <Button size="icon…">.',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

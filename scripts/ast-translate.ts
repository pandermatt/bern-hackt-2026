import { Project, SyntaxKind, JsxText, FunctionDeclaration, ArrowFunction, Node } from "ts-morph";
import * as fs from "fs";

const project = new Project();
project.addSourceFilesAtPaths(["app/**/*.tsx", "components/**/*.tsx"]);

const EXCLUDE_FILES = [
  "app/[locale]/layout.tsx", 
  "components/landing.tsx", 
  "components/app-header.tsx",
  "components/theme-provider.tsx",
  "components/ui/**/*.tsx"
];

const dictionary: Record<string, string> = {};
let keyCounter = 1;

function generateKey(text: string) {
  const clean = text.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  return `key_${clean}_${keyCounter++}`;
}

console.log("Starting AST extraction...");

project.getSourceFiles().forEach((sourceFile) => {
  const filePath = sourceFile.getFilePath();
  if (EXCLUDE_FILES.some(ex => filePath.includes(ex.replace("**/*.tsx", "")))) return;

  let modified = false;

  // Find all JsxText nodes
  const jsxTexts = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);

  // We need to inject useTranslations into the main component
  const components = [...sourceFile.getFunctions(), ...sourceFile.getVariableDeclarations().map(v => v.getInitializerIfKind(SyntaxKind.ArrowFunction)).filter(Boolean)];
  
  if (components.length === 0) return;
  const mainComponent = components[0];

  jsxTexts.forEach((node) => {
    const text = node.getText();
    const trimmed = text.trim();
    
    // Skip empty text or simple symbols
    if (trimmed.length < 2 || /^[^a-zA-Z]+$/.test(trimmed)) return;

    const key = generateKey(trimmed);
    dictionary[key] = trimmed;

    // Replace the text with {t('key')}
    // We have to preserve leading/trailing whitespace
    const leading = text.match(/^\s*/)?.[0] || "";
    const trailing = text.match(/\s*$/)?.[0] || "";
    
    node.replaceWithText(`${leading}{t('${key}')}${trailing}`);
    modified = true;
  });

  if (modified) {
    // Add import
    const hasImport = sourceFile.getImportDeclaration("next-intl");
    if (!hasImport) {
      sourceFile.addImportDeclaration({
        namedImports: ["useTranslations"],
        moduleSpecifier: "next-intl",
      });
    }

    // Add hook
    if (mainComponent) {
      const body = mainComponent.getBody();
      if (body && Node.isBlock(body)) {
        body.insertStatements(0, "const t = useTranslations('Global');");
      }
    }
  }
});

project.saveSync();
fs.writeFileSync("extracted_en.json", JSON.stringify(dictionary, null, 2));
console.log("AST processing complete. Strings extracted to extracted_en.json");

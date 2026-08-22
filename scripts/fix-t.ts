import { Project, SyntaxKind, Node } from "ts-morph";

const project = new Project();
project.addSourceFilesAtPaths(["app/**/*.tsx", "components/**/*.tsx"]);

project.getSourceFiles().forEach((sourceFile) => {
  let fileModified = false;

  const functions = [...sourceFile.getFunctions(), ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)];

  functions.forEach(func => {
    const calls = func.getDescendantsOfKind(SyntaxKind.CallExpression);
    const usesT = calls.some(call => call.getExpression().getText() === "t");

    if (usesT) {
      const body = func.getBody();
      if (body && Node.isBlock(body)) {
        const text = body.getText();
        if (!text.includes("const t = useTranslations")) {
          body.insertStatements(0, "const t = useTranslations('Global');");
          fileModified = true;
        }
      }
    }
  });

  if (fileModified) {
    const hasImport = sourceFile.getImportDeclaration("next-intl");
    if (!hasImport) {
      sourceFile.addImportDeclaration({
        namedImports: ["useTranslations"],
        moduleSpecifier: "next-intl",
      });
    }
  }
});

project.saveSync();
console.log("Fix complete.");

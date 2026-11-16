// Jest runs the API as CommonJS, and a few of its dependencies are published as ES modules only
// (@nestjs/jwt). This turns the files of those packages into CommonJS as Jest loads them, so that
// the tests run the real package. Which packages: `transformIgnorePatterns` in package.json.
const ts = require('typescript');

module.exports = {
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true, allowJs: true },
    });
    return { code: outputText };
  },
};

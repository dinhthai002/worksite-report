/**
 * Architecture rules from docs/engineering/coding-standard.md (ARC-01 to ARC-04, DB-01).
 * Run with `npm run arch` (`depcruise src`). Every rule is an error.
 */
module.exports = {
  forbidden: [
    {
      name: "arc-01-domain-isolation",
      comment:
        "ARC-01: domain imports only its own module's domain and shared/domain. No npm packages, no Node core modules.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/domain/" },
      to: { pathNot: ["^src/modules/$1/domain/", "^src/shared/domain/"] },
    },
    {
      name: "arc-01-shared-domain-isolation",
      comment: "ARC-01: shared/domain imports only shared/domain.",
      severity: "error",
      from: { path: "^src/shared/domain/" },
      to: { pathNot: "^src/shared/domain/" },
    },
    {
      name: "arc-02-application-layering",
      comment: "ARC-02: application does not import infrastructure or interface.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/application/" },
      to: { path: "^src/modules/[^/]+/(infrastructure|interface)/" },
    },
    {
      name: "arc-03-module-public-api",
      comment: "ARC-03: another module is imported only through its index.ts.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "arc-03-module-public-api-from-outside",
      comment: "ARC-03: code outside modules/ (main.ts, app.ts) imports a module only through its index.ts.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/modules/" },
      to: { path: "^src/modules/", pathNot: "^src/modules/[^/]+/index\\.ts$" },
    },
    {
      name: "arc-04-worksite-not-reporting",
      comment: "ARC-04: worksite does not import reporting.",
      severity: "error",
      from: { path: "^src/modules/worksite/" },
      to: { path: "^src/modules/reporting/" },
    },
    {
      name: "arc-04-shared-not-modules",
      comment: "ARC-04: shared does not import modules.",
      severity: "error",
      from: { path: "^src/shared/" },
      to: { path: "^src/modules/" },
    },
    {
      name: "db-01-prisma-in-infrastructure",
      comment: "DB-01, ARC-08: @prisma/client is imported only in infrastructure and shared/infrastructure.",
      severity: "error",
      from: { pathNot: ["^src/modules/[^/]+/infrastructure/", "^src/shared/infrastructure/"] },
      to: { path: ["node_modules/@prisma/", "node_modules/\\.prisma/"] },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make layering meaningless.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment: "An import that cannot be resolved cannot be checked against the rules above.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["main", "types", "typings"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

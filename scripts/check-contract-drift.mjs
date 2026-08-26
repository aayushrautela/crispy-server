import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const root = process.cwd();

// Map of OpenAPI specs to their route files
const specToRoutes = {
  'openapi/public-app.v1.yaml': [
    'src/http/routes/me.ts',
    'src/http/routes/account.ts',
    'src/http/routes/profiles.ts',
    'src/http/routes/watch.ts',
    'src/http/routes/metadata.ts',
    'src/http/routes/calendar.ts',
    'src/http/routes/ai.ts',
    'src/http/routes/personal-access-tokens.ts',
    'src/http/routes/profile-settings.ts',
  ],
  'openapi/public-account.v1.yaml': [
    'src/http/routes/account-public.routes.ts',
  ],
  'openapi/internal-services.v1.yaml': [
    'src/http/routes/internal-apps.routes.ts',
  ],
  'openapi/admin-ops.v1.yaml': [
    'src/http/routes/admin-api.ts',
  ],
  'openapi/health-infrastructure.yaml': [
    'src/http/routes/health.ts',
  ],
};

// Routes to exclude from drift checking (UI/static/non-contract routes)
const excludedRoutes = [
  '/admin/login',
  '/admin/logout',
  '/admin',
  '/imports/:provider/callback',
];

function readYaml(relativePath) {
  return YAML.parse(readFileSync(resolve(root, relativePath), 'utf8'));
}

function readFile(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

// Normalize path parameters from :param to {param}
function normalizeRoutePath(path) {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

// Extract routes from TypeScript route files
function extractRoutesFromFile(filePath) {
  const content = readFile(filePath);
  const routes = [];
  
  // Match patterns like: app.get('/path', ...) or app.post('/path/:param', ...)
  // Handle both single and double quotes, and template literals
  const routePattern = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  
  let match;
  while ((match = routePattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[2];
    const path = normalizeRoutePath(rawPath);
    
    // Skip excluded routes
    if (!excludedRoutes.includes(path)) {
      routes.push({ method, path, file: filePath });
    }
  }
  
  return routes;
}

// Extract paths and methods from OpenAPI spec
function extractPathsFromSpec(specPath) {
  const spec = readYaml(specPath);
  const paths = [];
  
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (pathItem[method]) {
        paths.push({ 
          method: method.toUpperCase(), 
          path,
          operationId: pathItem[method].operationId 
        });
      }
    }
  }
  
  return paths;
}

function checkDrift() {
  let hasErrors = false;
  const allImplementedRoutes = new Map();
  const allDocumentedPaths = new Map();
  
  console.log('Checking for route-vs-OpenAPI drift...\n');
  
  // Collect all implemented routes
  for (const [specPath, routeFiles] of Object.entries(specToRoutes)) {
    for (const routeFile of routeFiles) {
      const routes = extractRoutesFromFile(routeFile);
      for (const route of routes) {
        const key = `${route.method} ${route.path}`;
        allImplementedRoutes.set(key, { ...route, spec: specPath });
      }
    }
  }
  
  // Collect all documented paths
  for (const specPath of Object.keys(specToRoutes)) {
    const paths = extractPathsFromSpec(specPath);
    for (const path of paths) {
      const key = `${path.method} ${path.path}`;
      allDocumentedPaths.set(key, { ...path, spec: specPath });
    }
  }
  
  // Check for undocumented routes (implemented but not in OpenAPI)
  const undocumented = [];
  for (const [key, route] of allImplementedRoutes) {
    if (!allDocumentedPaths.has(key)) {
      undocumented.push({ key, route });
    }
  }
  
  // Check for unimplemented paths (in OpenAPI but not implemented)
  const unimplemented = [];
  for (const [key, path] of allDocumentedPaths) {
    if (!allImplementedRoutes.has(key)) {
      unimplemented.push({ key, path });
    }
  }
  
  // Report findings
  if (undocumented.length > 0) {
    hasErrors = true;
    console.log('❌ UNDOCUMENTED ROUTES (implemented but not in OpenAPI):');
    for (const { key, route } of undocumented) {
      console.log(`   ${key}`);
      console.log(`      File: ${route.file}`);
      console.log(`      Expected spec: ${route.spec}`);
    }
    console.log('');
  }
  
  if (unimplemented.length > 0) {
    hasErrors = true;
    console.log('❌ UNIMPLEMENTED PATHS (documented in OpenAPI but not implemented):');
    for (const { key, path } of unimplemented) {
      console.log(`   ${key}`);
      console.log(`      Spec: ${path.spec}`);
      console.log(`      OperationId: ${path.operationId}`);
    }
    console.log('');
  }
  
  if (!hasErrors) {
    console.log('✅ No drift detected. All routes are documented and all documented paths are implemented.');
    console.log(`   Verified ${allImplementedRoutes.size} routes across ${Object.keys(specToRoutes).length} specs.`);
  }
  
  return hasErrors ? 1 : 0;
}

const exitCode = checkDrift();
process.exit(exitCode);

$ErrorActionPreference = "Stop"
Write-Host "Building all packages..."
npm run build
Write-Host "Using token from .npmrc to publish..."

Push-Location -Path "./"
try {
  npm publish --access public
} catch {
  Write-Host "Failed to publish vite-plugin-xj-fv!"
}
Pop-Location
Write-Host "All packages have been published successfully!"

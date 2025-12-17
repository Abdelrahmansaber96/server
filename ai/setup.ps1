# AI Module Setup Script for Windows
# Run this in PowerShell after adding OPENAI_API_KEY to .env

Write-Host "🤖 AI Module Setup" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Install dependencies
Write-Host "📦 Step 1: Installing OpenAI package..." -ForegroundColor Yellow
npm install openai

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ OpenAI package installed" -ForegroundColor Green
} else {
    Write-Host "❌ Installation failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "⚙️  Step 2: Checking environment variables..." -ForegroundColor Yellow

# Check if .env exists
if (-not (Test-Path .env)) {
    Write-Host "❌ .env file not found!" -ForegroundColor Red
    Write-Host "Please create .env file with OPENAI_API_KEY" -ForegroundColor Yellow
    exit 1
}

# Check if OPENAI_API_KEY exists in .env
$envContent = Get-Content .env -Raw
if ($envContent -match "OPENAI_API_KEY") {
    Write-Host "✅ OPENAI_API_KEY found in .env" -ForegroundColor Green
} else {
    Write-Host "⚠️  OPENAI_API_KEY not found in .env" -ForegroundColor Yellow
    Write-Host "Please add: OPENAI_API_KEY=sk-your-key-here" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Create MongoDB Atlas Vector Index (see INTEGRATION_GUIDE.md)"
Write-Host "2. Start your server: npm run dev"
Write-Host "3. Generate embeddings: node ai/test-ai.js"
Write-Host "4. Test API: POST /api/ai/query"
Write-Host ""
Write-Host "📖 Documentation:" -ForegroundColor Cyan
Write-Host "   - Full Guide: ai/README.md"
Write-Host "   - Quick Start: ai/QUICK_START.md"
Write-Host "   - Integration: ai/INTEGRATION_GUIDE.md"
Write-Host ""
Write-Host "🎉 Happy coding!" -ForegroundColor Green

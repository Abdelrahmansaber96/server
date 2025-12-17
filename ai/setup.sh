#!/bin/bash
# AI Module Setup Script
# Run this after adding OPENAI_API_KEY to .env

echo "🤖 AI Module Setup"
echo "=================="
echo ""

# Step 1: Install dependencies
echo "📦 Step 1: Installing OpenAI package..."
npm install openai

if [ $? -eq 0 ]; then
    echo "✅ OpenAI package installed"
else
    echo "❌ Installation failed"
    exit 1
fi

echo ""
echo "⚙️  Step 2: Checking environment variables..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "Please create .env file with OPENAI_API_KEY"
    exit 1
fi

# Check if OPENAI_API_KEY exists in .env
if grep -q "OPENAI_API_KEY" .env; then
    echo "✅ OPENAI_API_KEY found in .env"
else
    echo "⚠️  OPENAI_API_KEY not found in .env"
    echo "Please add: OPENAI_API_KEY=sk-your-key-here"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Create MongoDB Atlas Vector Index (see INTEGRATION_GUIDE.md)"
echo "2. Start your server: npm run dev"
echo "3. Generate embeddings: node ai/test-ai.js"
echo "4. Test API: POST /api/ai/query"
echo ""
echo "📖 Documentation:"
echo "   - Full Guide: ai/README.md"
echo "   - Quick Start: ai/QUICK_START.md"
echo "   - Integration: ai/INTEGRATION_GUIDE.md"
echo ""
echo "🎉 Happy coding!"

# 🚀 START HERE - AI Module Setup

## ✅ Module Successfully Installed!

Your complete AI module is ready. Follow these 4 simple steps:

---

## 📝 Step 1: Install OpenAI Package (30 seconds)

```bash
cd server
npm install openai
```

---

## 🔑 Step 2: Add API Key to .env (1 minute)

Open `server/.env` and add:

```env
OPENAI_API_KEY=sk-your-openai-api-key-here
```

**Where to get API key:**
- Go to: https://platform.openai.com/api-keys
- Click "Create new secret key"
- Copy and paste into `.env`

---

## 🗄️ Step 3: Create MongoDB Vector Index (5 minutes)

### Option A: Quick Setup (Copy-Paste)

1. Go to **MongoDB Atlas** → Your Cluster → **"Search"** tab
2. Click **"Create Search Index"** → **"JSON Editor"**
3. Paste this:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 3072,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "price"
    },
    {
      "type": "filter",
      "path": "type"
    },
    {
      "type": "filter",
      "path": "bedrooms"
    },
    {
      "type": "filter",
      "path": "location.city"
    }
  ]
}
```

4. Configure:
   - **Index Name:** `property_vector_index`
   - **Database:** (your database name)
   - **Collection:** `properties`

5. Click **"Create Search Index"**
6. ⏳ Wait 2-5 minutes (status will show "Active")

### Option B: Detailed Instructions

See: `INTEGRATION_GUIDE.md` (Section: MongoDB Atlas Vector Search Index Setup)

---

## 🧪 Step 4: Test Everything (2 minutes)

### Option A: Run Automated Tests

```bash
cd server
node ai/test-ai.js
```

This will test:
- ✅ Embedding generation
- ✅ Vector search
- ✅ AI response generation
- ✅ Batch processing

### Option B: Manual API Test

1. **Start your server:**
   ```bash
   npm run dev
   ```

2. **Generate embeddings for existing properties:**
   ```bash
   curl -X POST http://localhost:5000/api/ai/generate-all-embeddings \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

3. **Test AI query:**
   ```bash
   curl -X POST http://localhost:5000/api/ai/query \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query": "أريد شقة في دبي"}'
   ```

---

## 🎉 You're Done!

Your AI module is now active at:
- **Main Endpoint:** `POST /api/ai/query`
- **Docs:** See `README.md` for full API documentation

---

## 📚 What to Read Next

| If you want to... | Read this file |
|-------------------|----------------|
| Understand how everything works | `README.md` |
| Get detailed setup instructions | `INTEGRATION_GUIDE.md` |
| Quick API reference | `QUICK_START.md` |
| Integrate in frontend | `frontend-integration.js` |
| See complete overview | `OVERVIEW.md` |

---

## 💡 Quick Example

```javascript
// Frontend code
import axios from 'axios';

async function askAI(query) {
  const response = await axios.post(
    'http://localhost:5000/api/ai/query',
    { query },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  console.log(response.data.answer);      // AI response
  console.log(response.data.results);     // Properties
}

// Usage
askAI('أريد شقة في دبي مارينا');
```

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| ❌ "Vector index not found" | Wait 5 min after creating index |
| ❌ "OpenAI API error" | Check `.env` has valid API key |
| ❌ "No results" | Run `generate-all-embeddings` first |
| ❌ Slow responses | Use `gpt-3.5-turbo` (edit `llm-agent.service.js`) |

---

## ⚡ Quick Commands

```bash
# Install package
npm install openai

# Run tests
node ai/test-ai.js

# Start server
npm run dev

# Generate embeddings
curl -X POST http://localhost:5000/api/ai/generate-all-embeddings \
  -H "Authorization: Bearer TOKEN"

# Test query
curl -X POST http://localhost:5000/api/ai/query \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "شقة في دبي"}'
```

---

## 📊 Module Contents

```
ai/
├── services/               # Core AI logic
├── controllers/            # API handlers
├── routes/                 # Express routes
├── README.md              # Full documentation
├── INTEGRATION_GUIDE.md   # Setup guide
├── QUICK_START.md         # Quick reference
├── frontend-integration.js # Code examples
└── test-ai.js             # Test suite
```

---

## 🎯 What You Get

✅ **RAG System** - Retrieval-Augmented Generation  
✅ **Vector Search** - MongoDB Atlas with filters  
✅ **GPT-4 Integration** - Natural Arabic responses  
✅ **No Hallucinations** - Uses only real property data  
✅ **Production Ready** - Error handling & logging  
✅ **Well Documented** - 5 comprehensive guides  
✅ **Tested** - Automated test suite included  
✅ **Frontend Ready** - React/Vue examples provided  

---

## 🚀 Ready to Start?

1. ✅ Run: `npm install openai`
2. ✅ Add `OPENAI_API_KEY` to `.env`
3. ⏳ Create MongoDB Vector Index (5 min)
4. ✅ Run: `node ai/test-ai.js`

**That's it! Your AI is ready to use.**

---

**Need help?** Open any of the documentation files or run `node ai/test-ai.js`

**Happy coding! 🎉**

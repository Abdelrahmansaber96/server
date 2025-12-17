# 🤖 AI Module - RAG + LLM for Real Estate

Complete production-ready AI module with Retrieval-Augmented Generation (RAG) using OpenAI.

---

## 📁 Folder Structure

```
/ai
├── /services
│   ├── embeddings.service.js       # Generate & manage embeddings
│   ├── vector-search.service.js    # MongoDB vector search
│   └── llm-agent.service.js        # OpenAI responses (default gpt-4o-mini)
├── /controllers
│   └── ai.controller.js            # API request handlers
├── /routes
│   └── ai.routes.js                # Express routes
├── system-prompt.js                # Arabic system prompt for AI
├── index.js                        # Module exports
└── README.md                       # This file
```

---

## 🚀 Installation & Setup

### 1️⃣ Install Required Packages

```bash
npm install openai
```

### 2️⃣ Add Environment Variables

Add to your `.env` file:

```env
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_COMPLETION_MODEL=gpt-4o-mini # optional override (defaults to this value)
```

> Note: The AI module now uses `gpt-4o-mini` by default because it balances quality and latency for Arabic real-estate queries. Set `OPENAI_COMPLETION_MODEL` if you prefer a different OpenAI chat model (for example `gpt-4o` or `gpt-4.1`).

### 3️⃣ Update Property Model

Add `embedding` field to your `propertyModel.js`:

```javascript
const propertySchema = new mongoose.Schema({
  // ... existing fields ...
  
  embedding: {
    type: [Number],
    select: false, // Don't include in regular queries
  },
});
```

### 4️⃣ Integrate Routes into Main Server

In your `server/index.js`, add:

```javascript
const aiRoutes = require("./ai/routes/ai.routes");

// ... other routes ...

app.use("/api/ai", aiRoutes);
```

---

## 🔧 MongoDB Atlas Vector Search Setup

### Step 1: Create Vector Search Index

1. Go to **MongoDB Atlas** → Your Cluster → **Search**
2. Click **"Create Search Index"**
3. Choose **"JSON Editor"**
4. Paste this configuration:

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

5. **Index Name:** `property_vector_index`
6. **Database:** Your database name
7. **Collection:** `properties`
8. Click **"Create Search Index"**
9. ⏳ Wait 2-5 minutes for index to build

---

## 📡 API Endpoints

### 1. AI Query (Main Endpoint)

**POST** `/api/ai/query`

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Body:**
```json
{
  "query": "ابحث عن شقة في دبي مارينا بسعر أقل من 2 مليون درهم",
  "filters": {
    "maxPrice": 2000000,
    "type": "apartment",
    "city": "Dubai"
  }
}
```

**Response:**
```json
{
  "success": true,
  "answer": "بناءً على بحثك عن شقة في دبي مارينا...",
  "results": [
    {
      "_id": "...",
      "title": "شقة فاخرة في دبي مارينا",
      "price": 1850000,
      "location": { "city": "Dubai", "area": "Dubai Marina" },
      "bedrooms": 2,
      "score": 0.92
    }
  ],
  "followUpQuestion": "هل تفضل شقة بإطلالة على البحر؟",
  "meta": {
    "resultsCount": 3,
    "timestamp": "2025-11-17T..."
  }
}
```

---

### 2. Generate Embedding for Single Property

**POST** `/api/ai/generate-embedding/:propertyId`

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Embedding generated successfully",
  "property": {
    "id": "...",
    "title": "Luxury Apartment",
    "hasEmbedding": true
  }
}
```

---

### 3. Generate Embeddings for All Properties

**POST** `/api/ai/generate-all-embeddings`

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully generated embeddings for 47 properties",
  "count": 47
}
```

---

### 4. Test Vector Search

**POST** `/api/ai/test-search`

**Body:**
```json
{
  "query": "luxury villa with pool"
}
```

**Response:**
```json
{
  "success": true,
  "results": [...],
  "count": 5
}
```

---

## 🔄 Usage Workflow

### Initial Setup (One Time)

```bash
# 1. Generate embeddings for all existing properties
POST /api/ai/generate-all-embeddings
```

### For New Properties

Whenever a new property is created, generate its embedding:

```javascript
const { generatePropertyEmbedding } = require("./ai/services/embeddings.service");

// After creating a property
await generatePropertyEmbedding(newProperty._id);
```

Or add a hook in your property model:

```javascript
propertySchema.post("save", async function (doc) {
  if (!doc.embedding) {
    const { generatePropertyEmbedding } = require("../ai/services/embeddings.service");
    await generatePropertyEmbedding(doc._id);
  }
});
```

---

## 🧪 Testing

### Test 1: Generate Embeddings

```bash
curl -X POST http://localhost:5000/api/ai/generate-all-embeddings \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test 2: AI Query

```bash
curl -X POST http://localhost:5000/api/ai/query \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "أريد شقة في دبي بسعر معقول"
  }'
```

---

## 🎯 Features

✅ **OpenAI Embeddings** - Uses `text-embedding-3-large` (3072 dimensions)  
✅ **Vector Search** - MongoDB Atlas vector search with filters  
✅ **OpenAI Chat Integration** - Natural Arabic responses (default gpt-4o-mini)  
✅ **RAG Architecture** - Retrieves relevant data before generating answers  
✅ **No Hallucination** - Uses only retrieved property data  
✅ **Production Ready** - Error handling, logging, validation  
✅ **Scalable** - Supports batch embedding generation  

---

## 📊 Performance Optimization

### 1. Batch Embedding Generation

For large datasets, process in batches:

```javascript
const properties = await Property.find({ embedding: null }).limit(100);
for (const prop of properties) {
  await generatePropertyEmbedding(prop._id);
  await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
}
```

### 2. Cache Embeddings

Embeddings are stored in MongoDB and only regenerated when property data changes.

### 3. Adjust Vector Search Parameters

```javascript
// In vector-search.service.js
numCandidates: 100, // Increase for better accuracy (slower)
limit: 5,           // Number of results to return
```

---

## 🔐 Security

- All AI endpoints require authentication (`authMiddleware`)
- Admin-only routes for embedding generation
- Input validation on all requests
- Error messages sanitized in production

---

## 🐛 Troubleshooting

### Error: "Vector search index not found"

**Solution:** Wait 2-5 minutes after creating the index, or check the index name matches `property_vector_index`

### Error: "OpenAI API key invalid"

**Solution:** Check your `.env` file and ensure `OPENAI_API_KEY` is set correctly

### No results from vector search

**Solution:** Ensure embeddings are generated for your properties:
```bash
POST /api/ai/generate-all-embeddings
```

### Slow response times

**Solution:** 
- Reduce `numCandidates` in vector search
- Set `OPENAI_COMPLETION_MODEL=gpt-3.5-turbo` if you need faster/cheaper runs
- Implement caching for common queries

---

## 📝 Example Integration in Frontend

```javascript
// React component example
const searchProperties = async (query) => {
  const response = await axios.post('/api/ai/query', {
    query: query,
    filters: {
      maxPrice: 2000000,
      type: 'apartment'
    }
  }, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  console.log(response.data.answer);      // AI response
  console.log(response.data.results);     // Matching properties
  console.log(response.data.followUpQuestion); // Next question
};
```

---

## 🚦 Rate Limits

OpenAI API has rate limits. For production:

- Implement request queuing
- Add rate limiting middleware
- Cache common queries
- Use Redis for session management

---

## 💰 Cost Estimation

### Embeddings Cost (text-embedding-3-large)
- ~$0.13 per 1M tokens
- Average property: ~200 tokens
- 1000 properties: ~$0.026

### OpenAI Chat Cost (default gpt-4o-mini)
- Check [OpenAI pricing](https://openai.com/pricing) for the latest per-token rates
- Average query cost depends on tokens returned (typically a few cents)

**Tip:** Switch `OPENAI_COMPLETION_MODEL` to `gpt-3.5-turbo` or `gpt-4o-mini-high` to balance cost vs. quality.

---

## 📞 Support

For issues or questions, check:
1. MongoDB Atlas index status
2. OpenAI API key validity
3. Server logs for detailed errors
4. This README for setup steps

---

**🎉 Your AI module is now ready to use!**

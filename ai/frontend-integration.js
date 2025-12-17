/**
 * Frontend Integration Examples for AI Module
 * Copy these functions to your React/Vue components
 */

// =====================================================
// 1️⃣ AXIOS SETUP (React/Vue)
// =====================================================

import axios from 'axios';

const aiAPI = axios.create({
  baseURL: 'http://localhost:5000/api/ai',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to all requests
aiAPI.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// =====================================================
// 2️⃣ BASIC AI QUERY
// =====================================================

/**
 * Send a query to AI and get response with properties
 * @param {string} userQuery - User's question in Arabic
 * @returns {Promise<Object>} AI response with properties
 */
export async function askAI(userQuery) {
  try {
    const response = await aiAPI.post('/query', {
      query: userQuery,
    });

    return {
      success: true,
      answer: response.data.answer,
      properties: response.data.results,
      followUp: response.data.followUpQuestion,
    };
  } catch (error) {
    console.error('AI Query Error:', error);
    return {
      success: false,
      error: error.response?.data?.message || 'حدث خطأ في الاتصال',
    };
  }
}

// =====================================================
// 3️⃣ AI QUERY WITH FILTERS
// =====================================================

/**
 * Send a query with additional filters
 * @param {string} userQuery - User's question
 * @param {Object} filters - Price, type, bedrooms, etc.
 * @returns {Promise<Object>} Filtered AI response
 */
export async function askAIWithFilters(userQuery, filters = {}) {
  try {
    const response = await aiAPI.post('/query', {
      query: userQuery,
      filters: {
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        type: filters.type, // 'villa', 'apartment', etc.
        bedrooms: filters.bedrooms,
        city: filters.city,
      },
    });

    return {
      success: true,
      answer: response.data.answer,
      properties: response.data.results,
      followUp: response.data.followUpQuestion,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || 'حدث خطأ',
    };
  }
}

// =====================================================
// 4️⃣ REACT COMPONENT EXAMPLE
// =====================================================

import React, { useState } from 'react';

export function AISearchComponent() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    
    if (!query.trim()) return;

    setLoading(true);
    const result = await askAI(query);
    setResponse(result);
    setLoading(false);
  };

  return (
    <div className="ai-search">
      <form onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="اسأل الذكاء الاصطناعي عن العقار المناسب..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'جاري البحث...' : 'بحث'}
        </button>
      </form>

      {response?.success && (
        <div className="ai-response">
          <div className="ai-answer">
            <h3>إجابة الذكاء الاصطناعي:</h3>
            <p>{response.answer}</p>
          </div>

          <div className="properties-grid">
            {response.properties.map((property) => (
              <div key={property._id} className="property-card">
                <h4>{property.title}</h4>
                <p>{property.description}</p>
                <p>السعر: {property.price.toLocaleString()} درهم</p>
                <p>الموقع: {property.location.city}</p>
              </div>
            ))}
          </div>

          {response.followUp && (
            <div className="follow-up">
              <button onClick={() => setQuery(response.followUp)}>
                {response.followUp}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// 5️⃣ VUE COMPONENT EXAMPLE
// =====================================================

/*
<template>
  <div class="ai-search">
    <form @submit.prevent="handleSearch">
      <input
        v-model="query"
        placeholder="اسأل الذكاء الاصطناعي..."
        type="text"
      />
      <button :disabled="loading">
        {{ loading ? 'جاري البحث...' : 'بحث' }}
      </button>
    </form>

    <div v-if="response" class="ai-response">
      <div class="ai-answer">
        <h3>إجابة الذكاء الاصطناعي:</h3>
        <p>{{ response.answer }}</p>
      </div>

      <div class="properties-grid">
        <div
          v-for="property in response.properties"
          :key="property._id"
          class="property-card"
        >
          <h4>{{ property.title }}</h4>
          <p>{{ property.description }}</p>
          <p>السعر: {{ property.price.toLocaleString() }} درهم</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import { askAI } from './ai-integration';

export default {
  setup() {
    const query = ref('');
    const response = ref(null);
    const loading = ref(false);

    const handleSearch = async () => {
      if (!query.value.trim()) return;
      
      loading.value = true;
      response.value = await askAI(query.value);
      loading.value = false;
    };

    return {
      query,
      response,
      loading,
      handleSearch,
    };
  },
};
</script>
*/

// =====================================================
// 6️⃣ ADVANCED: STREAMING CHAT INTERFACE
// =====================================================

export function AIChat() {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput] = React.useState('');

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Add user message
    const userMessage = { role: 'user', content: input };
    setMessages([...messages, userMessage]);

    // Get AI response
    const result = await askAI(input);
    
    if (result.success) {
      const aiMessage = { 
        role: 'assistant', 
        content: result.answer,
        properties: result.properties,
      };
      setMessages([...messages, userMessage, aiMessage]);
    }

    setInput('');
  };

  return (
    <div className="chat-interface">
      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <p>{msg.content}</p>
            {msg.properties && (
              <div className="property-suggestions">
                {msg.properties.map(p => (
                  <PropertyCard key={p._id} property={p} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="اسأل عن العقارات..."
        />
        <button onClick={sendMessage}>إرسال</button>
      </div>
    </div>
  );
}

// =====================================================
// 7️⃣ GENERATE EMBEDDING FOR NEW PROPERTY
// =====================================================

/**
 * Generate embedding when creating new property
 * @param {string} propertyId - MongoDB property ID
 */
export async function generateEmbedding(propertyId) {
  try {
    const response = await aiAPI.post(`/generate-embedding/${propertyId}`);
    return response.data;
  } catch (error) {
    console.error('Embedding generation failed:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 8️⃣ USAGE EXAMPLES
// =====================================================

// Example 1: Simple search
async function example1() {
  const result = await askAI('أريد شقة في دبي مارينا');
  console.log(result.answer);
  console.log(result.properties);
}

// Example 2: Filtered search
async function example2() {
  const result = await askAIWithFilters(
    'شقة فاخرة بإطلالة على البحر',
    {
      maxPrice: 2000000,
      type: 'apartment',
      city: 'Dubai',
      bedrooms: 2,
    }
  );
  console.log(result);
}

// Example 3: Generate embedding after property creation
async function example3() {
  // After creating property...
  const newProperty = await createProperty({ /* data */ });
  await generateEmbedding(newProperty._id);
}

// =====================================================
// 9️⃣ REDUX INTEGRATION (Optional)
// =====================================================

// actions.js
export const aiQueryAction = (query, filters) => async (dispatch) => {
  dispatch({ type: 'AI_QUERY_START' });
  
  try {
    const result = await askAIWithFilters(query, filters);
    dispatch({ type: 'AI_QUERY_SUCCESS', payload: result });
  } catch (error) {
    dispatch({ type: 'AI_QUERY_ERROR', payload: error.message });
  }
};

// reducer.js
const initialState = {
  loading: false,
  answer: null,
  properties: [],
  error: null,
};

export function aiReducer(state = initialState, action) {
  switch (action.type) {
    case 'AI_QUERY_START':
      return { ...state, loading: true, error: null };
    case 'AI_QUERY_SUCCESS':
      return {
        ...state,
        loading: false,
        answer: action.payload.answer,
        properties: action.payload.properties,
      };
    case 'AI_QUERY_ERROR':
      return { ...state, loading: false, error: action.payload };
    default:
      return state;
  }
}

// =====================================================
// 🔟 ERROR HANDLING HELPER
// =====================================================

export function handleAIError(error) {
  if (error.response?.status === 401) {
    return 'يرجى تسجيل الدخول أولاً';
  }
  if (error.response?.status === 500) {
    return 'حدث خطأ في الخادم. يرجى المحاولة لاحقاً';
  }
  if (error.code === 'ECONNABORTED') {
    return 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى';
  }
  return 'حدث خطأ غير متوقع';
}

// =====================================================
// Export all functions
// =====================================================

export default {
  askAI,
  askAIWithFilters,
  generateEmbedding,
  AISearchComponent,
  AIChat,
  handleAIError,
};

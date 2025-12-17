// Quick test script for AI endpoint
require("dotenv").config();
const axios = require("axios");

const API_URL = "http://localhost:5000";

// Get a token first (you need to use a real user credentials)
async function testAI() {
  try {
    console.log("🧪 Testing AI endpoint...\n");

    // Test 1: Without auth (should fail with 401 or work in demo mode)
    console.log("Test 1: Without authentication");
    try {
      const response = await axios.post(`${API_URL}/api/ai/query`, {
        query: "أريد شقة في دبي"
      });
      console.log("✅ Success (Demo mode):");
      console.log("Answer:", response.data.answer.substring(0, 100) + "...");
      console.log("Properties found:", response.data.results.length);
      console.log("Mode:", response.data.meta.mode);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log("⚠️  Requires authentication (expected)");
      } else {
        console.log("❌ Error:", error.response?.data || error.message);
      }
    }

    console.log("\n" + "=".repeat(50) + "\n");

    // Test 2: Login and try with auth
    console.log("Test 2: With authentication");
    try {
      // Login first
      const loginResponse = await axios.post(`${API_URL}/users/login`, {
        email: "ryad@example.com", // Use your test user
        password: "password123"
      });

      const token = loginResponse.data.token;
      console.log("✅ Logged in successfully");

      // Now test AI with token
      const aiResponse = await axios.post(
        `${API_URL}/api/ai/query`,
        { query: "أريد شقة في دبي مارينا بسعر أقل من 2 مليون" },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      console.log("✅ AI Response received:");
      console.log("Answer:", aiResponse.data.answer.substring(0, 200) + "...");
      console.log("Properties found:", aiResponse.data.results.length);
      console.log("Mode:", aiResponse.data.meta.mode);
      
      if (aiResponse.data.results.length > 0) {
        console.log("\nFirst property:");
        const prop = aiResponse.data.results[0];
        console.log("- Title:", prop.title);
        console.log("- Price:", prop.price);
        console.log("- Location:", prop.location?.city);
      }
    } catch (error) {
      console.log("❌ Error:", error.response?.data || error.message);
    }

  } catch (error) {
    console.error("💥 Test failed:", error.message);
  }
}

testAI();

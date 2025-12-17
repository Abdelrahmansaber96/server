/**
 * Test file to check if offer detection is working
 */

// Test cases
const testCases = [
  "أعرض 3,000,000 جنيه كاش على الشقة في التجمع الخامس",
  "أعرض 3 مليون على الشقة الفاخرة",
  "عرضي 2500000 جنيه",
  "أقدم عرض بـ 4 مليون كاش",
  "عايز أعرض 3000000 تقسيط على 5 سنوات مقدم 20%",
];

// Simple detection function (copy from ai.controller.js)
function detectPriceOfferIntent(query = "") {
  const lowerQuery = query.toLowerCase();
  
  // كلمات تدل على تقديم عرض سعر
  const offerKeywords = /أعرض|اعرض|عرض.*على|عرضي|عروض|عرضت|أقدم|اقدم|قدم.*عرض|negotiate|offer/i;
  
  if (!offerKeywords.test(lowerQuery)) {
    return null;
  }
  
  // استخراج السعر المعروض (بالأرقام - مليون، ألف، جنيه)
  const pricePatterns = [
    // 3 مليون، ٣ مليون
    /(\d+(?:\.\d+)?)\s*(?:مليون|million)/i,
    // 3,000,000 جنيه
    /([\d,]+)\s*(?:جنيه|egp|pound)/i,
    // 3000000 (رقم كبير مباشر)
    /(?:^|\s)(\d{6,})(?:\s|$)/,
  ];
  
  let offeredPrice = null;
  
  for (const pattern of pricePatterns) {
    const match = query.match(pattern);
    if (match) {
      let price = match[1].replace(/,/g, '');
      price = parseFloat(price);
      
      // إذا كان بالمليون، اضربه في مليون
      if (pattern.source.includes('مليون|million')) {
        price = price * 1000000;
      }
      
      offeredPrice = price;
      break;
    }
  }
  
  if (!offeredPrice || offeredPrice < 10000) {
    // السعر غير معقول أو غير موجود
    return null;
  }
  
  // استخراج نوع الدفع (كاش أو تقسيط)
  const isCash = /كاش|نقد|cash/i.test(lowerQuery);
  const isInstallment = /تقسيط|قسط|installment/i.test(lowerQuery);
  
  const result = {
    action: 'submitOffer',
    offeredPrice,
    offerType: isCash ? 'cash' : (isInstallment ? 'installments' : 'cash'), // default to cash
  };
  
  // استخراج نسبة المقدم إن وجدت
  const downMatch = query.match(/(?:مقدم|المقدم)\s*(\d+)\s*%?|(\d+)\s*%\s*(?:مقدم|المقدم)/i);
  if (downMatch && isInstallment) {
    result.downPaymentPercent = parseInt(downMatch[1] || downMatch[2]);
  }
  
  // استخراج سنوات التقسيط إن وجدت
  const yearsMatch = query.match(/(\d+)\s*(?:سن[وة]ات?|سنين)/i);
  if (yearsMatch && isInstallment) {
    result.installmentYears = parseInt(yearsMatch[1]);
  }
  
  return result;
}

// Run tests
console.log("\n🧪 Testing Offer Detection...\n");

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: "${testCase}"`);
  const result = detectPriceOfferIntent(testCase);
  
  if (result) {
    console.log("✅ DETECTED:");
    console.log(`   Price: ${result.offeredPrice.toLocaleString()} EGP`);
    console.log(`   Type: ${result.offerType}`);
    if (result.downPaymentPercent) {
      console.log(`   Down Payment: ${result.downPaymentPercent}%`);
    }
    if (result.installmentYears) {
      console.log(`   Years: ${result.installmentYears}`);
    }
  } else {
    console.log("❌ NOT DETECTED");
  }
  console.log();
});

console.log("✅ Testing complete!\n");

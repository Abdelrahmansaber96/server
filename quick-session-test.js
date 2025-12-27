const { getSession, deleteSession, isInPropertyCreationSession, STEPS } = require('./ai/services/property-ai.service');

const testUserId = 'test-123';
deleteSession(testUserId);

console.log('Test 1: Create session');
const session = getSession(testUserId);
console.log('Step:', session.step);

console.log('\nTest 2: Process start');
let r = session.processResponse('test');
console.log('Result:', r);
console.log('Step:', session.step);

console.log('\nTest 3: Add title');
r = session.processResponse('شقة تست');
console.log('Step:', session.step);

console.log('\nTest 4: Add type');
r = session.processResponse('شقة');
console.log('Step:', session.step);

console.log('\nTest 5: Add city');
r = session.processResponse('القاهرة');
console.log('Step:', session.step);

console.log('\nTest 6: Add area');
r = session.processResponse('مصر الجديدة');
console.log('Step:', session.step);

console.log('\nTest 7: Add price');
r = session.processResponse('1000000');
console.log('Step:', session.step);

console.log('\nTest 8: Add property area');
r = session.processResponse('100');
console.log('Step:', session.step);

console.log('\nTest 9: Add bedrooms');
r = session.processResponse('2');
console.log('Step:', session.step);

console.log('\nTest 10: Add bathrooms');
r = session.processResponse('1');
console.log('Step:', session.step);

console.log('\nTest 11: Add listingStatus');
r = session.processResponse('بيع');
console.log('Step:', session.step);

console.log('\nTest 12: Add features');
r = session.processResponse('لا يوجد');
console.log('Step:', session.step);

console.log('\nTest 13: Add description');
r = session.processResponse('وصف تجريبي');
console.log('Step:', session.step);

console.log('\nTest 14: Add nearby');
r = session.processResponse('لا يوجد');
console.log('Step:', session.step);
console.log('isInSession:', isInPropertyCreationSession(testUserId));

console.log('\n=== CONFIRM ===');
r = session.processResponse('تأكيد');
console.log('Result:', JSON.stringify(r));
console.log('Step:', session.step);
console.log('isComplete:', r.isComplete);

console.log('\nFinal data:');
console.log(JSON.stringify(session.data, null, 2));

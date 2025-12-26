/**
 * Property AI Service
 * Handles seller property creation through AI chat conversation
 */

// In-memory session storage (for production, use Redis or database)
const propertySessions = new Map();

// Session expiry time (30 minutes)
const SESSION_EXPIRY_MS = 30 * 60 * 1000;

// Property creation steps - same fields as the seller form
const STEPS = {
    START: 'start',
    TITLE: 'title',
    TYPE: 'type',
    CITY: 'city',
    AREA: 'area',
    PRICE: 'price',
    PROPERTY_AREA: 'propertyArea',
    BEDROOMS: 'bedrooms',
    BATHROOMS: 'bathrooms',
    LISTING_STATUS: 'listingStatus',
    FEATURES: 'features',
    DESCRIPTION: 'description',
    NEARBY: 'nearby',
    CONFIRM: 'confirm',
    COMPLETE: 'complete',
};

// Property types (same as form)
const PROPERTY_TYPES = {
    'شقة': 'apartment',
    'فيلا': 'villa',
    'منزل': 'house',
    'دوبلكس': 'house',
    'استوديو': 'apartment',
    'تاون هاوس': 'townhouse',
    'كوندو': 'condo',
    'مشروع': 'project',
    'apartment': 'apartment',
    'villa': 'villa',
    'house': 'house',
    'townhouse': 'townhouse',
    'condo': 'condo',
    'project': 'project',
};

// Listing status options
const LISTING_STATUS = {
    'بيع': 'sale',
    'إيجار': 'rent',
    'ايجار': 'rent',
    'كلاهما': 'both',
    'بيع وإيجار': 'both',
    'sale': 'sale',
    'rent': 'rent',
    'both': 'both',
};

// Available features (same as form)
const AVAILABLE_FEATURES = [
    'حمام سباحة',
    'حديقة',
    'جراج',
    'نظام أمان',
    'جيم',
    'مصعد',
    'بلكونة',
    'تكييف مركزي',
    'مفروش',
    'صديق للحيوانات',
    'سمارت هوم',
    'غرفة تخزين',
    'مدفأة',
    'دريسنج روم',
    'إطلالة بحر',
    'إطلالة مدينة',
];

/**
 * Property Creation Session
 */
class PropertyCreationSession {
    constructor(userId) {
        this.userId = userId;
        this.step = STEPS.START;
        this.data = {
            title: null,
            type: null,
            location: {
                city: null,
                area: null,
                nearBy: [],
            },
            price: null,
            area: null,
            bedrooms: null,
            bathrooms: null,
            listingStatus: null,
            features: [],
            description: null,
            images: [], // Will be placeholder images
            termsAccepted: true, // Auto-accept for AI creation
            status: 'available',
        };
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
    }

    /**
     * Get the next question to ask based on current step
     */
    getNextQuestion() {
        const questions = {
            [STEPS.START]: '🏠 أهلاً بيك! عايز تضيف عقار جديد؟ تمام، هسألك كام سؤال بسيط.\n\n❓ إيه اسم أو عنوان العقار؟ (مثال: "شقة فاخرة في التجمع الخامس")',

            [STEPS.TITLE]: '📝 تمام! دلوقتي إيه نوع العقار؟\n\n🏢 الأنواع المتاحة:\n• شقة\n• فيلا\n• منزل\n• دوبلكس\n• استوديو\n• تاون هاوس',

            [STEPS.TYPE]: '📍 حلو! العقار ده في أنهي مدينة؟ (مثال: القاهرة، الجيزة، الإسكندرية)',

            [STEPS.CITY]: '🗺️ وفي أنهي منطقة بالتحديد في ${city}؟ (مثال: التجمع الخامس، المعادي، الشيخ زايد)',

            [STEPS.AREA]: '💰 كويس! إيه السعر المطلوب بالجنيه المصري؟',

            [STEPS.PRICE]: '📐 كم مساحة العقار بالمتر المربع؟',

            [STEPS.PROPERTY_AREA]: '🛏️ كم عدد غرف النوم؟',

            [STEPS.BEDROOMS]: '🚿 وكم عدد الحمامات؟',

            [STEPS.BATHROOMS]: '🏷️ العقار ده للبيع ولا للإيجار ولا الاتنين؟\n• بيع\n• إيجار\n• كلاهما',

            [STEPS.LISTING_STATUS]: '✨ إيه المميزات الموجودة في العقار؟ اختار من القائمة (اكتب الأرقام مفصولة بفاصلة):\n\n' +
                AVAILABLE_FEATURES.map((f, i) => `${i + 1}. ${f}`).join('\n') +
                '\n\nأو اكتب "لا يوجد" لو مفيش مميزات خاصة.',

            [STEPS.FEATURES]: '📝 اكتب وصف تفصيلي للعقار (الموقع، المزايا، أي معلومات إضافية):',

            [STEPS.DESCRIPTION]: '🏪 هل يوجد أماكن قريبة مهمة؟ (مثل: مول، مدرسة، مستشفى)\n\nاكتبها مفصولة بفاصلة، أو اكتب "لا يوجد".',

            [STEPS.NEARBY]: this._buildConfirmationMessage(),

            [STEPS.CONFIRM]: '🎉 تم إضافة العقار بنجاح!\n\n✅ العقار ظاهر دلوقتي في صفحة البروفايل بتاعك.\n⚠️ ملحوظة: تم إضافة صور افتراضية - يمكنك تغييرها من صفحة "عقاراتي" في البروفايل.\n\nهل تحتاج مساعدة في حاجة تانية؟',
        };

        let question = questions[this.step] || questions[STEPS.START];

        // Replace placeholders
        if (this.step === STEPS.CITY && this.data.location.city) {
            question = question.replace('${city}', this.data.location.city);
        }

        return question;
    }

    /**
     * Build confirmation message with all collected data
     */
    _buildConfirmationMessage() {
        const typeArabic = Object.entries(PROPERTY_TYPES).find(([_, v]) => v === this.data.type)?.[0] || this.data.type;
        const statusArabic = Object.entries(LISTING_STATUS).find(([_, v]) => v === this.data.listingStatus)?.[0] || this.data.listingStatus;

        return `📋 **ملخص العقار:**\n\n` +
            `🏠 **العنوان:** ${this.data.title}\n` +
            `🏢 **النوع:** ${typeArabic}\n` +
            `📍 **الموقع:** ${this.data.location.city} - ${this.data.location.area}\n` +
            `💰 **السعر:** ${Number(this.data.price).toLocaleString()} جنيه\n` +
            `📐 **المساحة:** ${this.data.area} م²\n` +
            `🛏️ **غرف النوم:** ${this.data.bedrooms}\n` +
            `🚿 **الحمامات:** ${this.data.bathrooms}\n` +
            `🏷️ **حالة العرض:** ${statusArabic}\n` +
            `✨ **المميزات:** ${this.data.features.length > 0 ? this.data.features.join('، ') : 'لا يوجد'}\n` +
            `🏪 **الأماكن القريبة:** ${this.data.location.nearBy.length > 0 ? this.data.location.nearBy.join('، ') : 'لا يوجد'}\n` +
            `📝 **الوصف:** ${this.data.description || 'لا يوجد'}\n\n` +
            `⚠️ **ملحوظة:** سيتم إضافة صور افتراضية - يمكنك تغييرها من صفحة البروفايل.\n\n` +
            `هل البيانات دي صحيحة؟ اكتب "تأكيد" للمتابعة أو "تعديل" لإعادة الإدخال:`;
    }

    /**
     * Process user response and update session data
     * @param {string} response - User's message
     * @returns {Object} - { success, message, nextStep, isComplete }
     */
    processResponse(response) {
        const trimmedResponse = response.trim();
        this.updatedAt = Date.now();

        switch (this.step) {
            case STEPS.START:
                // User initiated property addition
                this.step = STEPS.TITLE;
                return { success: true, nextStep: STEPS.TITLE };

            case STEPS.TITLE:
                if (trimmedResponse.length < 5) {
                    return { success: false, message: '⚠️ الاسم قصير جداً. اكتب اسم واضح للعقار (على الأقل 5 حروف).' };
                }
                this.data.title = trimmedResponse;
                this.step = STEPS.TYPE;
                return { success: true, nextStep: STEPS.TYPE };

            case STEPS.TYPE:
                const normalizedType = PROPERTY_TYPES[trimmedResponse.toLowerCase()] || PROPERTY_TYPES[trimmedResponse];
                if (!normalizedType) {
                    return { success: false, message: '⚠️ من فضلك اختار نوع صحيح: شقة، فيلا، منزل، دوبلكس، استوديو، أو تاون هاوس.' };
                }
                this.data.type = normalizedType;
                this.step = STEPS.CITY;
                return { success: true, nextStep: STEPS.CITY };

            case STEPS.CITY:
                if (trimmedResponse.length < 2) {
                    return { success: false, message: '⚠️ من فضلك اكتب اسم المدينة بشكل صحيح.' };
                }
                this.data.location.city = trimmedResponse;
                this.step = STEPS.AREA;
                return { success: true, nextStep: STEPS.AREA };

            case STEPS.AREA:
                if (trimmedResponse.length < 2) {
                    return { success: false, message: '⚠️ من فضلك اكتب اسم المنطقة بشكل صحيح.' };
                }
                this.data.location.area = trimmedResponse;
                this.step = STEPS.PRICE;
                return { success: true, nextStep: STEPS.PRICE };

            case STEPS.PRICE:
                const price = this._parseNumber(trimmedResponse);
                if (!price || price < 1000) {
                    return { success: false, message: '⚠️ من فضلك اكتب سعر صحيح (رقم أكبر من 1000 جنيه).' };
                }
                this.data.price = price;
                this.step = STEPS.PROPERTY_AREA;
                return { success: true, nextStep: STEPS.PROPERTY_AREA };

            case STEPS.PROPERTY_AREA:
                const area = this._parseNumber(trimmedResponse);
                if (!area || area < 10) {
                    return { success: false, message: '⚠️ من فضلك اكتب مساحة صحيحة بالمتر المربع (رقم أكبر من 10).' };
                }
                this.data.area = area;
                this.step = STEPS.BEDROOMS;
                return { success: true, nextStep: STEPS.BEDROOMS };

            case STEPS.BEDROOMS:
                const bedrooms = this._parseNumber(trimmedResponse);
                if (bedrooms === null || bedrooms < 0 || bedrooms > 20) {
                    return { success: false, message: '⚠️ من فضلك اكتب عدد غرف النوم (رقم من 0 إلى 20).' };
                }
                this.data.bedrooms = bedrooms;
                this.step = STEPS.BATHROOMS;
                return { success: true, nextStep: STEPS.BATHROOMS };

            case STEPS.BATHROOMS:
                const bathrooms = this._parseNumber(trimmedResponse);
                if (bathrooms === null || bathrooms < 0 || bathrooms > 20) {
                    return { success: false, message: '⚠️ من فضلك اكتب عدد الحمامات (رقم من 0 إلى 20).' };
                }
                this.data.bathrooms = bathrooms;
                this.step = STEPS.LISTING_STATUS;
                return { success: true, nextStep: STEPS.LISTING_STATUS };

            case STEPS.LISTING_STATUS:
                const normalizedStatus = LISTING_STATUS[trimmedResponse.toLowerCase()] || LISTING_STATUS[trimmedResponse];
                if (!normalizedStatus) {
                    return { success: false, message: '⚠️ من فضلك اختار: بيع، إيجار، أو كلاهما.' };
                }
                this.data.listingStatus = normalizedStatus;
                this.step = STEPS.FEATURES;
                return { success: true, nextStep: STEPS.FEATURES };

            case STEPS.FEATURES:
                if (trimmedResponse.toLowerCase() === 'لا يوجد' || trimmedResponse.toLowerCase() === 'لا') {
                    this.data.features = [];
                } else {
                    // Parse feature numbers or names
                    const selectedFeatures = this._parseFeatures(trimmedResponse);
                    this.data.features = selectedFeatures;
                }
                this.step = STEPS.DESCRIPTION;
                return { success: true, nextStep: STEPS.DESCRIPTION };

            case STEPS.DESCRIPTION:
                this.data.description = trimmedResponse.length > 2 ? trimmedResponse : '';
                this.step = STEPS.NEARBY;
                return { success: true, nextStep: STEPS.NEARBY };

            case STEPS.NEARBY:
                if (trimmedResponse.toLowerCase() === 'لا يوجد' || trimmedResponse.toLowerCase() === 'لا') {
                    this.data.location.nearBy = [];
                } else {
                    this.data.location.nearBy = trimmedResponse.split(/[،,]/).map(s => s.trim()).filter(s => s.length > 0);
                }
                this.step = STEPS.CONFIRM;
                return { success: true, nextStep: STEPS.CONFIRM };

            case STEPS.CONFIRM:
                if (trimmedResponse.includes('تأكيد') || trimmedResponse.includes('نعم') || trimmedResponse.includes('اه') || trimmedResponse.includes('تمام') || trimmedResponse.includes('موافق')) {
                    this.step = STEPS.COMPLETE;
                    return { success: true, nextStep: STEPS.COMPLETE, isComplete: true };
                } else if (trimmedResponse.includes('تعديل') || trimmedResponse.includes('لا') || trimmedResponse.includes('غلط')) {
                    // Reset to beginning
                    this.step = STEPS.TITLE;
                    return { success: true, nextStep: STEPS.TITLE, message: '🔄 تمام، هنبدأ من الأول. إيه اسم العقار؟' };
                }
                return { success: false, message: '⚠️ من فضلك اكتب "تأكيد" للمتابعة أو "تعديل" لإعادة الإدخال.' };

            default:
                return { success: false, message: '⚠️ حدث خطأ. من فضلك ابدأ من جديد.' };
        }
    }

    /**
     * Parse a number from Arabic or English text
     */
    _parseNumber(text) {
        // Remove Arabic numerals and convert
        const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        let normalized = text;
        arabicNumerals.forEach((char, idx) => {
            normalized = normalized.replace(new RegExp(char, 'g'), idx.toString());
        });

        // Remove non-numeric characters except dots and commas
        normalized = normalized.replace(/[^\d.,]/g, '').replace(/,/g, '');

        const num = parseFloat(normalized);
        return isNaN(num) ? null : num;
    }

    /**
     * Parse features from user input (numbers or names)
     */
    _parseFeatures(input) {
        const features = [];
        const parts = input.split(/[،,\s]+/);

        for (const part of parts) {
            const trimmed = part.trim();

            // Check if it's a number
            const num = parseInt(trimmed);
            if (!isNaN(num) && num >= 1 && num <= AVAILABLE_FEATURES.length) {
                features.push(AVAILABLE_FEATURES[num - 1]);
            } else {
                // Check if it matches a feature name
                const matchedFeature = AVAILABLE_FEATURES.find(f =>
                    f.includes(trimmed) || trimmed.includes(f)
                );
                if (matchedFeature) {
                    features.push(matchedFeature);
                }
            }
        }

        // Remove duplicates
        return [...new Set(features)];
    }

    /**
     * Check if session has all required data
     */
    isComplete() {
        return this.step === STEPS.COMPLETE;
    }

    /**
     * Get property data ready for creation
     */
    getPropertyData() {
        return {
            ...this.data,
            // Placeholder images - seller will replace from profile
            images: getPlaceholderImages(this.data.type),
        };
    }
}

/**
 * Get placeholder images based on property type
 */
function getPlaceholderImages(type) {
    // Using placeholder.com for demo - in production, use actual placeholder images
    const placeholders = {
        apartment: [
            'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
            'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
            'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
            'https://images.unsplash.com/photo-1560185893-a55cbc8c57e8?w=800',
            'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800',
        ],
        villa: [
            'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800',
            'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800',
            'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
            'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800',
            'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?w=800',
        ],
        house: [
            'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800',
            'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800',
            'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=800',
            'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
            'https://images.unsplash.com/photo-1584738766473-61c083514bf4?w=800',
        ],
        default: [
            'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800',
            'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800',
            'https://images.unsplash.com/photo-1494526585095-c41746248156?w=800',
            'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800',
            'https://images.unsplash.com/photo-1560185007-c5ca9d2c014d?w=800',
        ],
    };

    return placeholders[type] || placeholders.default;
}

/**
 * Get or create session for a user
 */
function getSession(userId) {
    // Clean expired sessions
    cleanExpiredSessions();

    if (!propertySessions.has(userId)) {
        propertySessions.set(userId, new PropertyCreationSession(userId));
    }
    return propertySessions.get(userId);
}

/**
 * Get existing session without creating new one
 */
function getExistingSession(userId) {
    return propertySessions.get(userId) || null;
}

/**
 * Delete session for a user
 */
function deleteSession(userId) {
    propertySessions.delete(userId);
}

/**
 * Clean expired sessions
 */
function cleanExpiredSessions() {
    const now = Date.now();
    for (const [userId, session] of propertySessions.entries()) {
        if (now - session.updatedAt > SESSION_EXPIRY_MS) {
            propertySessions.delete(userId);
        }
    }
}

/**
 * Detect if user wants to add a property
 */
function detectAddPropertyIntent(query) {
    const lowerQuery = query.toLowerCase();
    const addPropertyKeywords = [
        'أضف عقار',
        'إضافة عقار',
        'اضافة عقار',
        'أضيف عقار',
        'اضيف عقار',
        'عايز أضيف',
        'عاوز اضيف',
        'عايز اضيف',
        'عندي عقار',
        'عندى عقار',
        'أبيع عقار',
        'ابيع عقار',
        'أبيع شقة',
        'ابيع شقة',
        'أبيع فيلا',
        'عايز أبيع',
        'عاوز ابيع',
        'عايز أأجر',
        'عاوز اأجر',
        'أضف شقة',
        'اضف شقة',
        'أضف فيلا',
        'اضف فيلا',
        'add property',
        'list property',
        'sell property',
        'إضافة عقار جديد',
        'اضافة عقار جديد',
        'أريد إضافة عقار',
        'اريد اضافة عقار',
    ];

    return addPropertyKeywords.some(kw => lowerQuery.includes(kw.toLowerCase()));
}

/**
 * Check if user is in active property creation session
 */
function isInPropertyCreationSession(userId) {
    const session = propertySessions.get(userId);
    if (!session) return false;

    // Check if session is not complete and not expired
    const now = Date.now();
    if (now - session.updatedAt > SESSION_EXPIRY_MS) {
        propertySessions.delete(userId);
        return false;
    }

    return session.step !== STEPS.COMPLETE && session.step !== STEPS.START;
}

module.exports = {
    PropertyCreationSession,
    getSession,
    getExistingSession,
    deleteSession,
    detectAddPropertyIntent,
    isInPropertyCreationSession,
    getPlaceholderImages,
    STEPS,
    AVAILABLE_FEATURES,
};

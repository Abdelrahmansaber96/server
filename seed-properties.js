require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/userModel');
const Property = require('./models/propertyModel');

// 🎯 بيانات عقارات واقعية للبائعين والمطور
const seedProperties = async () => {
  try {
    // الاتصال بقاعدة البيانات
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // جلب المستخدمين
    const abdo = await User.findOne({ email: 'abdo@gmail.com' });
    const hussien = await User.findOne({ email: 'hussien@gmail.com' });
    const ahmed = await User.findOne({ email: 'ahmed@gmail.com' });

    if (!abdo || !hussien || !ahmed) {
      console.error('❌ One or more users not found!');
      process.exit(1);
    }

    console.log('\n👥 Found users:');
    console.log(`- Abdo (Seller): ${abdo._id}`);
    console.log(`- Hussien (Seller): ${hussien._id}`);
    console.log(`- Ahmed (Developer): ${ahmed._id}`);

    // ==========================================
    // 🏠 عقارات عبده (البائع)
    // ==========================================
    console.log('\n🏠 Creating properties for Abdo (Seller)...');
    
    const abdoProperties = await Property.create([
      {
        title: 'شقة فاخرة في التجمع الخامس',
        type: 'apartment',
        description: 'شقة 3 غرف نوم في موقع متميز بالتجمع الخامس، تشطيب سوبر لوكس، إطلالة رائعة',
        location: {
          city: 'القاهرة',
          area: 'التجمع الخامس',
          nearBy: ['كايرو فيستيفال سيتي', 'الجامعة الأمريكية', 'Point 90 Mall'],
          coordinates: { type: 'Point', coordinates: [31.4247, 30.0131] },
        },
        price: 3500000,
        area: 180,
        bedrooms: 3,
        bathrooms: 2,
        listingStatus: 'sale',
        images: [
          'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
          'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
          'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800',
          'https://images.unsplash.com/photo-1556912173-46c336c7fd55?w=800',
        ],
        features: ['تكييف مركزي', 'مصعد', 'بلكونة', 'إطلالة مميزة', 'أمن وحراسة'],
        paymentPlan: {
          paymentType: 'both',
          minDownPaymentPercent: 20,
          maxInstallmentYears: 3,
          allowInstallments: true,
          notes: 'يمكن التفاوض على السعر وخطة الدفع',
        },
        isFeatured: true,
        seller: abdo._id,
        addedBy: abdo._id,
        termsAccepted: true,
        status: 'available',
      },
      {
        title: 'فيلا مستقلة في الشيخ زايد',
        type: 'villa',
        description: 'فيلا فخمة 5 غرف نوم مع حديقة ومسبح خاص في كمبوند مغلق',
        location: {
          city: 'الجيزة',
          area: 'الشيخ زايد',
          nearBy: ['مول العرب', 'هايبر وان', 'Galleria 40'],
          coordinates: { type: 'Point', coordinates: [30.9716, 30.0131] },
        },
        price: 8500000,
        area: 450,
        bedrooms: 5,
        bathrooms: 4,
        listingStatus: 'sale',
        images: [
          'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800',
          'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800',
          'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800',
          'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
        ],
        features: ['مسبح خاص', 'حديقة', 'جراج 3 سيارات', 'نظام أمني متطور', 'Smart Home'],
        paymentPlan: {
          paymentType: 'both',
          minDownPaymentPercent: 30,
          maxInstallmentYears: 5,
          allowInstallments: true,
          notes: 'قابل للتفاوض',
        },
        isFeatured: true,
        seller: abdo._id,
        addedBy: abdo._id,
        termsAccepted: true,
        status: 'available',
      },
      {
        title: 'شقة للإيجار في المعادي',
        type: 'apartment',
        description: 'شقة مفروشة 2 غرفة نوم في قلب المعادي، مناسبة للعائلات',
        location: {
          city: 'القاهرة',
          area: 'المعادي',
          nearBy: ['كارفور المعادي', 'المعادي جراند مول', 'النادي الأهلي'],
          coordinates: { type: 'Point', coordinates: [31.2653, 29.9601] },
        },
        price: 15000,
        area: 140,
        bedrooms: 2,
        bathrooms: 2,
        listingStatus: 'rent',
        images: [
          'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
          'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800',
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
          'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
          'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800',
        ],
        features: ['مفروش بالكامل', 'تكييف', 'مصعد', 'قريبة من المواصلات'],
        paymentPlan: {
          paymentType: 'cash',
          allowInstallments: false,
          notes: 'إيجار شهري + شهرين تأمين',
        },
        seller: abdo._id,
        addedBy: abdo._id,
        termsAccepted: true,
        status: 'available',
      },
    ]);

    console.log(`✅ Created ${abdoProperties.length} properties for Abdo`);

    // ==========================================
    // 🏠 عقارات حسين (البائع)
    // ==========================================
    console.log('\n🏠 Creating properties for Hussien (Seller)...');
    
    const hussienProperties = await Property.create([
      {
        title: 'شقة عصرية في مدينة نصر',
        type: 'apartment',
        description: 'شقة 3 غرف نوم في برج حديث بمدينة نصر، تشطيب ممتاز',
        location: {
          city: 'القاهرة',
          area: 'مدينة نصر',
          nearBy: ['سيتي ستارز', 'جنينة مول', 'City Center'],
          coordinates: { type: 'Point', coordinates: [31.3398, 30.0626] },
        },
        price: 2800000,
        area: 160,
        bedrooms: 3,
        bathrooms: 2,
        listingStatus: 'sale',
        images: [
          'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800',
          'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
          'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
          'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800',
          'https://images.unsplash.com/photo-1556912173-46c336c7fd55?w=800',
        ],
        features: ['تكييف مركزي', 'مصعد', 'موقف سيارات', 'أمن 24 ساعة'],
        paymentPlan: {
          paymentType: 'both',
          minDownPaymentPercent: 25,
          maxInstallmentYears: 2,
          allowInstallments: true,
          notes: 'السعر قابل للتفاوض',
        },
        isFeatured: false,
        seller: hussien._id,
        addedBy: hussien._id,
        termsAccepted: true,
        status: 'available',
      },
      {
        title: 'دوبليكس فاخر في 6 أكتوبر',
        type: 'apartment',
        description: 'دوبليكس 4 غرف نوم في كمبوند راقي، تشطيب سوبر لوكس',
        location: {
          city: 'الجيزة',
          area: '6 أكتوبر',
          nearBy: ['Mall of Arabia', 'Hyper One', 'Dandy Mall'],
          coordinates: { type: 'Point', coordinates: [30.9238, 29.9602] },
        },
        price: 4200000,
        area: 250,
        bedrooms: 4,
        bathrooms: 3,
        listingStatus: 'sale',
        images: [
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
          'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800',
          'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
          'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?w=800',
        ],
        features: ['روف خاص', 'جاكوزي', 'Smart Home', 'نظام أمان متطور', 'مسطحات خضراء'],
        paymentPlan: {
          paymentType: 'both',
          minDownPaymentPercent: 20,
          maxInstallmentYears: 4,
          allowInstallments: true,
          notes: 'إمكانية التفاوض على خطة السداد',
        },
        isFeatured: true,
        seller: hussien._id,
        addedBy: hussien._id,
        termsAccepted: true,
        status: 'available',
      },
      {
        title: 'محل تجاري في وسط البلد',
        type: 'condo',
        description: 'محل 80 متر في موقع حيوي بوسط البلد، مناسب لجميع الأنشطة',
        location: {
          city: 'القاهرة',
          area: 'وسط البلد',
          nearBy: ['ميدان طلعت حرب', 'شارع عماد الدين', 'محطة الأوبرا'],
          coordinates: { type: 'Point', coordinates: [31.2357, 30.0444] },
        },
        price: 2500000,
        area: 80,
        bedrooms: 0,
        bathrooms: 1,
        listingStatus: 'both',
        images: [
          'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=800',
          'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800',
          'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800',
          'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800',
          'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800',
        ],
        features: ['واجهة زجاجية', 'مدخل مستقل', 'موقع استراتيجي', 'كثافة مرورية عالية'],
        paymentPlan: {
          paymentType: 'both',
          minDownPaymentPercent: 30,
          maxInstallmentYears: 3,
          allowInstallments: true,
          notes: 'للبيع أو الإيجار - قابل للتفاوض',
        },
        seller: hussien._id,
        addedBy: hussien._id,
        termsAccepted: true,
        status: 'available',
      },
    ]);

    console.log(`✅ Created ${hussienProperties.length} properties for Hussien`);

    // ==========================================
    // 🏗️ مشاريع أحمد (المطور العقاري)
    // ==========================================
    console.log('\n🏗️ Creating developer projects for Ahmed...');
    
    const ahmedProjects = await Property.create([
      {
        title: 'النخبة ريزيدنس - مشروع سكني متكامل',
        type: 'project',
        projectName: 'النخبة ريزيدنس',
        description: 'مشروع سكني فاخر في قلب العاصمة الإدارية الجديدة، يضم وحدات سكنية متنوعة من شقق وبنتهاوس ودوبلكس',
        location: {
          city: 'العاصمة الإدارية الجديدة',
          area: 'R7',
          nearBy: ['الحي الحكومي', 'النهر الأخضر', 'مسجد الفتاح العليم'],
          coordinates: { type: 'Point', coordinates: [31.7308, 30.0131] },
        },
        price: 2500000, // السعر يبدأ من
        area: 120, // المساحة تبدأ من
        bedrooms: 2,
        bathrooms: 2,
        listingStatus: 'sale',
        images: [
          'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800',
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
          'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800',
          'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800',
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
        ],
        features: [
          'مساحات خضراء واسعة',
          'نادي رياضي',
          'حمامات سباحة',
          'منطقة ألعاب أطفال',
          'أمن وحراسة 24/7',
          'Smart Home System',
        ],
        developer: ahmed._id,
        addedBy: ahmed._id,
        units: 250,
        completionPercentage: 65,
        status: 'under-construction',
        deliveryDate: 'ديسمبر 2025',
        
        developerInfo: {
          logo: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=200',
          location: 'العاصمة الإدارية الجديدة - R7',
          totalProjects: 8,
          phone: '+201000000001',
          email: 'info@elite-developments.com',
          website: 'www.elite-developments.com',
          description: 'شركة رائدة في التطوير العقاري بخبرة 15 عاماً',
        },

        unitOptions: [
          {
            label: 'شقة عصرية - غرفتين',
            size: '120 م²',
            view: 'إطلالة على الحدائق',
            delivery: 'ديسمبر 2025',
            price: '2,500,000 جنيه',
            bedrooms: 2,
            bathrooms: 2,
          },
          {
            label: 'شقة فاخرة - 3 غرف',
            size: '180 م²',
            view: 'إطلالة بانورامية',
            delivery: 'ديسمبر 2025',
            price: '3,600,000 جنيه',
            bedrooms: 3,
            bathrooms: 2,
          },
          {
            label: 'بنتهاوس فاخر',
            size: '280 م²',
            view: 'إطلالة 360 درجة',
            delivery: 'ديسمبر 2025',
            price: '6,500,000 جنيه',
            bedrooms: 4,
            bathrooms: 3,
          },
        ],

        paymentPlans: [
          {
            name: 'خطة 5 سنوات',
            downPayment: '10% مقدم',
            monthlyInstallment: 'تقسيط حتى 60 شهر',
            duration: '5 سنوات',
          },
          {
            name: 'خطة 7 سنوات',
            downPayment: '5% مقدم',
            monthlyInstallment: 'تقسيط حتى 84 شهر',
            duration: '7 سنوات',
          },
          {
            name: 'خصم كاش',
            downPayment: '100% مقدم',
            monthlyInstallment: 'خصم 15%',
            duration: 'فوري',
          },
        ],

        isFeatured: true,
        termsAccepted: true,
      },
      {
        title: 'جاردن سيتي - الساحل الشمالي',
        type: 'project',
        projectName: 'جاردن سيتي',
        description: 'قرية سياحية فاخرة على البحر مباشرة في الساحل الشمالي، وحدات متنوعة مع شاطئ خاص',
        location: {
          city: 'الساحل الشمالي',
          area: 'مارينا',
          nearBy: ['مارينا مول', 'Porto Marina', 'Marassi'],
          coordinates: { type: 'Point', coordinates: [29.1167, 30.8333] },
        },
        price: 3800000, // السعر يبدأ من
        area: 150, // المساحة تبدأ من
        bedrooms: 2,
        bathrooms: 2,
        listingStatus: 'sale',
        images: [
          'https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800',
          'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800',
          'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800',
          'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800',
          'https://images.unsplash.com/photo-1573052905904-34ad8c27f0cc?w=800',
        ],
        features: [
          'شاطئ خاص',
          'حمامات سباحة متعددة',
          'نادي رياضي',
          'منطقة تجارية',
          'مطاعم وكافيهات',
          'Kids Area',
        ],
        developer: ahmed._id,
        addedBy: ahmed._id,
        units: 180,
        completionPercentage: 40,
        status: 'under-construction',
        deliveryDate: 'صيف 2026',
        
        developerInfo: {
          logo: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=200',
          location: 'الساحل الشمالي - مارينا',
          totalProjects: 8,
          phone: '+201000000001',
          email: 'info@elite-developments.com',
          website: 'www.elite-developments.com',
          description: 'شركة رائدة في التطوير العقاري بخبرة 15 عاماً',
        },

        unitOptions: [
          {
            label: 'شاليه 2 غرفة نوم',
            size: '150 م²',
            view: 'إطلالة على البحر',
            delivery: 'صيف 2026',
            price: '3,800,000 جنيه',
            bedrooms: 2,
            bathrooms: 2,
          },
          {
            label: 'شاليه 3 غرف نوم',
            size: '200 م²',
            view: 'إطلالة بحرية مباشرة',
            delivery: 'صيف 2026',
            price: '5,200,000 جنيه',
            bedrooms: 3,
            bathrooms: 3,
          },
          {
            label: 'فيلا مستقلة',
            size: '350 م²',
            view: 'على البحر مباشرة',
            delivery: 'صيف 2026',
            price: '9,500,000 جنيه',
            bedrooms: 4,
            bathrooms: 4,
          },
        ],

        paymentPlans: [
          {
            name: 'خطة 6 سنوات',
            downPayment: '10% مقدم',
            monthlyInstallment: 'تقسيط حتى 72 شهر',
            duration: '6 سنوات',
          },
          {
            name: 'خطة 8 سنوات',
            downPayment: '5% مقدم',
            monthlyInstallment: 'تقسيط حتى 96 شهر',
            duration: '8 سنوات',
          },
          {
            name: 'دفعة نقدية',
            downPayment: '100% مقدم',
            monthlyInstallment: 'خصم 20%',
            duration: 'فوري',
          },
        ],

        isFeatured: true,
        termsAccepted: true,
      },
    ]);

    console.log(`✅ Created ${ahmedProjects.length} projects for Ahmed (Developer)`);

    // ==========================================
    // 📊 النتيجة النهائية
    // ==========================================
    console.log('\n📊 ============ Summary ============');
    console.log(`✅ Total properties created: ${abdoProperties.length + hussienProperties.length + ahmedProjects.length}`);
    console.log(`   - Abdo (Seller): ${abdoProperties.length} properties`);
    console.log(`   - Hussien (Seller): ${hussienProperties.length} properties`);
    console.log(`   - Ahmed (Developer): ${ahmedProjects.length} projects`);
    console.log('\n✅ Seeding completed successfully!');

    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error seeding properties:', error.message);
    console.error(error);
    process.exit(1);
  }
};

seedProperties();

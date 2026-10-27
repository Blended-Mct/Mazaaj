// Issue categories shared by tickets, calls, messages and visits.
// `en`/`ar` are noun phrases that read naturally after "about your …" / "بخصوص …".
export const CATEGORIES = {
  network_slow: { en: 'slow home internet', ar: 'بطء الإنترنت المنزلي', title: 'Slow home internet', team: 'Fixed network (L2)' },
  network_outage: { en: 'service outage', ar: 'انقطاع الخدمة', title: 'Service outage', team: 'Network operations' },
  mobile_coverage: { en: 'mobile coverage', ar: 'تغطية شبكة الهاتف المتنقل', title: 'Mobile coverage', team: 'Radio network' },
  billing: { en: 'bill', ar: 'الفاتورة', title: 'Billing query', team: 'Billing' },
  installation: { en: 'fibre installation', ar: 'تركيب الألياف البصرية', title: 'Fibre installation', team: 'Field operations' },
  device: { en: 'device repair', ar: 'إصلاح الجهاز', title: 'Device repair', team: 'Device care' },
  plan_change: { en: 'plan change', ar: 'تغيير الباقة', title: 'Plan change', team: 'Sales & retention' },
  roaming: { en: 'roaming charges', ar: 'رسوم التجوال', title: 'Roaming charges', team: 'Billing' },
  sim: { en: 'SIM request', ar: 'طلب الشريحة', title: 'SIM & number services', team: 'Customer service' },
  payment: { en: 'payment', ar: 'الدفع', title: 'Payment & top-up', team: 'Billing' },
  general: { en: 'enquiry', ar: 'استفسارك', title: 'General enquiry', team: 'Customer service' },
};

export function category(key) {
  return CATEGORIES[key] || CATEGORIES.general;
}

export function categoryTitle(key) {
  return category(key).title;
}

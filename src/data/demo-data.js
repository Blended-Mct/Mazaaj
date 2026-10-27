// DEMO DATA — every customer, number and interaction below is fictional and
// generated for demonstration. Nothing here is a real Omantel record.
//
// Timestamps are generated relative to "now" so the demo always looks current.
// The first eleven customers are hand-written stories that show each part of the
// app; the rest are a seeded, reproducible population that feeds the dashboard.

import { DAY, HOUR, MINUTE, iso } from '../core/time.js';

const MUSCAT_OFFSET = 4 * HOUR;

/** Deterministic PRNG so the generated population is identical on every start. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a clock for "N days ago at HH:MM Muscat time", never in the future. */
function clock(now) {
  return (daysAgo, hour = 10, minute = 0) => {
    const day = Math.floor((now + MUSCAT_OFFSET - daysAgo * DAY) / DAY) * DAY;
    let t = day + hour * HOUR + minute * MINUTE - MUSCAT_OFFSET;
    if (daysAgo >= 0 && t > now - 20 * MINUTE) t = now - 20 * MINUTE - (daysAgo % 1) * HOUR;
    return iso(t);
  };
}

const monthName = (ms) => new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Muscat' }).format(new Date(ms));

function monthlyBills(now, customerId, amounts) {
  // amounts: oldest → newest; bills are issued on the 3rd of each month.
  const d = new Date(now + MUSCAT_OFFSET);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  if (d.getUTCDate() < 3) m -= 1;
  const bills = [];
  for (let i = amounts.length - 1; i >= 0; i -= 1) {
    const issued = Date.UTC(y, m, 3, 6, 0) - MUSCAT_OFFSET;
    bills.unshift({
      id: `B-${customerId}-${i + 1}`,
      period: monthName(Date.UTC(y, m - 1, 15)),
      amount: amounts[i],
      issuedAt: iso(issued),
      status: i === amounts.length - 1 ? 'due' : 'paid',
    });
    m -= 1;
    if (m < 0) { m += 12; y -= 1; }
  }
  return bills;
}

function base(fields) {
  return {
    demo: true,
    services: [],
    bills: [],
    tickets: [],
    calls: [],
    messages: [],
    feedback: [],
    visits: [],
    followUps: [],
    ...fields,
  };
}

// ---------------------------------------------------------------------------
// Hand-written demo stories
// ---------------------------------------------------------------------------

function heroes(now) {
  const at = clock(now);
  const fromNow = (hours) => iso(now + hours * HOUR);
  const SEEB_INCIDENT = { id: 'INC-7731', title: 'Degraded evening fibre speeds — Seeb cabinet 14', category: 'network_slow', startAt: at(19, 8), endAt: null };

  return [
    base({
      id: 'C1001', name: 'Salim Al-Harthy', nameAr: 'سالم الحارثي', title: { en: 'Mr. Salim', ar: 'أستاذ سالم' }, gender: 'm',
      phone: '+96890001001', language: 'ar', segment: 'Consumer', region: 'Muscat — Seeb', customerSince: at(4380), accountNo: 'DEMO-4471-001',
      story: 'Slow fibre for two weeks, two broken promises and a cancellation threat.',
      services: [
        { id: 'S-1001-1', name: 'Fibre Home 500 Mbps', kind: 'fixed', status: 'active', since: at(1460), monthlyFee: 25, incidents: [SEEB_INCIDENT] },
        { id: 'S-1001-2', name: 'Mobile Postpaid 15', kind: 'mobile', status: 'active', since: at(4380), monthlyFee: 15, incidents: [] },
      ],
      bills: monthlyBills(now, 'C1001', [40.1, 40.0, 41.3, 40.0, 40.6, 40.0]),
      tickets: [
        { id: 'T-48213', category: 'network_slow', subject: 'Fibre speed drops below 20 Mbps every evening', status: 'open', priority: 'high', openedAt: at(11, 19, 10), resolvedAt: null, slaHours: 72, reopenedAt: [at(5, 9, 20)], channel: 'Call', team: 'Fixed network (L2)' },
      ],
      calls: [
        { id: 'CL-90011', at: at(11, 19), durationMin: 14, holdMin: 3, transfers: 0, category: 'network_slow', reason: 'Slow fibre speeds in the evening', outcome: 'unresolved', agent: 'Huda (CC-214)', note: 'Ticket raised for L2 line check.' },
        { id: 'CL-90044', at: at(8, 18, 5), durationMin: 11, holdMin: 12, transfers: 0, category: 'network_slow', reason: 'Follow-up on ticket T-48213', outcome: 'callback_promised', agent: 'Majid (CC-102)', note: 'Customer frustrated, speeds still slow. Promised L2 callback within 24h.' },
        { id: 'CL-90102', at: at(5, 9, 5), durationMin: 18, holdMin: 6, transfers: 2, category: 'network_slow', reason: 'No callback received', outcome: 'transferred', agent: 'Talal (CC-117)', note: 'Customer angry that nobody called back. Ticket reopened.' },
        { id: 'CL-90187', at: at(1, 20, 10), durationMin: 9, holdMin: 15, transfers: 0, category: 'network_slow', reason: 'Technician did not arrive', outcome: 'unresolved', agent: 'Huda (CC-214)', note: 'Customer very upset — technician no-show. Mentioned cancelling.' },
      ],
      messages: [
        { id: 'M-50011', at: at(9, 21, 4), channel: 'WhatsApp', direction: 'in', category: 'network_slow', text: "Internet is still slow every evening, my kids can't study. Any update?" },
        { id: 'M-50012', at: at(9, 21, 40), channel: 'WhatsApp', direction: 'out', category: 'network_slow', text: 'Thank you Mr. Salim, ticket T-48213 is with our technical team. We will update you within 24 hours.' },
        { id: 'M-50031', at: at(3, 22, 15), channel: 'WhatsApp', direction: 'in', category: 'network_slow', text: 'للمرة الثالثة أتواصل معكم والإنترنت ما يشتغل بشكل صحيح. ما أحد اتصل مثل ما وعدتوا.' },
        { id: 'M-50047', at: at(0, 8, 50), channel: 'WhatsApp', direction: 'in', category: 'network_slow', text: 'إذا ما انحلت المشكلة اليوم بلغي الاشتراك وبرفع شكوى لهيئة تنظيم الاتصالات.' },
      ],
      feedback: [
        { id: 'FB-7101', at: at(4, 12), type: 'NPS', score: 3, comment: 'No one calls back. Very disappointed.', channel: 'SMS survey', category: 'network_slow' },
      ],
      visits: [
        { id: 'V-3301', at: at(6, 17, 30), outlet: 'Seeb outlet', category: 'network_slow', purpose: 'Asked for a router replacement', waitMin: 35, outcome: 'referred', note: 'Router tested OK; referred back to ticket T-48213.' },
      ],
      followUps: [
        { id: 'F-1001-1', title: 'L2 engineer to call back with fault diagnosis', category: 'network_slow', createdAt: at(8, 18, 10), dueAt: at(7, 18), status: 'open', completedAt: null, owner: 'Fixed network (L2)', source: 'call', ticketId: 'T-48213' },
        { id: 'F-1001-2', title: 'Technician home visit (10:00–12:00)', category: 'network_slow', createdAt: at(5, 9, 30), dueAt: at(1, 12), status: 'open', completedAt: null, owner: 'Field operations', source: 'call', ticketId: 'T-48213' },
      ],
    }),

    base({
      id: 'C1002', name: 'Fatma Al-Balushi', nameAr: 'فاطمة البلوشي', title: { en: 'Ms. Fatma', ar: 'أستاذة فاطمة' }, gender: 'f',
      phone: '+96890001002', language: 'en', segment: 'Premium', region: 'Muscat — Al Khuwair', customerSince: at(5475), accountNo: 'DEMO-2208-002',
      story: 'Roaming charge fixed quickly with a credit; recently upgraded and happy.',
      services: [
        { id: 'S-1002-1', name: 'Mobile Postpaid 35 (Premium)', kind: 'mobile', status: 'active', since: at(5475), monthlyFee: 35, incidents: [] },
        { id: 'S-1002-2', name: 'Fibre Home 1 Gbps', kind: 'fixed', status: 'active', since: at(6), monthlyFee: 35, incidents: [] },
      ],
      bills: monthlyBills(now, 'C1002', [45.2, 46.0, 44.8, 45.5, 112.4, 63.1]),
      tickets: [
        { id: 'T-47950', category: 'roaming', subject: 'Roaming charged although GCC data pack was active', status: 'resolved', priority: 'normal', openedAt: at(24, 11, 20), resolvedAt: at(20, 15), slaHours: 120, reopenedAt: [], channel: 'Call', team: 'Billing' },
      ],
      calls: [
        { id: 'CL-89870', at: at(24, 11), durationMin: 12, holdMin: 4, transfers: 0, category: 'roaming', reason: 'Unexpected roaming charges', outcome: 'unresolved', agent: 'Saif (CC-140)', note: 'Customer disappointed about roaming charges; billing ticket raised.' },
        { id: 'CL-90120', at: at(6, 10, 30), durationMin: 7, holdMin: 1, transfers: 0, category: 'plan_change', reason: 'Upgrade home fibre to 1 Gbps', outcome: 'resolved', agent: 'Amal (CC-208)', note: 'Lovely customer, very happy with the upgrade.' },
      ],
      messages: [
        { id: 'M-49870', at: at(24, 12), channel: 'Email', direction: 'in', category: 'roaming', text: 'I was charged 70 OMR in roaming even though I bought the GCC data pack before travelling. Please check.' },
        { id: 'M-49960', at: at(19, 16), channel: 'WhatsApp', direction: 'in', category: 'roaming', text: 'Thank you so much, I received the credit. Really appreciate the quick help!' },
        { id: 'M-50130', at: at(5, 20), channel: 'App chat', direction: 'in', category: 'plan_change', text: 'The new 1 Gbps speed is amazing, thanks!' },
      ],
      feedback: [
        { id: 'FB-7020', at: at(19, 17), type: 'CSAT', score: 5, comment: 'Very helpful agent, problem solved quickly.', channel: 'SMS survey', category: 'roaming' },
        { id: 'FB-7140', at: at(4, 12), type: 'NPS', score: 9, comment: 'Great service.', channel: 'App survey', category: 'plan_change' },
      ],
      followUps: [
        { id: 'F-1002-1', title: 'Apply roaming credit and confirm by SMS', category: 'roaming', createdAt: at(24, 11, 30), dueAt: at(19, 18), status: 'done', completedAt: at(20, 15), owner: 'Billing', source: 'call', ticketId: 'T-47950' },
      ],
    }),

    base({
      id: 'C1003', name: 'Ahmed Al-Rawahi', nameAr: 'أحمد الرواحي', title: { en: 'Mr. Ahmed', ar: 'أستاذ أحمد' }, gender: 'm',
      phone: '+96890001003', language: 'ar', segment: 'Consumer', region: 'Nizwa', customerSince: at(2555), accountNo: 'DEMO-6612-003',
      story: 'Bill doubled this month; dispute open and waiting on billing.',
      services: [
        { id: 'S-1003-1', name: 'Mobile Postpaid 12', kind: 'mobile', status: 'active', since: at(2555), monthlyFee: 12, incidents: [] },
        { id: 'S-1003-2', name: '5G Home Broadband', kind: 'fixed', status: 'active', since: at(400), monthlyFee: 10, incidents: [] },
      ],
      bills: monthlyBills(now, 'C1003', [22.1, 21.9, 22.4, 22.0, 22.6, 48.7]),
      tickets: [
        { id: 'T-48390', category: 'billing', subject: 'Disputes bill — unexplained international call charges', status: 'open', priority: 'normal', openedAt: at(2, 10, 25), resolvedAt: null, slaHours: 120, reopenedAt: [], channel: 'Call', team: 'Billing' },
      ],
      calls: [
        { id: 'CL-90160', at: at(2, 10, 5), durationMin: 16, holdMin: 11, transfers: 1, category: 'billing', reason: 'Bill much higher than usual', outcome: 'transferred', agent: 'Nasser (CC-131)', note: 'Customer unhappy with bill; transferred to billing, dispute raised.' },
      ],
      messages: [
        { id: 'M-50101', at: at(2, 9, 30), channel: 'App chat', direction: 'in', category: 'billing', text: 'فاتورتي هذا الشهر مضاعفة وما استخدمت شي زيادة. ليش؟' },
      ],
      followUps: [
        { id: 'F-1003-1', title: 'Billing to review international charges and call back', category: 'billing', createdAt: at(2, 10, 30), dueAt: fromNow(30), status: 'open', completedAt: null, owner: 'Billing', source: 'call', ticketId: 'T-48390' },
      ],
    }),

    base({
      id: 'C1004', name: 'Maryam Al-Lawati', nameAr: 'مريم اللواتية', title: { en: 'Ms. Maryam', ar: 'أستاذة مريم' }, gender: 'f',
      phone: '+96890001004', language: 'en', segment: 'Consumer', region: 'Muscat — Bawshar', customerSince: at(9), accountNo: 'DEMO-9034-004',
      story: 'New customer with a single, smooth visit — too little evidence to estimate mood.',
      services: [{ id: 'S-1004-1', name: 'Mobile Prepaid', kind: 'mobile', status: 'active', since: at(9), monthlyFee: 0, incidents: [] }],
      messages: [
        { id: 'M-50080', at: at(9, 17, 40), channel: 'SMS', direction: 'out', category: 'sim', text: 'Welcome to Omantel! Your new line is active.' },
      ],
      visits: [
        { id: 'V-3350', at: at(9, 17), outlet: 'Bawshar outlet', category: 'sim', purpose: 'New SIM activation', waitMin: 8, outcome: 'resolved', note: '' },
      ],
    }),

    base({
      id: 'C1005', name: 'Khalid Al-Saadi', nameAr: 'خالد السعدي', title: { en: 'Mr. Khalid', ar: 'أستاذ خالد' }, gender: 'm',
      phone: '+96890001005', language: 'en', segment: 'Business', company: 'Al-Saadi Trading (demo)', region: 'Sohar', customerSince: at(1825), accountNo: 'DEMO-B-7781-005',
      story: 'Outage fixed late; poor survey but a friendly message since — mixed signals.',
      services: [
        { id: 'S-1005-1', name: 'Business Fibre 200 Mbps', kind: 'business', status: 'active', since: at(1825), monthlyFee: 55, incidents: [
          { id: 'INC-7702', title: 'Fibre cut — Sohar industrial area', category: 'network_outage', startAt: at(9, 8), endAt: at(6, 16) },
        ] },
      ],
      bills: monthlyBills(now, 'C1005', [55, 55, 55, 55, 55, 55]),
      tickets: [
        { id: 'T-48102', category: 'network_outage', subject: 'Business fibre down — shop POS offline', status: 'resolved', priority: 'high', openedAt: at(9, 8, 30), resolvedAt: at(6, 16), slaHours: 24, reopenedAt: [], channel: 'Call', team: 'Network operations' },
      ],
      calls: [
        { id: 'CL-90071', at: at(9, 8, 20), durationMin: 10, holdMin: 4, transfers: 0, category: 'network_outage', reason: 'Business fibre down', outcome: 'unresolved', agent: 'Ibrahim (BC-011)', note: 'Business customer, POS down. Outage ticket raised.' },
        { id: 'CL-90090', at: at(8, 11), durationMin: 6, holdMin: 2, transfers: 0, category: 'network_outage', reason: 'Asked for restoration time', outcome: 'callback_promised', agent: 'Ibrahim (BC-011)', note: '' },
      ],
      messages: [
        { id: 'M-50090', at: at(6, 17), channel: 'WhatsApp', direction: 'in', category: 'network_outage', text: 'Working now, thanks for the update.' },
        { id: 'M-50140', at: at(2, 12), channel: 'Email', direction: 'in', category: 'billing', text: 'Please send the credit note for the outage days to our accounts team.' },
      ],
      feedback: [
        { id: 'FB-7110', at: at(5, 10), type: 'CSAT', score: 2, comment: 'Took far too long, we lost a day of business.', channel: 'Email survey', category: 'network_outage' },
      ],
      followUps: [
        { id: 'F-1005-1', title: 'Update customer on repair progress', category: 'network_outage', createdAt: at(9, 9), dueAt: at(8, 18), status: 'done', completedAt: at(8, 17), owner: 'Business care', source: 'call', ticketId: 'T-48102' },
        { id: 'F-1005-2', title: 'Issue SLA credit note for outage days', category: 'billing', createdAt: at(2, 12, 30), dueAt: fromNow(50), status: 'open', completedAt: null, owner: 'Business care', source: 'email', ticketId: null },
      ],
    }),

    base({
      id: 'C1006', name: 'Aisha Al-Hinai', nameAr: 'عائشة الهنائية', title: { en: 'Ms. Aisha', ar: 'أستاذة عائشة' }, gender: 'f',
      phone: '+96890001006', language: 'ar', segment: 'Consumer', region: 'Muscat — Al Amerat', customerSince: at(3100), accountNo: 'DEMO-3390-006',
      story: 'Phone repair overdue; two outlet visits and a missed “ready for collection” date.',
      services: [{ id: 'S-1006-1', name: 'Mobile Postpaid 20 + device plan', kind: 'mobile', status: 'active', since: at(700), monthlyFee: 20, incidents: [] }],
      bills: monthlyBills(now, 'C1006', [27.5, 27.5, 28.1, 27.5, 27.9, 27.5]),
      tickets: [
        { id: 'T-48166', category: 'device', subject: 'Warranty screen repair — device at service centre', status: 'open', priority: 'normal', openedAt: at(15, 18, 30), resolvedAt: null, slaHours: 504, reopenedAt: [], channel: 'Outlet', team: 'Device care' },
      ],
      visits: [
        { id: 'V-3320', at: at(15, 18), outlet: 'Al Amerat outlet', category: 'device', purpose: 'Phone screen repair under warranty', waitMin: 45, outcome: 'referred', note: 'Device sent to service centre.' },
        { id: 'V-3361', at: at(4, 19), outlet: 'Al Amerat outlet', category: 'device', purpose: 'Collect repaired phone', waitMin: 25, outcome: 'unresolved', note: 'Device not yet returned from service centre.' },
      ],
      messages: [
        { id: 'M-50120', at: at(2, 11), channel: 'SMS', direction: 'in', category: 'device', text: 'متى بيكون الجهاز جاهز؟ صار لي أسبوعين بدون هاتف.' },
      ],
      feedback: [
        { id: 'FB-7130', at: at(4, 20), type: 'NPS', score: 5, comment: 'Waited again and the phone is still not ready.', channel: 'SMS survey', category: 'device' },
      ],
      followUps: [
        { id: 'F-1006-1', title: 'Repaired phone ready for collection', category: 'device', createdAt: at(15, 18, 30), dueAt: at(6, 12), status: 'open', completedAt: null, owner: 'Device care', source: 'visit', ticketId: 'T-48166' },
      ],
    }),

    base({
      id: 'C1007', name: 'Yousuf Al-Busaidi', nameAr: 'يوسف البوسعيدي', title: { en: 'Mr. Yousuf', ar: 'أستاذ يوسف' }, gender: 'm',
      phone: '+96890001007', language: 'ar', segment: 'Consumer', region: 'Salalah', customerSince: at(6200), accountNo: 'DEMO-1187-007',
      story: 'Long-standing customer, last contact over two months ago — evidence too old to estimate.',
      services: [{ id: 'S-1007-1', name: 'Mobile Postpaid 10', kind: 'mobile', status: 'active', since: at(6200), monthlyFee: 10, incidents: [] }],
      bills: monthlyBills(now, 'C1007', [10.5, 10.5, 10.5, 10.8, 10.5, 10.5]),
      calls: [
        { id: 'CL-88510', at: at(72, 16), durationMin: 5, holdMin: 1, transfers: 0, category: 'plan_change', reason: 'Changed to a smaller plan', outcome: 'resolved', agent: 'Rahma (CC-155)', note: '' },
      ],
      feedback: [
        { id: 'FB-6650', at: at(71, 9), type: 'CSAT', score: 4, comment: '', channel: 'SMS survey', category: 'plan_change' },
      ],
    }),

    base({
      id: 'C1008', name: 'Noura Al-Kindi', nameAr: 'نورة الكندية', title: { en: 'Ms. Noura', ar: 'أستاذة نورة' }, gender: 'f',
      phone: '+96890001008', language: 'en', segment: 'Consumer', region: 'Sur', customerSince: at(1300), accountNo: 'DEMO-5523-008',
      story: 'Routine billing and app questions — calm, everyday contact.',
      services: [
        { id: 'S-1008-1', name: 'Mobile Postpaid 15', kind: 'mobile', status: 'active', since: at(1300), monthlyFee: 15, incidents: [] },
      ],
      bills: monthlyBills(now, 'C1008', [16.2, 15.8, 16.0, 16.4, 15.9, 16.1]),
      calls: [
        { id: 'CL-89990', at: at(12, 11), durationMin: 4, holdMin: 2, transfers: 0, category: 'billing', reason: 'Requested a copy of an invoice', outcome: 'resolved', agent: 'Badar (CC-120)', note: '' },
        { id: 'CL-90170', at: at(3, 16), durationMin: 6, holdMin: 3, transfers: 0, category: 'payment', reason: 'How to set up auto-pay', outcome: 'resolved', agent: 'Amal (CC-208)', note: '' },
      ],
      messages: [
        { id: 'M-49990', at: at(12, 10, 30), channel: 'Email', direction: 'in', category: 'billing', text: 'Please send me a copy of my September invoice.' },
        { id: 'M-50160', at: at(3, 15, 40), channel: 'App chat', direction: 'in', category: 'payment', text: "I'm a bit annoyed the app keeps logging me out when I try to pay." },
      ],
      feedback: [
        { id: 'FB-7050', at: at(11, 9), type: 'CSAT', score: 3, comment: 'OK.', channel: 'SMS survey', category: 'billing' },
      ],
      followUps: [
        { id: 'F-1008-1', title: 'Email invoice copy', category: 'billing', createdAt: at(12, 11, 10), dueAt: at(11, 17), status: 'done', completedAt: at(11, 10), owner: 'Billing', source: 'call', ticketId: null },
      ],
    }),

    base({
      id: 'C1009', name: 'Hamed Al-Maskari', nameAr: 'حامد المسكري', title: { en: 'Mr. Hamed', ar: 'أستاذ حامد' }, gender: 'm',
      phone: '+96890001009', language: 'ar', segment: 'Consumer', region: 'Ibri', customerSince: at(2900), accountNo: 'DEMO-7741-009',
      story: 'Coverage complaints for weeks; fixed yesterday and an agent recorded that he is now calm.',
      services: [
        { id: 'S-1009-1', name: 'Mobile Prepaid', kind: 'mobile', status: 'active', since: at(2900), monthlyFee: 0, incidents: [
          { id: 'INC-7690', title: 'Tower upgrade — Ibri south', category: 'mobile_coverage', startAt: at(21, 7), endAt: at(3, 14) },
        ] },
      ],
      tickets: [
        { id: 'T-47888', category: 'mobile_coverage', subject: 'No indoor signal at home — Ibri south', status: 'resolved', priority: 'normal', openedAt: at(20, 13), resolvedAt: at(2, 11), slaHours: 120, reopenedAt: [], channel: 'Call', team: 'Radio network' },
      ],
      calls: [
        { id: 'CL-89790', at: at(20, 12, 40), durationMin: 9, holdMin: 5, transfers: 0, category: 'mobile_coverage', reason: 'No signal at home', outcome: 'unresolved', agent: 'Hilal (CC-160)', note: 'Coverage ticket raised.' },
        { id: 'CL-89900', at: at(15, 19), durationMin: 12, holdMin: 14, transfers: 0, category: 'mobile_coverage', reason: 'Still no signal', outcome: 'unresolved', agent: 'Shamsa (CC-171)', note: 'Customer frustrated, no signal at home in Ibri.' },
        { id: 'CL-90010', at: at(9, 18), durationMin: 8, holdMin: 6, transfers: 1, category: 'mobile_coverage', reason: 'Asked for update', outcome: 'transferred', agent: 'Hilal (CC-160)', note: '' },
        { id: 'CL-90190', at: at(1, 10), durationMin: 5, holdMin: 1, transfers: 0, category: 'mobile_coverage', reason: 'Confirmed coverage restored', outcome: 'resolved', agent: 'Shamsa (CC-171)', note: 'Coverage restored after tower upgrade.' },
      ],
      messages: [
        { id: 'M-49930', at: at(16, 21), channel: 'SMS', direction: 'in', category: 'mobile_coverage', text: 'Still no signal at home. This is unacceptable.' },
      ],
    }),

    base({
      id: 'C1010', name: 'Said Al-Mamari', nameAr: 'سعيد المعمري', title: { en: 'Mr. Said', ar: 'أستاذ سعيد' }, gender: 'm',
      phone: '+96890001010', language: 'en', segment: 'Business', company: 'Al-Mamari Perfumes (demo)', region: 'Muscat — Al Khuwair', customerSince: at(16), accountNo: 'DEMO-B-8820-010',
      story: 'New shop waiting on business fibre; installation slot already missed once.',
      services: [{ id: 'S-1010-1', name: 'Business Fibre 100 Mbps', kind: 'business', status: 'pending installation', since: at(16), monthlyFee: 40, incidents: [] }],
      tickets: [
        { id: 'T-48250', category: 'installation', subject: 'New business fibre installation — slot rescheduled', status: 'open', priority: 'high', openedAt: at(16, 10), resolvedAt: null, slaHours: 504, reopenedAt: [], channel: 'Outlet', team: 'Field operations' },
      ],
      calls: [
        { id: 'CL-90060', at: at(9, 12), durationMin: 7, holdMin: 3, transfers: 0, category: 'installation', reason: 'Installation slot moved', outcome: 'callback_promised', agent: 'Fahad (BC-020)', note: 'Installation slot moved by field team.' },
        { id: 'CL-90150', at: at(4, 9, 30), durationMin: 9, holdMin: 4, transfers: 0, category: 'installation', reason: 'Technician did not arrive', outcome: 'unresolved', agent: 'Fahad (BC-020)', note: 'Second reschedule. Shop opening on Sunday.' },
      ],
      messages: [
        { id: 'M-50150', at: at(4, 13), channel: 'Email', direction: 'in', category: 'installation', text: "Still waiting on the installation. I need it before my shop opens this Sunday, please don't reschedule again." },
      ],
      visits: [
        { id: 'V-3300', at: at(16, 10), outlet: 'Al Khuwair outlet', category: 'installation', purpose: 'Ordered business fibre for new shop', waitMin: 12, outcome: 'resolved', note: '' },
      ],
      followUps: [
        { id: 'F-1010-1', title: 'Field team to install fibre (rescheduled slot)', category: 'installation', createdAt: at(9, 12, 10), dueAt: at(4, 10), status: 'open', completedAt: null, owner: 'Field operations', source: 'call', ticketId: 'T-48250' },
        { id: 'F-1010-2', title: 'Confirm new installation slot by phone', category: 'installation', createdAt: at(4, 9, 40), dueAt: fromNow(5), status: 'open', completedAt: null, owner: 'Business care', source: 'call', ticketId: 'T-48250' },
      ],
    }),

    base({
      id: 'C1011', name: 'Zainab Al-Riyami', nameAr: 'زينب الريامية', title: { en: 'Ms. Zainab', ar: 'أستاذة زينب' }, gender: 'f',
      phone: '+96890001011', language: 'ar', segment: 'Consumer', region: 'Barka', customerSince: at(2100), accountNo: 'DEMO-4418-011',
      story: 'Quick, friendly outlet visit and glowing feedback in Arabic.',
      services: [{ id: 'S-1011-1', name: 'Mobile Postpaid 20', kind: 'mobile', status: 'active', since: at(2100), monthlyFee: 20, incidents: [] }],
      bills: monthlyBills(now, 'C1011', [21.0, 20.5, 20.9, 21.3, 20.7, 21.1]),
      visits: [
        { id: 'V-3370', at: at(3, 11), outlet: 'Barka outlet', category: 'device', purpose: 'New handset on device plan', waitMin: 6, outcome: 'resolved', note: '' },
      ],
      messages: [
        { id: 'M-50170', at: at(3, 13), channel: 'WhatsApp', direction: 'in', category: 'device', text: 'شكراً جزيلاً، الخدمة ممتازة والموظفة يعطيها العافية.' },
      ],
      feedback: [
        { id: 'FB-7150', at: at(2, 9), type: 'CSAT', score: 5, comment: 'شكراً، خدمة ممتازة وسريعة', channel: 'SMS survey', category: 'device' },
      ],
    }),
  ];
}

function heroCorrections(now) {
  const at = clock(now);
  return [
    {
      // Recorded right after Hamed's call yesterday (CL-90190 at 10:00), so no newer evidence overrides it.
      id: 'MC-0001', customerId: 'C1009', at: at(1, 10, 15), agent: 'Shamsa (CC-171)', verdict: 'corrected', mood: 'neutral',
      note: 'Coverage fixed after the tower upgrade — customer calm and thankful on the call.', estimateAtTime: { mood: 'frustrated', confidence: 'medium' },
    },
    {
      id: 'MC-0002', customerId: 'C1002', at: iso(now - 6 * DAY), agent: 'Amal (CC-208)', verdict: 'confirmed', mood: 'positive',
      note: '', estimateAtTime: { mood: 'positive', confidence: 'high' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Generated population (dashboard volume)
// ---------------------------------------------------------------------------

const NAMES = {
  m: [['Ali', 'علي'], ['Mohammed', 'محمد'], ['Hilal', 'هلال'], ['Nasser', 'ناصر'], ['Saif', 'سيف'], ['Sultan', 'سلطان'], ['Majid', 'ماجد'], ['Hamood', 'حمود'], ['Badar', 'بدر'], ['Talal', 'طلال'], ['Fahad', 'فهد'], ['Ibrahim', 'إبراهيم'], ['Abdullah', 'عبدالله'], ['Rashid', 'راشد'], ['Salim', 'سالم'], ['Khalid', 'خالد'], ['Yaqoob', 'يعقوب'], ['Hamad', 'حمد']],
  f: [['Zainab', 'زينب'], ['Shamsa', 'شمسة'], ['Muna', 'منى'], ['Huda', 'هدى'], ['Asma', 'أسماء'], ['Salma', 'سلمى'], ['Rahma', 'رحمة'], ['Amal', 'أمل'], ['Badriya', 'بدرية'], ['Nawal', 'نوال'], ['Khadija', 'خديجة'], ['Sara', 'سارة'], ['Laila', 'ليلى'], ['Hind', 'هند'], ['Reem', 'ريم'], ['Thuraya', 'ثريا']],
};
const FAMILIES = [['Al-Abri', 'العبري'], ['Al-Shukaili', 'الشكيلي'], ['Al-Farsi', 'الفارسي'], ['Al-Hashmi', 'الهاشمي'], ['Al-Zadjali', 'الزدجالي'], ['Al-Siyabi', 'السيابي'], ['Al-Ghafri', 'الغافري'], ['Al-Jabri', 'الجابري'], ['Al-Wahaibi', 'الوهيبي'], ['Al-Habsi', 'الحبسي'], ['Al-Amri', 'العامري'], ['Al-Mahrouqi', 'المحروقي'], ['Al-Toobi', 'الطوبي'], ['Al-Kalbani', 'الكلباني']];
const REGIONS = [['Muscat — Seeb', 3], ['Muscat — Al Khuwair', 2], ['Muscat — Bawshar', 2], ['Muscat — Al Amerat', 1], ['Sohar', 2], ['Salalah', 2], ['Nizwa', 1], ['Sur', 1], ['Ibri', 1], ['Barka', 1]];
const OUTLET = { 'Muscat — Seeb': 'Seeb outlet', 'Muscat — Al Khuwair': 'Al Khuwair outlet', 'Muscat — Bawshar': 'Bawshar outlet', 'Muscat — Al Amerat': 'Al Amerat outlet', Sohar: 'Sohar outlet', Salalah: 'Salalah outlet', Nizwa: 'Nizwa outlet', Sur: 'Sur outlet', Ibri: 'Ibri outlet', Barka: 'Barka outlet' };
const AGENTS = ['Huda (CC-214)', 'Majid (CC-102)', 'Talal (CC-117)', 'Saif (CC-140)', 'Amal (CC-208)', 'Nasser (CC-131)', 'Rahma (CC-155)', 'Badar (CC-120)', 'Shamsa (CC-171)', 'Hilal (CC-160)'];

const TEXT = {
  negative: {
    network_slow: { en: ['Internet is very slow again tonight.', 'Still not fixed, the speed is terrible.', 'How many times do I have to call about the slow internet?'], ar: ['الإنترنت بطيء جداً مرة ثانية.', 'للأسف المشكلة ما انحلت والسرعة سيئة.'] },
    network_outage: { en: ['No internet since this morning, still waiting for an update.', 'Service is down again, this is unacceptable.'], ar: ['الخدمة مقطوعة من الصباح، متى ترجع؟', 'انقطاع الخدمة مرة ثانية، هذا غير مقبول.'] },
    mobile_coverage: { en: ['No signal at home, calls keep dropping.', 'Coverage is poor in my area, still waiting for a fix.'], ar: ['التغطية ضعيفة في البيت والمكالمات تنقطع.'] },
    billing: { en: ['My bill is double this month, why?', 'I was overcharged again on my bill.'], ar: ['الفاتورة هذا الشهر مرتفعة جداً ومضاعفة، ليش؟'] },
    installation: { en: ['Still waiting for the installation date.', 'The technician did not come, very disappointed.'], ar: ['للأسف ما جا الفني في الموعد.'] },
    device: { en: ['My phone is still not repaired.', 'Still waiting for my device, two weeks now.'], ar: ['الجهاز ما زال ما تصلح، تأخير كبير.'] },
  },
  positive: { en: ['Thank you, working perfectly now.', 'Thanks for the quick help!', 'Great service, appreciated.'], ar: ['شكراً، الخدمة ممتازة.', 'يعطيك العافية، تم الحل بسرعة.', 'مشكورين على المتابعة.'] },
  neutral: { en: ['Can you send me my invoice please?', 'What are the options to upgrade my plan?', 'Please confirm my payment was received.'], ar: ['ممكن ترسلون لي نسخة من الفاتورة؟', 'ما هي الباقات المتوفرة للترقية؟', 'أرجو تأكيد استلام الدفعة.'] },
};

const SUBJECT = {
  network_slow: 'Slow fibre speeds', network_outage: 'No internet service', mobile_coverage: 'Weak indoor coverage',
  billing: 'Bill higher than expected', installation: 'Fibre installation appointment', device: 'Device repair',
};
const SLA = { network_slow: 72, network_outage: 24, mobile_coverage: 120, billing: 120, installation: 240, device: 336 };
const TEAM = { network_slow: 'Fixed network (L2)', network_outage: 'Network operations', mobile_coverage: 'Radio network', billing: 'Billing', installation: 'Field operations', device: 'Device care' };
const ROUTINE_REASON = { plan_change: 'Plan change request', payment: 'Payment question', general: 'General enquiry', sim: 'SIM replacement', billing: 'Bill explanation' };
const FOLLOW_UP = {
  network_slow: 'Engineer to call back with line test results', network_outage: 'Confirm service restoration', mobile_coverage: 'Share coverage improvement plan',
  billing: 'Billing review callback', installation: 'Confirm installation slot', device: 'Device ready for collection',
};

function population(now, size, seed) {
  const rng = mulberry32(seed);
  const at = clock(now);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const chance = (p) => rng() < p;
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  const seebIncident = { id: 'INC-7731', title: 'Degraded evening fibre speeds — Seeb cabinet 14', category: 'network_slow', startAt: at(19, 8), endAt: null };
  const EPISODES = [['content', 30], ['routine', 28], ['billing', 12], ['network', 14], ['device', 8], ['installation', 4]];

  const ids = { t: 46000, c: 80000, m: 40000, f: 6000, v: 2000 };
  const out = [];

  for (let i = 0; i < size; i += 1) {
    const id = `C${2001 + i}`;
    const gender = chance(0.5) ? 'm' : 'f';
    const [first, firstAr] = pick(NAMES[gender]);
    const [family, familyAr] = pick(FAMILIES);
    const region = weighted(REGIONS);
    const lang = chance(0.68) ? 'ar' : 'en';
    const segment = weighted([['Consumer', 80], ['Business', 12], ['Premium', 8]]);
    const seeb = region === 'Muscat — Seeb';
    const familyAr2 = gender === 'f' && familyAr.endsWith('ي') ? `${familyAr.slice(0, -1)}ية` : familyAr;

    const c = base({
      id, name: `${first} ${family}`, nameAr: `${firstAr} ${familyAr2}`,
      title: { en: `${gender === 'm' ? 'Mr.' : 'Ms.'} ${first}`, ar: `${gender === 'm' ? 'أستاذ' : 'أستاذة'} ${firstAr}` }, gender,
      phone: `+9689100${String(i + 1).padStart(4, '0')}`, language: lang, segment, region,
      customerSince: at(int(200, 5000)), accountNo: `DEMO-${String(10000 + i * 37).slice(-5)}-${String(i + 1).padStart(3, '0')}`,
    });
    const business = segment === 'Business';
    const hasFibre = business || chance(0.6);
    c.services.push({ id: `S-${id}-1`, name: business ? 'Business Fibre 200 Mbps' : 'Mobile Postpaid 15', kind: business ? 'business' : 'mobile', status: 'active', since: c.customerSince, monthlyFee: business ? 55 : 15, incidents: business && seeb ? [seebIncident] : [] });
    if (hasFibre && !business) {
      c.services.push({ id: `S-${id}-2`, name: pick(['Fibre Home 300 Mbps', 'Fibre Home 500 Mbps', '5G Home Broadband']), kind: 'fixed', status: 'active', since: c.customerSince, monthlyFee: 25, incidents: seeb ? [seebIncident] : [] });
    }
    const baseBill = c.services.reduce((s, x) => s + x.monthlyFee, 0) * (1 + rng() * 0.15);
    const amounts = Array.from({ length: 6 }, () => Math.round(baseBill * (0.94 + rng() * 0.1) * 1000) / 1000);

    const txt = (tone, cat) => {
      const pool = tone === 'negative' ? (TEXT.negative[cat] || TEXT.negative.network_slow) : TEXT[tone];
      return pick(pool[lang]?.length ? pool[lang] : pool.en);
    };
    const call = (d, cat, outcome, extra = {}) => c.calls.push({ id: `CL-${ids.c++}`, at: at(d, int(8, 21), int(0, 59)), durationMin: int(3, 18), holdMin: extra.holdMin ?? int(0, 8), transfers: extra.transfers ?? 0, category: cat, reason: SUBJECT[cat] || ROUTINE_REASON[cat] || 'General enquiry', outcome, agent: pick(AGENTS), note: extra.note || '' });
    const msg = (d, cat, tone, channel) => c.messages.push({ id: `M-${ids.m++}`, at: at(d, int(8, 22), int(0, 59)), channel: channel || pick(['WhatsApp', 'SMS', 'App chat', 'Email']), direction: 'in', category: cat, text: txt(tone, cat) });
    const survey = (d, cat, type, score, tone) => c.feedback.push({ id: `FB-${ids.f++}`, at: at(d, int(9, 20)), type, score, comment: tone ? txt(tone, cat) : '', channel: 'SMS survey', category: cat });
    const ticket = (d, cat, fixAfter, reopenAfter) => {
      const t = { id: `T-${ids.t++}`, category: cat, subject: SUBJECT[cat], status: 'open', priority: 'normal', openedAt: at(d, int(8, 20)), resolvedAt: null, slaHours: SLA[cat], reopenedAt: [], channel: pick(['Call', 'App', 'Outlet']), team: TEAM[cat] };
      if (fixAfter !== null && d - fixAfter > 0) { t.status = 'resolved'; t.resolvedAt = at(d - fixAfter, int(9, 18)); }
      if (reopenAfter && d - reopenAfter > 0 && (!t.resolvedAt || reopenAfter < fixAfter)) t.reopenedAt.push(at(d - reopenAfter, int(9, 18)));
      c.tickets.push(t);
      return t;
    };
    const followUp = (d, cat, dueIn, done, ticketId) => {
      const due = d - dueIn;
      const f = { id: `F-${id}-${c.followUps.length + 1}`, title: FOLLOW_UP[cat], category: cat, createdAt: at(d, 17), dueAt: due >= 0 ? at(due, 17) : iso(now - due * DAY), status: 'open', completedAt: null, owner: TEAM[cat], source: 'call', ticketId };
      if (done && due > 0.5) { f.status = 'done'; f.completedAt = at(Math.max(0.2, due + (chance(0.75) ? 0.3 : -1.5)), 12); }
      // Promises from long ago were eventually kept, if late.
      else if (d > 25 && due > 3) { f.status = 'done'; f.completedAt = at(Math.max(0.5, due - int(2, 6)), 12); }
      c.followUps.push(f);
    };
    // Older problems have almost always been fixed by now; recent ones may still be open.
    const fixChance = (d, recent) => (d > 25 ? 0.95 : recent);
    const afterFix = (d, cat, fix) => {
      const after = Math.max(0.3, d - fix - 1);
      const good = fix <= 3;
      if (chance(0.45)) msg(after, cat, good ? 'positive' : pick(['positive', 'neutral']));
      if (chance(0.6)) {
        const nps = chance(0.4);
        const score = nps ? (good ? int(7, 10) : int(2, 7)) : (good ? int(4, 5) : int(1, 4));
        survey(after, cat, nps ? 'NPS' : 'CSAT', score, chance(0.5) ? (good ? 'positive' : 'negative') : null);
      }
    };

    const episode = (kind, d, forcedCat) => {
      if (kind === 'content' || kind === 'routine') {
        const cat = pick(['plan_change', 'payment', 'general', 'sim', 'billing']);
        call(d, cat, 'resolved', { holdMin: int(0, 5) });
        if (chance(0.6)) msg(Math.max(0.3, d - 0.2), cat, kind === 'content' ? 'positive' : 'neutral');
        if (chance(0.65)) survey(Math.max(0.3, d - 1), cat, 'CSAT', kind === 'content' ? int(4, 5) : int(3, 4), kind === 'content' && chance(0.6) ? 'positive' : null);
        if (kind === 'content' && chance(0.3)) survey(Math.max(0.3, d - 2), cat, 'NPS', int(9, 10), chance(0.5) ? 'positive' : null);
      } else if (kind === 'billing') {
        if (d <= 30) amounts[5] = Math.round(amounts[5] * (1.6 + rng()) * 1000) / 1000;
        call(d, 'billing', pick(['transferred', 'unresolved']), { holdMin: int(3, 15), transfers: int(0, 2), note: chance(0.5) ? 'Customer unhappy with bill.' : '' });
        if (chance(0.7)) msg(Math.max(0.3, d - 0.2), 'billing', 'negative');
        const fix = chance(fixChance(d, 0.6)) ? int(2, 7) : null;
        const t = ticket(d, 'billing', fix, null);
        followUp(d, 'billing', 3, t.status === 'resolved' && chance(0.85), t.id);
        if (t.status === 'resolved') afterFix(d, 'billing', fix);
      } else if (kind === 'network') {
        const cat = forcedCat || pick(['network_slow', 'network_outage', 'mobile_coverage']);
        const contacts = int(1, 4);
        for (let k = 0; k < contacts; k += 1) {
          const dd = Math.max(0.3, d - k * int(1, 4));
          call(dd, cat, k === contacts - 1 && chance(0.3) ? 'transferred' : 'unresolved', { holdMin: int(2, 16), transfers: chance(0.2) ? 2 : 0, note: k > 0 && chance(0.5) ? 'Customer frustrated, issue still not fixed.' : '' });
          if (chance(0.5)) msg(Math.max(0.3, dd - 0.1), cat, 'negative');
        }
        const fix = chance(fixChance(d, forcedCat ? 0.25 : 0.7)) ? int(1, 9) : null;
        const t = ticket(d, cat, fix, chance(0.2) ? 2 : null);
        followUp(d, cat, 1, t.status === 'resolved' && chance(0.75), t.id);
        if (t.status === 'resolved') afterFix(d, cat, fix);
      } else if (kind === 'device') {
        const outlet = OUTLET[region];
        c.visits.push({ id: `V-${ids.v++}`, at: at(d, int(9, 20)), outlet, category: 'device', purpose: 'Device repair drop-off', waitMin: int(5, 55), outcome: 'referred', note: 'Sent to service centre.' });
        const fix = chance(fixChance(d, 0.6)) ? int(4, 12) : null;
        const t = ticket(d, 'device', fix, null);
        followUp(d, 'device', 7, t.status === 'resolved' && chance(0.75), t.id);
        if (d - 8 > 0) c.visits.push({ id: `V-${ids.v++}`, at: at(d - int(5, 8), int(9, 20)), outlet, category: 'device', purpose: 'Collect repaired device', waitMin: int(5, 60), outcome: t.status === 'resolved' ? 'resolved' : 'unresolved', note: '' });
        if (t.status === 'resolved') afterFix(d, 'device', fix);
        else if (chance(0.5)) msg(Math.max(0.3, d - 3), 'device', 'negative');
      } else if (kind === 'installation') {
        call(d, 'installation', 'resolved');
        const fix = chance(fixChance(d, 0.55)) ? int(5, 14) : null;
        const t = ticket(d, 'installation', fix, null);
        followUp(d, 'installation', 5, t.status === 'resolved' && chance(0.6), t.id);
        if (chance(0.5) && d > 6) {
          call(d - 6, 'installation', 'callback_promised', { note: chance(0.5) ? 'Customer disappointed, installation delayed.' : '' });
          msg(d - 6, 'installation', 'negative');
        }
        if (t.status === 'resolved') afterFix(d, 'installation', fix);
      }
    };

    if (chance(0.12)) {
      // Rarely in touch: nothing in the evidence window.
      if (chance(0.6)) call(int(95, 300), pick(['general', 'plan_change']), 'resolved');
    } else {
      // A steady stream of episodes over six months keeps past weeks comparable to today.
      let d = int(150, 185);
      while (d > 0.5) {
        episode(weighted(EPISODES), d);
        d -= int(18, 55);
      }
      // The Seeb cabinet fault is the one recent, shared spike.
      if (seeb && hasFibre && chance(0.75)) episode('network', int(1, 17), 'network_slow');
    }

    c.bills = monthlyBills(now, id, amounts);
    out.push(c);
  }
  return out;
}

/**
 * @returns {{ customers: object[], corrections: object[] }}
 */
export function generateDemoData(now = Date.now(), { populationSize = 140, seed = 968 } = {}) {
  return {
    customers: [...heroes(now), ...population(now, populationSize, seed)],
    corrections: heroCorrections(now),
  };
}

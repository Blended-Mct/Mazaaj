// Where each kind of evidence comes from, and whether that connection is
// simulated (demo generator) or live. In this build every customer data source
// is simulated; the CTI webhook is a real endpoint other systems can call.

const DATA_SOURCES = [
  { key: 'crm', name: 'Customer profile (CRM)', provides: 'Name, segment, region, preferred language, services' },
  { key: 'billing', name: 'Billing', provides: 'Monthly bills and payment status' },
  { key: 'ticketing', name: 'Ticketing / case management', provides: 'Tickets, SLA, reopen history' },
  { key: 'contact_centre', name: 'Contact centre call records', provides: 'Call reasons, outcomes, hold time, transfers, wrap-up notes' },
  { key: 'messaging', name: 'Digital messaging', provides: 'WhatsApp, SMS, app chat and email' },
  { key: 'surveys', name: 'Surveys (CSAT / NPS)', provides: 'Survey scores and comments' },
  { key: 'outlets', name: 'Outlet visits & queue system', provides: 'Visits, waiting times and outcomes' },
  { key: 'network', name: 'Network incidents (NOC)', provides: 'Known incidents affecting a customer’s services' },
  { key: 'follow_ups', name: 'Follow-up tracking', provides: 'Commitments made to customers and their status' },
];

export function integrationStatus({ ctiKeyConfigured, calls, generatedAt }) {
  const live = calls.filter((c) => c.mode === 'live');
  const simulated = calls.filter((c) => c.mode === 'simulated');
  return {
    summary: { live: 0, simulated: DATA_SOURCES.length, liveCapableEndpoints: 1 },
    dataSources: DATA_SOURCES.map((s) => ({
      ...s,
      mode: 'simulated',
      status: 'Simulated — demo generator',
      lastSync: generatedAt,
      note: 'No live connection in this build. Replace the demo adapter in src/data/ to connect the real system.',
    })),
    channels: [
      {
        key: 'cti',
        name: 'CTI screen-pop (incoming calls)',
        mode: live.length ? 'live' : 'ready',
        status: live.length ? 'Live — receiving call events' : 'Ready — waiting for the first live call event',
        endpoint: 'POST /api/v1/calls/incoming',
        security: ctiKeyConfigured ? 'X-Api-Key required' : 'Open (set MIZAJ_CTI_KEY to require a key)',
        liveEvents: live.length,
        simulatedEvents: simulated.length,
        lastLiveEventAt: live[0]?.receivedAt || null,
      },
      { key: 'rest', name: 'REST API for other systems', mode: 'live', status: 'Live', endpoint: '/api/v1', security: 'Network-level (no login, by design)' },
      { key: 'embed', name: 'Embeddable mood card (iframe)', mode: 'live', status: 'Live', endpoint: '/popup?phone=…&embed=1', security: 'Frame ancestors set by MIZAJ_EMBED_ORIGINS' },
    ],
  };
}

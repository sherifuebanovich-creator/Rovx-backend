#!/usr/bin/env node
/**
 * Local Overpass → ROVX sync script
 * Runs on YOUR machine (where Overpass works), pushes data to the server.
 *
 * Usage:
 *   node scripts/sync-overpass.mjs              # sync UZ only
 *   node scripts/sync-overpass.mjs UZ KZ KG     # sync specific countries
 *   node scripts/sync-overpass.mjs ALL           # sync all CIS countries
 */

const API_BASE = 'https://rovx-backend-up1u.onrender.com/api/v1';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const CIS_COUNTRIES = {
  UZ: 'Uzbekistan', KZ: 'Kazakhstan', KG: 'Kyrgyzstan',
  TJ: 'Tajikistan', TM: 'Turkmenistan', AZ: 'Azerbaijan',
  AM: 'Armenia', GE: 'Georgia', BY: 'Belarus',
  MD: 'Moldova', UA: 'Ukraine', RU: 'Russia',
};

async function login() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin@rovx.app', password: 'Admin@123456' }),
  });
  const data = await res.json();
  if (!data.data?.accessToken) throw new Error('Login failed: ' + JSON.stringify(data));
  return data.data.accessToken;
}

async function fetchOverpass(countryCode) {
  const query = `
[out:json][timeout:180];
area["ISO3166-1"="${countryCode}"][admin_level=2]->.searchArea;
(
  node["highway"="speed_camera"](area.searchArea);
  node["highway"="traffic_signals"](area.searchArea);
);
out body;
  `.trim();

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${await res.text()}`);
  return (await res.json()).elements || [];
}

async function importToServer(token, countryCode, elements) {
  const res = await fetch(`${API_BASE}/map-features/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ countryCode, elements }),
  });
  return (await res.json());
}

async function main() {
  const args = process.argv.slice(2);
  let countries;
  if (args.length === 0 || args[0] === 'ALL') {
    countries = Object.keys(CIS_COUNTRIES);
  } else {
    countries = args.map(a => a.toUpperCase()).filter(c => CIS_COUNTRIES[c]);
  }

  console.log('Logging in...');
  const token = await login();
  console.log('OK\n');

  const results = {};
  for (const code of countries) {
    console.log(`Fetching ${CIS_COUNTRIES[code]} (${code}) from Overpass...`);
    try {
      const elements = await fetchOverpass(code);
      console.log(`  Got ${elements.length} elements`);

      // Send in chunks of 500 to avoid request size limits
      let imported = 0;
      for (let i = 0; i < elements.length; i += 500) {
        const chunk = elements.slice(i, i + 500);
        const res = await importToServer(token, code, chunk);
        if (res.success) {
          imported += res.data?.imported || 0;
        } else {
          console.error(`  Import error: ${res.message}`);
        }
      }
      results[code] = imported;
      console.log(`  Imported: ${imported}`);

      // Rate limit courtesy
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      results[code] = 0;
    }
  }

  console.log('\n=== Results ===');
  for (const [code, count] of Object.entries(results)) {
    console.log(`  ${CIS_COUNTRIES[code]} (${code}): ${count}`);
  }
}

main().catch(console.error);
